# NovelScope V0.2.1 使用教程

本文面向首次在 Windows 本地运行 NovelScope V0.2.1 的开发者。完成后，你将得到两个保持前台运行的进程、可访问的 Swagger 页面，以及一个由番茄榜单书籍创建并下载到本地的 TXT 正文任务。

本教程只覆盖本地开发和功能验证，不包含生产部署、反向代理、TLS、进程守护、Windows 服务或公网暴露。完整接口字段和错误响应见 [API 文档](API.md)。

## 1. 完成目标

完成本教程后，你可以确认：

- TomatoNovelDownloader 在独立终端前台运行；
- NovelScope API 已完成本地数据库迁移并以前台开发模式运行；
- Swagger UI 可以访问并展示 V0.2.1 接口；
- 可以从番茄榜单响应取得书号，查询详情，创建任务并下载 TXT。

## 2. 前置条件

开始前准备以下软件：

- Windows 10 或 Windows 11；
- Node.js 20.19.0 或更高版本，推荐 Node.js 24；
- PostgreSQL 14 或更高版本，并确保 `createdb` 可在 PowerShell 中调用，或准备使用 pgAdmin 创建数据库；
- Microsoft Edge；
- `TomatoNovelDownloader-Win64-v2.4.13.exe`，该实例只供 NovelScope 使用；
- Bun（可选），用于推荐的聚合开发命令；没有 Bun 也可以使用 npm 分步启动。

在后续命令中，PowerShell 的当前目录应为 NovelScope API 仓库根目录。

## 3. 先了解数据和网络边界

运行首次验证前请确认：

- 榜单刷新、书籍详情首次查询或过期查询、正文下载都会访问起点或番茄外站；
- 榜单刷新和下载任务会写入 `DATABASE_URL` 指向的数据库；
- 正文成功后会写入 `DOWNLOAD_ARTIFACT_DIR`；
- V0.2.1 没有写操作鉴权，不应将开发服务暴露到公网；
- TomatoNovelDownloader 必须由 NovelScope 独占，不要同时通过其 Web UI 或其他程序创建任务。

## 4. 准备 PostgreSQL 数据库

创建应用数据库和独立测试数据库：

```powershell
createdb -U postgres novel_scope
createdb -U postgres novel_scope_test
```

如果 `createdb` 不在 `PATH` 中，也可以在 pgAdmin 中创建同名数据库。数据库名可以自行调整，但 `.env` 中的 URL 必须同步修改。

`novel_scope_test` 必须与 `novel_scope` 是两个不同的 PostgreSQL 数据库。`npm run test:db` 在迁移或清理测试数据前会比较数据库身份，无法确认二者不同时会拒绝执行。不要让 `TEST_DATABASE_URL` 指向需要保留数据的数据库。

## 5. 安装项目依赖

安装锁定版本的依赖并生成 Prisma Client：

```powershell
npm ci
npm run db:generate
```

安装测试和调试使用的 Playwright Chromium：

```powershell
npx playwright install chromium
```

应用实际采集时通过 Playwright 的 `channel: msedge` 使用系统 Edge；这里安装的 Chromium 主要用于测试和调试。

## 6. 配置 `.env`

