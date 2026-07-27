# NovelScope API

NovelScope API 是基于 NestJS、Prisma 和 PostgreSQL 的小说榜单、详情采集与正文下载服务。V0.2.1 支持起点中文网（`qidian`）四类 Top 10 榜单、番茄小说（`fanqie`）74 个静态 Top 10 榜单，并按需缓存两个平台的书籍详情。

采集引擎基于 Playwright 驱动系统 Edge。番茄采集先在可信站点初始化隔离的浏览器上下文，再使用同源会话读取榜单初始状态或请求详情；Cheerio 只定位详情页内嵌 JSON，脚本文本仅通过 `JSON.parse` 解析，不会执行。

榜单刷新会保存不可变的历史快照，但 V0.2.1 只提供最新快照查询，不提供历史查询接口。书籍详情只保留每个平台、每个外部书号最近一次成功采集的数据。

## 前置条件

- Node.js 20.19.0 或更高版本（推荐 Node.js 24）
- PostgreSQL 14 或更高版本
- PostgreSQL 数据库（开发者还需要一个独立的测试数据库）
- Windows 系统（Playwright 使用 `channel: msedge` 调用本地 Edge 浏览器）
- 一个明确、稳定且符合目标站要求的 `QIDIAN_USER_AGENT`
- 专供 NovelScope 使用的 `TomatoNovelDownloader-Win64-v2.4.13.exe` Web 服务

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
FANQIE_REQUEST_TIMEOUT_MS=30000
TOMATO_DOWNLOADER_BASE_URL=http://127.0.0.1:18423
TOMATO_DOWNLOADER_EXECUTABLE_PATH=C:/Tools/TomatoNovelDownloader-Win64-v2.4.13.exe
TOMATO_DOWNLOADER_DATA_DIR=C:/NovelScope/tomato-downloader
DOWNLOAD_ARTIFACT_DIR=C:/NovelScope/downloads
```

`QIDIAN_USER_AGENT` 会通过 Axios 请求头发出，应填入真实的浏览器 UA。

可选配置及默认值：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 监听端口 |
| `QIDIAN_REQUEST_TIMEOUT_MS` | `30000` | Playwright 页面加载超时（毫秒），建议不低于 30000 |
| `FANQIE_REQUEST_TIMEOUT_MS` | `30000` | 番茄页面加载与同源请求超时（毫秒） |
| `BOOK_DETAIL_TTL_HOURS` | `3` | 书籍详情缓存有效期（小时） |
| `RANKING_REFRESH_CRON` | `0 0 6 * * *` | 起点四榜定时刷新 Cron，默认每天 06:00 |
| `FANQIE_RANKING_REFRESH_CRON` | `0 30 0 * * *` | 番茄 74 榜定时刷新 Cron，默认每天 00:30 |
| `RANKING_REFRESH_TIME_ZONE` | `Asia/Shanghai` | 定时刷新时区 |
| `TOMATO_DOWNLOADER_PASSWORD` | 空 | Downloader Web UI 密码 |
| `TOMATO_DOWNLOADER_REQUEST_TIMEOUT_MS` | `10000` | Downloader 控制请求超时（毫秒） |
| `TOMATO_DOWNLOAD_POLL_INTERVAL_MS` | `1000` | 健康状态下任务轮询间隔（毫秒） |
| `TOMATO_DOWNLOAD_TASK_TIMEOUT_MS` | `7200000` | 单个运行任务上限，默认 2 小时 |

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

### 专用 TomatoNovelDownloader

NovelScope API 进程不启动、停止或修改 Downloader。先在 Downloader 的 `config.yml` 中确认：

- `use_official_api: true`
- `novel_format: txt`
- `bulk_files: false`
- `enable_segment_comments: false`
- `enable_audiobook: false`
- `auto_open_downloaded_files: false`
- `ask_format_after_download: false`
- `preferred_book_name_field: book_name`
- `allow_overwrite_files: true`

在 `.env` 中配置 Downloader 可执行文件和独立数据目录。`TOMATO_DOWNLOADER_BASE_URL` 必须是带显式端口的本机 HTTP 地址；启动脚本会从中派生 Downloader 的 `TOMATO_WEB_ADDR`：

```dotenv
TOMATO_DOWNLOADER_BASE_URL=http://127.0.0.1:18423
TOMATO_DOWNLOADER_EXECUTABLE_PATH=C:/Tools/TomatoNovelDownloader-Win64-v2.4.13.exe
TOMATO_DOWNLOADER_DATA_DIR=C:/NovelScope/tomato-downloader
```

以前台方式启动 Downloader：

```powershell
npm run start:downloader
```

脚本会在需要时创建数据目录，并在当前控制台显示 Downloader 日志；按 `Ctrl+C` 或关闭控制台会终止 Downloader。路径通过子进程参数传递，可以包含空格。如启用 Downloader 密码，同时设置 `TOMATO_DOWNLOADER_PASSWORD`。

该实例必须由 NovelScope 独占，不得通过 Web UI 或其他系统创建任务。先保持 Downloader 运行，再启动 NovelScope API。Downloader 不可访问、版本不是 `2.4.13`、配置不符合契约、存在未知活跃任务或 artifact 目录不可写时，NovelScope 会拒绝启动。

开发模式会先使用 Swagger CLI 插件编译应用、迁移开发数据库，再启动文件监听：

```powershell
bun run dev
```

只执行启用了 Swagger CLI 插件的编译：

```powershell
bun run swagger:compile
```

构建并启动编译产物：

```powershell
npm run build
npm start
```

应用启动不会立即采集。两个独立定时任务按共享时区执行：`RANKING_REFRESH_CRON` 只控制起点四榜，`FANQIE_RANKING_REFRESH_CRON` 控制番茄 74 榜。也可以调用刷新 API 同步触发；测试环境不注册 Cron 任务。

## API 与刷新行为

应用启动后，可通过 Swagger UI 交互式查看和执行接口：

```text
http://localhost:3000/api-docs
```

端口随 `PORT` 配置变化。完整响应示例、错误语义和缓存行为见 [docs/API.md](docs/API.md)。V0.2.1 提供：

```text
GET  /v1/rankings/:platform/:rankTypeKey
POST /v1/rankings/:platform/:rankTypeKey/refresh
POST /v1/rankings/:platform/refresh
GET  /v1/books/:platform/:bookId
POST /v1/books/:platform/:bookId/refresh
POST /v1/books/fanqie/:bookId/downloads
GET  /v1/downloads/:downloadId
GET  /v1/downloads/:downloadId/file
POST /v1/downloads/:downloadId/cancel
DELETE /v1/downloads/:downloadId
```

- 最新榜单查询只读取数据库，不会隐式访问外站；没有快照时返回 `404`。
- 单榜刷新同步采集并以一个事务保存完整的 10 条快照；失败返回 `502`，不会留下残缺快照。
- 全量刷新按平台静态目录顺序串行执行；单榜失败不会阻止后续榜单，响应逐榜给出机器键、中文名和结果。
- 书籍详情不存在或过期时同步采集。过期刷新失败时返回最近一次成功数据并标记 `stale: true`；首次采集失败返回 `502`。
- `POST /v1/books/:platform/:bookId/refresh` 强制刷新单本书籍，跳过 TTL 缓存检查。
- 番茄正文下载使用 PostgreSQL FIFO 异步任务，仅支持 TXT；成功产物由 NovelScope 接管并保存 SHA-256。
- V0.2.1 未实现写操作鉴权。部署时应在反向代理或网络边界限制刷新、下载创建、取消和删除端点。

通过 Swagger UI 执行 POST 刷新会访问外站并写入 `DATABASE_URL` 指向的数据库；书籍详情 GET 在缓存不存在或过期时也可能访问外站。手动验证前应确认数据库和外站访问配置符合预期。

## 采集原理

V0.2.1 使用 Playwright 驱动系统 Edge 浏览器（`channel: msedge`）访问两个可信站点。每次采集使用独立 browser context，模块销毁时关闭复用的 browser。

- **书籍详情**：从页面的 JSON-LD `<script>` 标签和 OG meta 标签提取结构化数据，DOM 选择器作为补充和回退。
- **榜单**：通过 `#book-img-text > ul > li[data-rid]` 提取 10 个排行项，书号优先从 `data-bid` 属性读取，作者从 `p.author > a.name` 提取。
- **已知限制**：月票/畅销等数值被自定义字体 `hqwWDMYz` 反爬保护，榜单 `metrics` 目前返回空对象。
- **番茄榜单**：从限定的 `window.__INITIAL_STATE__` 候选分支解析前 10 项，目录由仓库内 37 个频道分类静态生成，不做线上分类发现。
- **番茄详情**：先访问首页建立同源会话，再请求 `/page/{bookId}`，从受限大小和深度的内嵌 JSON 提取详情。

## 开发者配置

运行真实数据库测试需要 TEST_DATABASE_URL 环境变量，指向与 DATABASE_URL 不同的独立数据库。测试前会自动校验两个数据库身份不同，防止误操作应用数据。

```dotenv
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/novel_scope_test
```

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
- 番茄只接受 `https://fanqienovel.com` 的精确榜单和详情路径；跨域、含凭据 URL 和异常重定向均拒绝。
- 遇到验证码、登录墙或明确访问限制时立即失败，不尝试绕过。
- Playwright 使用 `waitUntil: "load"` 等待页面就绪，避免 `networkidle` 因 WebSocket 长连接无限等待。
- 客户端不做自动重试。错误详情记录在服务端日志中。
