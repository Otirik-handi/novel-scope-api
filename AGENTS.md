# 项目名称

NovelScope API

## 项目简介

基于 NestJS、Prisma 和 PostgreSQL 的小说榜单与详情采集 API。V0.1 只支持起点中文网，保存四类 Top 10 榜单历史快照和每本书最近一次成功详情。

## 项目结构

```text
novel-scope-api/
├── docs/                         # API 文档
├── prisma/
│   ├── migrations/               # 已提交的 PostgreSQL 迁移
│   └── schema.prisma             # Book、BookDetail、RankingSnapshot、RankingItem
├── scripts/                       # 数据库隔离校验与集成测试运行器
├── src/
│   ├── books/                     # 详情 Controller、Service、Repository、DTO
│   ├── config/                    # 环境校验与命名配置
│   ├── crawlers/                  # 采集契约、站点选择和起点实现
│   │   └── qidian/
│   │       ├── books/             # 详情解析器与爬虫
│   │       └── rankings/          # 榜单解析器与爬虫
│   ├── rankings/                  # 榜单 Controller、Service、Repository、Scheduler、DTO
│   ├── shared/                    # Prisma 基础设施与共享类型
│   ├── utils/                     # 无状态、无 I/O 的纯函数
│   ├── app.module.ts
│   └── main.ts
└── test/
    ├── e2e/                       # 真实 PostgreSQL Repository 与 HTTP E2E
    ├── fixtures/qidian/           # 起点 HTML fixtures
    └── setup-env.ts               # E2E 数据库身份门禁与应用工厂
```

单元测试与源码就近放置；`test/e2e/` 只由真实数据库测试命令运行。

## 架构依赖

```text
AppModule
├── RankingsModule ──> CrawlersModule + DatabaseModule
├── BooksModule ─────> CrawlersModule + DatabaseModule
└── CrawlersModule ──> QidianModule
```

- `rankings` 与 `books` 不互相依赖。
- `crawlers` 不访问 Prisma，也不决定 HTTP 响应。
- 业务 Service 决定完整性、TTL、stale 回退和错误语义。
- Repository 是业务模块访问 Prisma 的边界；共享 `DatabaseModule` 提供 `PrismaService`。
- 榜单成功刷新新增不可变快照；详情只 upsert 最近一次成功结果。

## 常用命令

```powershell
npm ci                     # 安装锁定依赖
npm run db:generate        # 生成 Prisma Client
npm run db:migrate:dev     # 本地开发迁移
npm run db:migrate:deploy  # 应用已提交迁移
bun run swagger:compile    # 使用 Swagger CLI 插件编译
bun run dev                # 编译 Swagger、迁移数据库并启动开发模式
npm run build              # 构建 dist/
npm start                  # 启动构建产物
npm test                   # 单元测试，不运行 test/e2e/
npm run test:db            # 安全校验后运行迁移和真实数据库 E2E
npm run lint               # ESLint
npx tsc --noEmit --incremental false
```

## 测试数据库安全规则

- `.env` 中必须同时配置 `DATABASE_URL` 和 `TEST_DATABASE_URL`，且二者必须是两个不同的 PostgreSQL 数据库。
- `npm run test:db` 会读取 `.env`，但不会覆盖命令调用方预先注入的环境变量。
- 任何迁移、清理或写入前，必须使用 `scripts/database-isolation.cjs` 比较 PostgreSQL 集群标识和数据库 OID；无法确认身份时关闭式失败。
- 迁移只允许对子进程的 `DATABASE_URL` 临时使用 `TEST_DATABASE_URL`；不得修改或清理应用数据库。
- E2E 必须使用真实 AppModule、Controller、Service、Repository 和 Prisma。只可覆盖外部站点爬虫边界，未预期的网络调用必须失败。
- 测试清理只能在身份校验成功后执行，并在结束时关闭 Nest 应用和 Prisma 连接；禁止使用 `forceExit` 掩盖资源泄漏。

## Agent 必须遵守的约束

- 与用户沟通默认使用中文。
- 文档撰写默认使用中文。
- 读取和编辑文本文件时优先使用 UTF-8 编码。
- 实现功能前必须评估成熟的第三方库；无论是否采用，都必须先向用户说明实现思路与取舍。例如网络采集应优先评估 Axios。
