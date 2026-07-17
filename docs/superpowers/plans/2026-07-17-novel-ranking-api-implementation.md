# 小说榜单聚合 API 实现计划

> **供代理执行者使用：** 必须使用 `subagent-driven-development`（推荐）或 `executing-plans` 子技能，逐项执行本计划。步骤使用复选框跟踪。

**目标：** 构建一个独立 NestJS 服务，为起点和晋江的榜单快照提供统一、可查询、可手动刷新的 HTTP API。

**架构：** 每个平台实现一个 `RankingProvider` 适配器。应用服务按快照键协调采集、内存缓存和 JSON 文件持久化；控制器只做输入校验和 HTTP 映射。定时任务调用同一刷新入口，失败不会替换旧快照。

**技术栈：** Node.js 20、TypeScript、NestJS、`@nestjs/schedule`、`class-validator`、`cheerio`、`iconv-lite`、Jest、Supertest。

---

## 文件结构

- `package.json`：依赖、构建、测试和启动命令。
- `src/main.ts`、`src/app.module.ts`：启动、全局校验和模块装配。
- `src/rankings/domain/*`：公共类型、快照键和 provider 接口。
- `src/rankings/providers/qidian.provider.ts`：起点 SSR 请求与解析。
- `src/rankings/providers/jjwxc.provider.ts`：晋江榜单、详情请求和 GB18030 解析。
- `src/rankings/snapshot-store.service.ts`：原子 JSON 快照读写。
- `src/rankings/rankings.service.ts`：刷新、缓存、陈旧数据策略。
- `src/rankings/rankings.controller.ts`：查询和手动刷新 API。
- `src/rankings/refresh.scheduler.ts`：六小时刷新任务。
- `test/fixtures/*`：固定 HTML 样本。
- `src/**/*.spec.ts`、`test/rankings.e2e-spec.ts`：单元与 HTTP 测试。

### 任务 1：创建 NestJS 基础项目与测试基线

**文件：**
- 创建：`package.json`、`tsconfig.json`、`nest-cli.json`、`.env.example`、`.gitignore`
- 创建：`src/main.ts`、`src/app.module.ts`、`src/health.controller.ts`
- 创建：`test/health.e2e-spec.ts`

- [ ] **步骤 1：编写健康检查失败测试**

```ts
describe('GET /health', () => {
  it('returns service availability', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- health.e2e-spec.ts`

预期：失败，原因是 NestJS 应用尚未创建。

- [ ] **步骤 3：创建最小启动和健康检查实现**

```ts
@Controller('health')
export class HealthController {
  @Get()
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}

@Module({ controllers: [HealthController] })
export class AppModule {}
```

`main.ts` 必须创建应用并启用 `ValidationPipe({ transform: true, whitelist: true })`。

- [ ] **步骤 4：运行健康检查测试**

运行：`npm test -- health.e2e-spec.ts`

预期：通过 1 个测试。

- [ ] **步骤 5：提交基础项目**

运行：`git add package.json tsconfig.json nest-cli.json .env.example .gitignore src test && git commit -m "chore: bootstrap NestJS ranking API"`

### 任务 2：定义领域模型与 JSON 快照存储

**文件：**
- 创建：`src/rankings/domain/ranking.types.ts`
- 创建：`src/rankings/domain/ranking-provider.ts`
- 创建：`src/rankings/snapshot-store.service.ts`
- 创建：`src/rankings/snapshot-store.service.spec.ts`

- [ ] **步骤 1：编写快照往返读写失败测试**

```ts
const snapshot: RankingSnapshot = {
  platform: 'qidian', rank: 'hotsales', channel: null,
  sourceUrl: 'https://example.test', fetchedAt: '2026-07-17T00:00:00.000Z',
  status: 'fresh', items: [],
};
await store.write(snapshot);
await expect(store.read({ platform: 'qidian', rank: 'hotsales', channel: null }))
  .resolves.toEqual(snapshot);
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- snapshot-store.service.spec.ts`

预期：失败，原因是快照类型和存储服务不存在。

- [ ] **步骤 3：定义类型并实现原子写入**

```ts
export interface RankingItem {
  rank: number; bookId: string; title: string; author: string;
  genres: string[]; status: string | null; wordCount: number | null;
  description: string | null; metrics: Record<string, string | number>;
  url: string;
}
export interface RankingSnapshot {
  platform: Platform; rank: string; channel: string | null; sourceUrl: string;
  fetchedAt: string; status: 'fresh' | 'stale'; lastError?: string; items: RankingItem[];
}
```

`SnapshotStoreService.write` 必须先写入同目录的 `.tmp` 文件，再用 `rename` 替换 `data/snapshots/{platform}--{rank}--{channel-or-default}.json`。

