# NovelScope API

NovelScope API 是基于 NestJS、Prisma 和 PostgreSQL 的小说榜单与详情采集服务。V0.1 支持起点中文网（`qidian`）的月票、畅销、推荐、收藏四类 Top 10 榜单，并按需缓存书籍详情。

采集引擎基于 Playwright 模拟真实浏览器行为（系统 Edge），绕过起点 CDN 层的 TLS 指纹和 JavaScript Challenge 检测。

榜单刷新会保存不可变的历史快照，但 V0.1 只提供最新快照查询，不提供历史查询接口。书籍详情只保留最近一次成功采集的数据。

## 前置条件

- Node.js 20.19.0 或更高版本（推荐 Node.js 24）
- PostgreSQL 14 或更高版本
- PostgreSQL 数据库（开发者还需要一个独立的测试数据库）
- Windows 系统（Playwright 使用 `channel: msedge` 调用本地 Edge 浏览器）
- 一个明确、稳定且符合目标站要求的 `QIDIAN_USER_AGENT`

## 安装与配置

安装依赖并生成 Prisma Client：

```powershell
npm ci
npm run db:generate
```

安装 Playwright 所需的 Chromium 浏览器（采集运行时通过 `channel: msedge` 调用系统 Edge，Chromium 仅在测试/调试时使用）：

```powershell
npx playwright install chromium
```

以 `.env.example` 为模板创建 `.env`。至少配置：

```dotenv
DATABASE_URL=postgresql://account:password@localhost:5432/novel_scope
TEST_DATABASE_URL=postgresql://account:password@localhost:5432/novel_scope_test
QIDIAN_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0
QIDIAN_REQUEST_TIMEOUT_MS=30000
```

`QIDIAN_USER_AGENT` 会通过 Axios 请求头发出，应填入真实的浏览器 UA。

可选配置及默认值：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 监听端口 |
| `QIDIAN_REQUEST_TIMEOUT_MS` | `30000` | Playwright 页面加载超时（毫秒），建议不低于 30000 |
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
POST /v1/books/:platform/:bookId/refresh
```

- 最新榜单查询只读取数据库，不会隐式访问起点；没有快照时返回 `404`。
- 单榜刷新同步采集并以一个事务保存完整的 10 条快照；失败返回 `502`，不会留下残缺快照。
- 全量刷新按月票、畅销、推荐、收藏顺序串行执行；单榜失败不会阻止后续榜单，响应逐榜给出结果。
- 书籍详情不存在或过期时同步采集。过期刷新失败时返回最近一次成功数据并标记 `stale: true`；首次采集失败返回 `502`。
- `POST /v1/books/:platform/:bookId/refresh` 强制刷新单本书籍，跳过 TTL 缓存检查。
- V0.1 未实现刷新鉴权。部署时应在反向代理或网络边界限制 POST 刷新端点。

## 采集原理

V0.1 使用 Playwright 驱动系统 Edge 浏览器（`channel: msedge`）模拟真实用户访问，配合 `--disable-blink-features=AutomationControlled` 参数移除 `navigator.webdriver` 标记，绕过起点基于 TLS 指纹和浏览器特征的 CDN 反爬。

- **书籍详情**：从页面的 JSON-LD `<script>` 标签和 OG meta 标签提取结构化数据，DOM 选择器作为补充和回退。
- **榜单**：通过 `#book-img-text > ul > li[data-rid]` 提取 10 个排行项，书号优先从 `data-bid` 属性读取，作者从 `p.author > a.name` 提取。
- **已知限制**：月票/畅销等数值被自定义字体 `hqwWDMYz` 反爬保护，榜单 `metrics` 目前返回空对象。

## 开发者配置

运行真实数据库测试需要 TEST_DATABASE_URL 环境变量，指向与 DATABASE_URL 不同的独立数据库。测试前会自动校验两个数据库身份不同，防止误操作应用数据。

`dotenv
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/novel_scope_test
``r

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

- 起点 URL 请求前和重定向前均校验为受信的 `https://www.qidian.com` 域名；非起点目标拒绝连接。
- 遇到验证码、登录墙或明确访问限制时立即失败，不尝试绕过。
- Playwright 使用 `waitUntil: "load"` 等待页面就绪，避免 `networkidle` 因 WebSocket 长连接无限等待。
- 客户端不做自动重试。错误详情记录在服务端日志中。
