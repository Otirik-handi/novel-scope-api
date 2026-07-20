# NovelScope API

NovelScope API 是基于 NestJS、Prisma 和 PostgreSQL 的小说榜单与详情采集服务。V0.1 支持起点中文网（`qidian`）的月票、畅销、推荐、收藏四类 Top 10 榜单，并按需缓存书籍详情。

榜单刷新会保存不可变的历史快照，但 V0.1 只提供最新快照查询，不提供历史查询接口。书籍详情只保留最近一次成功采集的数据。

## 前置条件

- Node.js 20.12 或更高版本（推荐 Node.js 24）
- PostgreSQL 14 或更高版本
- 两个不同的 PostgreSQL 数据库：应用数据库和测试数据库
- 一个明确、稳定且符合目标站要求的 `QIDIAN_USER_AGENT`

## 安装与配置

安装依赖并生成 Prisma Client：

```powershell
npm ci
npm run db:generate
```

以 `.env.example` 为模板创建 `.env`。至少配置：

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/novel_scope
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/novel_scope_test
QIDIAN_USER_AGENT=NovelScope/0.1 (+https://example.com/contact)
```

`DATABASE_URL` 与 `QIDIAN_USER_AGENT` 是应用启动的必填项。`TEST_DATABASE_URL` 仅供真实数据库测试使用，必须指向与 `DATABASE_URL` 不同的数据库。

可选配置及默认值：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 监听端口 |
| `QIDIAN_REQUEST_TIMEOUT_MS` | `10000` | 起点单次请求超时（毫秒） |
| `BOOK_DETAIL_TTL_HOURS` | `3` | 书籍详情缓存有效期（小时） |
| `RANKING_REFRESH_CRON` | `0 0 6 * * *` | 榜单定时刷新 Cron |
| `RANKING_REFRESH_TIME_ZONE` | `Asia/Shanghai` | 定时刷新时区 |

## 数据库迁移

本地开发数据库创建迁移或应用变更：

```powershell
npm run db:migrate:dev
```

部署环境只应用仓库中已提交的迁移：

```powershell
npm run db:migrate:deploy
```

修改 `prisma/schema.prisma` 后重新生成客户端：

```powershell
npm run db:generate
```

不要修改已经应用的迁移文件；后续 Schema 变化应新增迁移。

## 启动

开发模式（文件变化时重启）：

```powershell
npm run start:dev
```

构建并启动编译产物：

```powershell
npm run build
npm start
```

应用启动不会立即采集。每日定时任务按配置刷新起点四类榜单；也可以调用刷新 API 同步触发。测试环境不注册该 Cron 任务。

## API 与刷新行为

接口说明和响应示例见 [docs/API.md](docs/API.md)。V0.1 提供：

```text
GET  /v1/rankings/:platform/:rankType
POST /v1/rankings/:platform/:rankType/refresh
POST /v1/rankings/:platform/refresh
GET  /v1/books/:platform/:bookId
```

- 最新榜单查询只读取数据库，不会隐式访问起点；没有快照时返回 `404`。
- 单榜刷新同步采集并以一个事务保存完整的 10 条快照；失败返回 `502`，不会留下残缺快照。
- 全量刷新按月票、畅销、推荐、收藏顺序串行执行；单榜失败不会阻止后续榜单，响应逐榜给出结果。
- 书籍详情不存在或过期时同步采集。过期刷新失败时返回最近一次成功数据并标记 `stale: true`；首次采集失败返回 `502`。
- V0.1 未实现刷新鉴权。部署时应在反向代理或网络边界限制 POST 刷新端点。

## 开发验证

单元测试不连接数据库，也不会运行 `test/e2e/` 下的套件：

```powershell
npm test
```

真实数据库测试会从工作目录的 `.env` 加载未预先注入的变量，先比较 PostgreSQL 集群标识和数据库 OID，确认 `DATABASE_URL` 与 `TEST_DATABASE_URL` 身份不同，再仅对 `TEST_DATABASE_URL` 应用迁移并运行 Repository 与 HTTP E2E：

```powershell
npm run test:db
```

该安全校验失败时测试会关闭式拒绝执行。不要让 `TEST_DATABASE_URL` 指向任何需要保留数据的数据库。

静态检查和构建：

```powershell
npm run lint
npm run build
npx tsc --noEmit --incremental false
```

## 采集安全

起点客户端只接受受信的 HTTPS 起点 URL，并在重定向连接前再次校验目标，限制重定向次数、请求超时和解压后响应大小。遇到验证码、登录墙或明确访问限制时立即失败，不尝试绕过；客户端不做自动重试。