- [ ] **步骤 4：运行存储测试**

运行：`npm test -- snapshot-store.service.spec.ts`

预期：通过读写和缺失快照测试。

- [ ] **步骤 5：提交领域与存储层**

运行：`git add src/rankings/domain src/rankings/snapshot-store.service* && git commit -m "feat: add ranking snapshots"`

### 任务 3：实现起点 SSR 适配器

**文件：**
- 创建：`src/rankings/providers/qidian.provider.ts`
- 创建：`src/rankings/providers/qidian.provider.spec.ts`
- 创建：`test/fixtures/qidian-hotsales.html`

- [ ] **步骤 1：编写 SSR 解析失败测试**

```ts
it('normalizes SSR page records', async () => {
  const snapshot = await provider.fetch({ platform: 'qidian', rank: 'hotsales', channel: null });
  expect(snapshot.items[0]).toMatchObject({
    rank: 1, bookId: '123', title: '测试作品', author: '测试作者',
    genres: ['玄幻', '东方玄幻'], url: 'https://m.qidian.com/book/123/',
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- qidian.provider.spec.ts`

预期：失败，原因是 `QidianProvider` 不存在。

- [ ] **步骤 3：实现 URL 映射、请求和解析**

实现允许的映射：`hotsales` -> `/rank/hotsales/`、`yuepiao` -> `/rank/yuepiao/`、`newbook` -> `/rank/newbook/`、`newauthor` -> `/rank/newauthor/`、`recom` -> `/rank/rec/`、`readindex` -> `/rank/readindex/`、`sanjiang` -> `/sanjiang/`。

```ts
const match = html.match(/<script[^>]+id=["']vite-plugin-ssr_pageContext["'][^>]*>([\s\S]*?)<\/script>/i);
if (!match) throw new SourceParseError('起点页面缺少 SSR pageContext');
const records = JSON.parse(match[1]).pageContext?.pageContext?.pageProps?.pageData?.records;
if (!Array.isArray(records)) throw new SourceParseError('起点 SSR 未包含榜单记录');
```

将 `bName`、`bid`、`bAuth`、`cat`、`subCat`、`desc`、`cnt`、`rankCnt` 映射到统一模型，并使用 `m.qidian.com/book/{bid}/` 生成作品链接。

- [ ] **步骤 4：运行起点测试**

运行：`npm test -- qidian.provider.spec.ts`

预期：通过 URL 映射、正常解析和无 SSR 数据失败测试。

- [ ] **步骤 5：提交起点适配器**

运行：`git add src/rankings/providers/qidian.provider* test/fixtures/qidian-hotsales.html && git commit -m "feat: add Qidian ranking provider"`

### 任务 4：实现晋江适配器

**文件：**
- 创建：`src/rankings/providers/jjwxc.provider.ts`
- 创建：`src/rankings/providers/jjwxc.provider.spec.ts`
- 创建：`test/fixtures/jjwxc-topten.html`、`test/fixtures/jjwxc-onebook.html`

- [ ] **步骤 1：编写榜单和详情合并失败测试**

```ts
it('combines rank entries with GB18030 detail metrics', async () => {
  const snapshot = await provider.fetch({ platform: 'jjwxc', rank: 'income', channel: '0' });
  expect(snapshot.sourceUrl).toContain('orderstr=12&t=0');
  expect(snapshot.items[0].metrics).toEqual(expect.objectContaining({
    collectedCount: 100, nutritionCount: 20, scoreCount: 300,
  }));
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- jjwxc.provider.spec.ts`

预期：失败，原因是 `JjwxcProvider` 不存在。

- [ ] **步骤 3：实现榜单参数、编码和详情解析**

实现 `income` -> `12`、`monthly` -> `7`、`quarterly` -> `8`、`completed` -> `14`、`newcomer` -> `15`、`thousandWords` -> `17`。请求 URL 必须为：