从示例文件创建本地配置：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`，至少确认以下值。账号、密码和路径均为示例，应替换成当前机器的配置：

```dotenv
DATABASE_URL=postgresql://postgres:replace_me@localhost:5432/novel_scope
TEST_DATABASE_URL=postgresql://postgres:replace_me@localhost:5432/novel_scope_test
QIDIAN_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0
TOMATO_DOWNLOADER_BASE_URL=http://127.0.0.1:18423
TOMATO_DOWNLOADER_EXECUTABLE_PATH=C:/Tools/TomatoNovelDownloader-Win64-v2.4.13.exe
TOMATO_DOWNLOADER_DATA_DIR=C:/NovelScope/tomato-downloader
DOWNLOAD_ARTIFACT_DIR=C:/NovelScope/downloads
PORT=3000
```

配置时注意：

- `QIDIAN_USER_AGENT` 应填写明确、稳定且符合目标站要求的浏览器 UA；
- `TOMATO_DOWNLOADER_EXECUTABLE_PATH` 必须是已存在文件的绝对路径；
- `TOMATO_DOWNLOADER_DATA_DIR` 必须是绝对路径，目录不存在时启动脚本会创建；
- `DOWNLOAD_ARTIFACT_DIR` 必须是 API 可写的绝对路径，用于保存 NovelScope 接管的 TXT；
- `TOMATO_DOWNLOADER_BASE_URL` 必须是带显式端口的本机 HTTP 地址，例如 `http://127.0.0.1:18423`；
- 如果 Downloader Web UI 配置了密码，同时设置 `TOMATO_DOWNLOADER_PASSWORD`；未配置密码时保持为空。

超时、缓存 TTL、定时刷新和轮询间隔等可选变量及默认值见 [`.env.example`](../.env.example)。

## 7. 准备 TomatoNovelDownloader

NovelScope V0.2.1 只支持 TomatoNovelDownloader `2.4.13`。确认该专用实例实际加载的 `config.yml` 包含以下值：

```yaml
use_official_api: true
novel_format: txt
bulk_files: false
enable_segment_comments: false
enable_audiobook: false
auto_open_downloaded_files: false
ask_format_after_download: false
preferred_book_name_field: book_name
allow_overwrite_files: true
```

启动器会把 `TOMATO_DOWNLOADER_DATA_DIR` 作为 Downloader 的 `--data-dir`，并根据 `TOMATO_DOWNLOADER_BASE_URL` 设置监听地址。请在该数据目录中核对当前实例使用的配置，不要与日常手工下载使用的 Downloader 数据目录混用。

### 启动终端一：Downloader

打开第一个 PowerShell，在仓库根目录运行：

```powershell
npm run start:downloader
```

Downloader 会在当前终端前台运行，日志直接显示在这里。保持终端打开；按 `Ctrl+C` 或关闭该终端会终止前台 Downloader。

常见的启动器前置错误会直接输出到控制台，例如缺少环境变量、可执行文件不存在、路径不是绝对路径，或 BASE URL 不是带端口的本机 HTTP 地址。先处理这些错误，再启动 API。

## 8. 首次启动 NovelScope API

### 启动终端二：API

保持 Downloader 运行，再打开第二个 PowerShell。推荐使用 Bun 聚合命令：

```powershell
bun run dev
```

该命令会依次完成启用 Swagger CLI 插件的编译、开发数据库迁移和文件监听启动。

没有安装 Bun 时，在同一个终端依次运行：

```powershell
npm run swagger:compile
npm run db:migrate:dev
npm run start:dev
```

API 启动时会检查 Downloader 是否可访问、版本是否为 `2.4.13`、配置是否满足约定、是否存在未知活跃任务，以及 artifact 目录是否可写。任一检查失败都会拒绝启动，请根据 API 和 Downloader 两个终端中的日志处理。

## 9. 验证 Swagger

默认地址为：

```text
http://localhost:3000/api-docs
```

如果修改了 `PORT`，把地址中的 `3000` 替换为配置值。Swagger 页面能够打开，说明 HTTP 服务已经监听；此时应用不会因为打开页面而自动采集。

## 10. 完成一次番茄 TXT 下载

以下命令在第三个 PowerShell 中运行。主流程只刷新一个番茄榜单，并从响应中读取当前第一名的书号，不依赖可能失效的固定书号。

### 10.1 刷新一个番茄榜单

示例请求路径为 `POST /v1/rankings/fanqie/0_1_1139/refresh`：