```ts
const rankUrl = `https://www.jjwxc.net/topten.php?orderstr=${orderstr}&t=${channel}`;
const detailUrl = `https://www.jjwxc.net/onebook.php?novelid=${novelId}`;
```

使用 `iconv-lite` 解码详情页字节为 `gb18030`。通过 Cheerio 读取带 `itemprop` 的 `collectedCount`、`nutritionCount`、`scoreCount`、`reviewCount`、`wordCount`、`updataStatus`；缺失详情字段保留为 `null`，单本详情失败不得中断整个榜单。

- [ ] **步骤 4：运行晋江测试**

运行：`npm test -- jjwxc.provider.spec.ts`

预期：通过 URL、详情指标、详情失败降级和不受支持榜单测试。

- [ ] **步骤 5：提交晋江适配器**

运行：`git add src/rankings/providers/jjwxc.provider* test/fixtures/jjwxc-* && git commit -m "feat: add Jinjiang ranking provider"`

### 任务 5：实现刷新协调、查询接口和手动刷新鉴权

**文件：**
- 创建：`src/rankings/rankings.service.ts`
- 创建：`src/rankings/rankings.controller.ts`
- 创建：`src/rankings/dto/ranking-query.dto.ts`
- 创建：`src/rankings/dto/refresh-ranking.dto.ts`
- 创建：`src/rankings/api-key.guard.ts`
- 创建：`src/rankings/rankings.module.ts`
- 创建：`src/rankings/rankings.service.spec.ts`
- 创建：`test/rankings.e2e-spec.ts`

- [ ] **步骤 1：编写控制器和陈旧回退失败测试**

```ts
await request(app.getHttpServer())
  .get('/v1/rankings?platform=qidian&rank=hotsales')
  .expect(200)
  .expect((response) => expect(response.body.status).toBe('stale'));

await request(app.getHttpServer())
  .post('/v1/admin/refresh')
  .send({ platform: 'qidian', rank: 'hotsales' })
  .expect(401);
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- rankings.service.spec.ts && npm test -- rankings.e2e-spec.ts`

预期：失败，原因是应用服务、控制器和鉴权守卫不存在。

- [ ] **步骤 3：实现协调和 HTTP 映射**

`RankingsService.get` 从内存缓存或快照文件读取数据；没有快照时抛出 `SnapshotUnavailableError` 并映射为 `503`。`refresh` 调用对应 provider，成功后写入缓存和文件；失败时读取旧快照，将其复制为 `status: 'stale'` 并追加 `lastError`。

```ts
@Get('v1/rankings')
get(@Query() query: RankingQueryDto): Promise<RankingSnapshot> {
  return this.rankingsService.get(query);
}

@UseGuards(ApiKeyGuard)
@Post('v1/admin/refresh')
refresh(@Body() body: RefreshRankingDto): Promise<RankingSnapshot> {
  return this.rankingsService.refresh(body);
}
```

`ApiKeyGuard` 仅在 `request.header('x-api-key') === process.env.API_KEY` 且 `API_KEY` 非空时放行。DTO 允许的平台仅为 `qidian`、`jjwxc`，并验证 `rank` 为非空字符串、`channel` 为可选字符串。

- [ ] **步骤 4：运行服务与 HTTP 测试**

运行：`npm test -- rankings.service.spec.ts && npm test -- rankings.e2e-spec.ts`

预期：通过 `200`、`400`、`401`、`404`、`503` 和陈旧回退情形。

- [ ] **步骤 5：提交 API 层**

运行：`git add src/rankings test/rankings.e2e-spec.ts && git commit -m "feat: expose ranking API"`

### 任务 6：添加定时刷新、运行说明和全量验证

**文件：**
- 创建：`src/rankings/refresh.scheduler.ts`
- 创建：`README.md`
- 修改：`src/app.module.ts`、`src/rankings/rankings.module.ts`
- 创建：`src/rankings/refresh.scheduler.spec.ts`

- [ ] **步骤 1：编写调度器失败测试**

```ts
it('refreshes configured rankings once per scheduled run', async () => {
  await scheduler.refreshConfiguredRankings();
  expect(rankingsService.refresh).toHaveBeenCalledWith({ platform: 'qidian', rank: 'hotsales' });
  expect(rankingsService.refresh).toHaveBeenCalledWith({ platform: 'jjwxc', rank: 'income', channel: '0' });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- refresh.scheduler.spec.ts`

预期：失败，原因是调度器不存在。

- [ ] **步骤 3：实现六小时调度与文档**

```ts
@Cron(CronExpression.EVERY_6_HOURS)
async refreshConfiguredRankings(): Promise<void> {
  await Promise.allSettled([
    this.rankings.refresh({ platform: 'qidian', rank: 'hotsales' }),
    this.rankings.refresh({ platform: 'jjwxc', rank: 'income', channel: '0' }),
  ]);
}
```

在 `AppModule` 导入 `ScheduleModule.forRoot()`。README 必须说明 Node 版本、`npm install`、`API_KEY`、`SNAPSHOT_DIR`、启动命令、示例查询、手动刷新请求，以及数据不是实时或官方公开 API 的限制。

- [ ] **步骤 4：运行全部验证**

运行：`npm run lint && npm test && npm run build`

预期：三个命令均以退出码 `0` 完成。

- [ ] **步骤 5：提交调度器和文档**

运行：`git add src README.md package.json && git commit -m "feat: schedule ranking refreshes"`