```powershell
$baseUrl = "http://localhost:3000"
$rankTypeKey = "0_1_1139"

$ranking = Invoke-RestMethod `
  -Method Post `
  -Uri "$baseUrl/v1/rankings/fanqie/$rankTypeKey/refresh"

if ($ranking.items.Count -ne 10) {
  throw "榜单应包含 10 项，实际为 $($ranking.items.Count) 项"
}

$ranking | Select-Object platform, rankTypeKey, rankType, fetchedAt
$ranking.items | Select-Object rank, externalBookId, title, author
```

成功时接口返回 `201 Created`，并新增一个包含 10 项的不可变榜单快照。这个 POST 会访问番茄外站并写入应用数据库。

以后只想读取最近一次成功快照时，可使用不会触发外站访问的 GET：

```powershell
$latestRanking = Invoke-RestMethod `
  -Method Get `
  -Uri "$baseUrl/v1/rankings/fanqie/$rankTypeKey"
```

### 10.2 从榜单读取书号并查询详情

```powershell
$bookId = $ranking.items[0].externalBookId
$book = Invoke-RestMethod `
  -Method Get `
  -Uri "$baseUrl/v1/books/fanqie/$bookId"

$book | Select-Object externalBookId, title, author, bookStatus, wordCount, stale
```

详情缓存不存在或过期时，这个 GET 会同步访问外站并保存最近一次成功结果。`stale` 为 `false` 表示返回的是有效缓存或本次刷新结果；过期刷新失败但存在旧缓存时，接口仍返回 `200`，并将 `stale` 标记为 `true`。

### 10.3 创建整本 TXT 任务

使用空 JSON 对象创建整本下载任务：

```powershell
$download = Invoke-RestMethod `
  -Method Post `
  -Uri "$baseUrl/v1/books/fanqie/$bookId/downloads" `
  -ContentType "application/json; charset=utf-8" `
  -Body "{}"

$downloadId = $download.id
$download | Select-Object id, externalBookId, status, range, createdAt
```

成功时返回 `202 Accepted`。每次调用都会创建独立任务，不会按书号去重。

### 10.4 轮询到终态

只在 `queued`、`running` 或 `canceling` 时继续等待：

```powershell
$activeStatuses = @("queued", "running", "canceling")

do {
  $task = Invoke-RestMethod `
    -Method Get `
    -Uri "$baseUrl/v1/downloads/$downloadId"

  if ($task.status -in $activeStatuses) {
    Start-Sleep -Seconds 1
  }
} while ($task.status -in $activeStatuses)

$task | Select-Object status, progress, error
```

循环只会在任务进入 `succeeded`、`failed` 或 `canceled` 后结束。失败时查看响应中的稳定 `error.code` 和安全消息，同时检查 API 与 Downloader 日志。

### 10.5 下载成功产物

只有 `succeeded` 任务允许下载文件：

```powershell
if ($task.status -eq "succeeded") {
  Invoke-WebRequest `
    -Uri "$baseUrl/v1/downloads/$downloadId/file" `
    -OutFile ".\novel-$bookId.txt"

  Get-Item ".\novel-$bookId.txt"
} else {
  Write-Warning "任务终态为 $($task.status)，未请求 TXT 文件"
}
```

成功后，TXT 会保存到当前 PowerShell 目录。服务端 artifact 仍保留在 `DOWNLOAD_ARTIFACT_DIR`，直到删除任务。

## 11. 下载指定章节范围

章节范围使用从 1 开始的闭区间，`startChapter` 与 `endChapter` 必须同时提供，并满足 `1 <= startChapter <= endChapter`：

```powershell
$rangeBody = @{ startChapter = 20; endChapter = 30 } | ConvertTo-Json
$rangeDownload = Invoke-RestMethod `
  -Method Post `
  -Uri "$baseUrl/v1/books/fanqie/$bookId/downloads" `
  -ContentType "application/json; charset=utf-8" `
  -Body $rangeBody

$rangeDownload | Select-Object id, status, range
```

把 `$rangeDownload.id` 赋给 `$downloadId`，即可复用上一节的轮询和文件下载命令。

## 11.1 下载起点免费章节

起点使用同一套下载接口，只需把路径中的平台换成 `qidian`：

```powershell
$qidianBookId = "1043182343"
$qidianBody = @{ startChapter = 1; endChapter = 3 } | ConvertTo-Json
$qidianDownload = Invoke-RestMethod `
  -Method Post `
  -Uri "$baseUrl/v1/books/qidian/$qidianBookId/downloads" `
  -ContentType "application/json; charset=utf-8" `
  -Body $qidianBody

$qidianDownload | Select-Object id, platform, status, range
```

把 `$qidianDownload.id` 赋给 `$downloadId` 后，轮询、下载 TXT、取消和删除的命令与番茄流程完全一致。

起点执行器只抓取免费章节，使用时注意：

- 章节序号按目录的全局顺序编号，跨分卷连续计数。
- 遇到第一个 VIP 章节即停止，已抓取的免费章节仍会生成 TXT，`progress` 中带 `stoppedAtChapter` 和 `stopReason`。
- 范围起点已是 VIP 章节，或范围内没有免费章节时，任务以 `QIDIAN_RANGE_UNAVAILABLE` 失败。
- 字体加密章节暂不支持，会以 `QIDIAN_CHAPTER_ENCRYPTED` 失败。

省略 `startChapter`/`endChapter` 时下载全部免费章节：

```powershell
$qidianAll = Invoke-RestMethod `
  -Method Post `
  -Uri "$baseUrl/v1/books/qidian/$qidianBookId/downloads" `
  -ContentType "application/json; charset=utf-8" `
  -Body "{}"

$qidianAll | Select-Object id, platform, status
```

## 12. 管理正文任务

正文任务有六种状态：

| 状态 | 含义 | 可执行操作 |
| --- | --- | --- |
| `queued` | 等待进入 Downloader | 查询、取消 |
| `running` | Downloader 正在处理 | 查询、取消 |
| `canceling` | 已请求取消，等待下游确认 | 查询、重复取消 |
| `succeeded` | 任务成功，artifact 已由 NovelScope 接管 | 查询、下载、删除 |
| `failed` | 任务以安全错误结束 | 查询、删除 |
| `canceled` | 任务已取消 | 查询、删除 |

### 取消任务

取消只适用于 `queued`、`running` 或 `canceling` 任务：

```powershell
$canceledTask = Invoke-RestMethod `
  -Method Post `
  -Uri "$baseUrl/v1/downloads/$downloadId/cancel"

$canceledTask | Select-Object id, status, progress, error
```

`queued` 通常会立即变成 `canceled`；`running` 先变为 `canceling`。如果取消请求与下游完成同时发生，任务仍可能最终成为 `succeeded`。

### 删除终态任务

只有 `succeeded`、`failed` 或 `canceled` 任务可以删除：

```powershell
Invoke-RestMethod `
  -Method Delete `
  -Uri "$baseUrl/v1/downloads/$downloadId"
```

成功返回 `204 No Content`。如果任务成功，该操作也会删除 NovelScope 保存的 TXT；已另存到当前目录的文件不受影响。V0.2.1 没有任务列表接口，请保存需要继续查询的 `$downloadId`。

## 13. 使用起点榜单和平台全量刷新

起点支持四个机器键：

| 机器键 | 榜单 |
| --- | --- |
| `yuepiao` | 月票榜 |
| `hotsales` | 畅销榜 |
| `recom` | 推荐榜 |
| `collect` | 收藏榜 |

例如刷新起点月票榜：

```powershell
$qidianRanking = Invoke-RestMethod `
  -Method Post `
  -Uri "$baseUrl/v1/rankings/qidian/yuepiao/refresh"
```

平台全量刷新接口为：

```text
POST /v1/rankings/qidian/refresh
POST /v1/rankings/fanqie/refresh
```

起点全量刷新会按目录顺序处理 4 个榜单；番茄全量刷新会串行访问 74 个榜单，耗时和外站请求量都明显更大，因此不建议将番茄全量刷新作为首次启动验证。单个榜单失败不会中止后续榜单，响应会逐项给出成功快照或稳定错误码。

## 14. 日常启动和停止

每次本地开发按以下顺序启动：

1. 终端一运行 `npm run start:downloader`，确认 Downloader 保持前台运行；
2. 终端二运行 `bun run dev`，或依次运行 npm 的编译、迁移和 watch 命令；
3. 打开 Swagger，或在其他 PowerShell 中调用 API。

停止时按相反顺序：

1. 在 API 终端按 `Ctrl+C`，等待 Nest 应用退出；
2. 再在 Downloader 终端按 `Ctrl+C`，终止前台 Downloader。

不要在 API 仍处理正文任务时直接关闭 Downloader。

## 15. 故障排查

| 现象 | 原因和处理 |
| --- | --- |
| `TOMATO_DOWNLOADER_EXECUTABLE_PATH is required` 或可执行文件不存在 | 检查 `.env` 是否位于仓库根目录，并将变量改为现有 `.exe` 文件的绝对路径。 |
| Downloader 数据目录报错 | `TOMATO_DOWNLOADER_DATA_DIR` 必须是绝对路径；如果目标已存在，它必须是目录且当前用户可访问。 |
| BASE URL 校验失败 | 只使用带显式端口的本机 HTTP 地址，如 `http://127.0.0.1:18423`；不要使用 HTTPS、局域网 IP、路径、查询参数或省略端口。 |
| Downloader 已启动，但 API 拒绝启动 | 核对版本必须为 `2.4.13`、九项 `config.yml` 契约、Web UI 密码、artifact 目录写权限；清理通过 Web UI 或其他系统创建的未知活跃任务，并确保该实例由 NovelScope 独占。 |
| 查询合法榜单返回 `404` | 数据库中还没有该榜单的成功快照。先调用对应的单榜刷新 POST；未登记的榜单键会返回 `400`。 |
| 榜单或详情返回 `502` | 外站访问、页面解析、完整性校验或持久化失败。查看服务端日志，确认 Edge、UA、网络和目标站状态；客户端不会自动重试。 |
| 详情返回 `stale: true` | 旧缓存已经过期，本次外站刷新失败，但服务保留并返回了最近一次成功详情。稍后再强制刷新，不要把旧数据误判为本次采集结果。 |
| 下载、取消或删除返回 `409` | 当前任务状态不允许该操作。重新查询任务状态；文件只允许在 `succeeded` 时下载，删除只允许在三个终态执行。 |
| 文件下载返回 `410` | 数据库记录为成功，但 `DOWNLOAD_ARTIFACT_DIR` 中的 NovelScope artifact 已丢失。该文件无法通过当前任务恢复，需要重新创建下载任务。 |
| `npm run db:migrate:dev` 无法连接 | 核对 PostgreSQL 服务、账号密码、端口、数据库名和 `DATABASE_URL`，确认应用数据库已经创建。 |
| `npm run test:db` 拒绝执行 | 确认同时配置 `DATABASE_URL` 与 `TEST_DATABASE_URL`，且它们是两个身份不同的 PostgreSQL 数据库；不要绕过身份门禁。 |
| Swagger 地址无法访问 | 确认 API 终端仍在运行，并按 `.env` 的 `PORT` 组合 `/api-docs` 地址；同时检查端口是否被其他进程占用。 |

## 16. 开发阶段限制

V0.2.1 仍处于开发阶段，当前没有写操作鉴权、用户隔离、任务列表、榜单历史查询、跨平台书籍去重或番茄分类远程发现。正文下载只支持番茄平台和 TXT 格式。

本教程不提供生产部署方案，也不应被视为公网暴露指南。开发时只在受控本机环境运行 Downloader 和 API；接口的完整响应、状态码、缓存和错误语义以 [API 文档](API.md) 为准。
