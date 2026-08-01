# 起点免费章节下载设计

## 背景

NovelScope 当前只有番茄正文下载能力：客户端调用 `POST /v1/books/fanqie/:bookId/downloads` 创建异步任务，`DownloadsWorker` 轮询外部 TomatoNovelDownloader，最终把 TXT 保存到 `ArtifactStore`，并通过统一的查询、下载、取消和删除接口暴露。

本次为起点增加免费章节下载，目标不是另起一套下载接口，而是复用现有任务表、状态机、产物存储和下载 API，通过 `platform` 选择不同执行器。

## 目标

- 通过平台字段发起起点和番茄下载任务，例如 `POST /v1/books/:platform/:bookId/downloads`。
- 起点任务支持整本免费章节下载和 1-based 章节范围下载。
- 起点目录按全局顺序编号；遇到第一个 VIP 章节即停止，不逐章记录失败。
- 产物继续保存为 TXT，并复用 `ArtifactStore` 和 `GET /v1/downloads/:id/file`。
- 保持现有下载任务状态语义：`QUEUED -> RUNNING -> SUCCEEDED/FAILED`，以及取消路径。
- 不新增 npm 依赖，不修改 Prisma schema。

## 非目标

- 不爬取或绕过起点 VIP 章节。
- 不实现字体加密 `cES=2` 的解密、OCR 或字体映射。
- 不新增 `partial` 或逐章失败状态。
- 不把章节正文单独入库，不新增章节目录表。
- 不修改 TomatoNovelDownloader 本身。
- 不要求用户登录起点账号。

## API 契约

### 创建下载任务

新增通用路由：

```text
POST /v1/books/:platform/:bookId/downloads
```

请求示例：

```json
{
  "startChapter": 1,
  "endChapter": 100
}
```

- `platform` 支持 `qidian` 和 `fanqie`。
- `bookId` 必须是数字字符串。
- `startChapter` 和 `endChapter` 必须同时出现或同时省略。
- 范围是 1-based 闭区间，且 `startChapter <= endChapter`。
- 省略范围表示整本下载。

旧路由保留兼容：

```text
POST /v1/books/fanqie/:bookId/downloads
```

旧路由内部调用同一 Service，并固定使用 `platform: "fanqie"`。

### 查询、下载、取消、删除

以下接口保持不变：

```text
GET    /v1/downloads/:downloadId
GET    /v1/downloads/:downloadId/file
POST   /v1/downloads/:downloadId/cancel
DELETE /v1/downloads/:downloadId
```

响应中 `platform` 类型从固定 `"fanqie"` 扩展为 `Platform` 联合类型，`format` 保持 `"txt"`。

## 目录结构

```text
src/
├── downloads/
│   ├── runners/
│   │   ├── book-download-runner.interface.ts
│   │   ├── book-download-runner.registry.ts
│   │   ├── fanqie/
│   │   │   ├── fanqie-download.runner.ts
│   │   │   ├── fanqie-download.runner.spec.ts
│   │   │   └── tomato-downloader/
│   │   │       ├── tomato-downloader.client.ts
│   │   │       ├── tomato-downloader.client.spec.ts
│   │   │       └── tomato-downloader.contract.ts
│   │   └── qidian/
│   │       ├── qidian-download.runner.ts
│   │       └── qidian-download.runner.spec.ts
│   ├── downloads.repository.ts
│   ├── downloads.worker.ts
│   └── ...现有 downloads 文件
└── crawlers/
    └── qidian/
        ├── chapters/
        │   ├── qidian-catalog.parser.ts
        │   ├── qidian-chapter.parser.ts
        │   ├── qidian-chapter.crawler.ts
        │   └── qidian-chapter.crawler.spec.ts
        ├── books/
        └── rankings/
```

`ChapterRange` 上移到 `runners/book-download-runner.interface.ts`，`DownloadsRepository` 不再依赖番茄契约。

## 架构与数据流

```text
DownloadsController
        |
        v
DownloadsService
        |
        +-> DownloadsRepository
        |
        +-> BookDownloadRunnerRegistry
                |
                +-> FanqieDownloadRunner -> TomatoDownloaderClient
                |
                +-> QidianDownloadRunner -> QidianChapterCrawler
                                               |
                                               +-> QidianBrowserClient
                                               +-> QidianCatalogParser
                                               +-> QidianChapterParser

DownloadsWorker -> BookDownloadRunnerRegistry
                -> ArtifactStore
```

- `BookDownloadRunner` 定义平台下载执行器的统一生命周期接口。
- `BookDownloadRunnerRegistry` 根据 `task.book.platform` 返回 runner；未知平台抛错。
- `FanqieDownloadRunner` 包装现有 `TomatoDownloaderClient`，外部下载流程不变。
- `QidianDownloadRunner` 是本地执行器，负责目录、范围、章节抓取和 TXT 流生成，不直接访问 Prisma。
- `QidianChapterCrawler` 位于 crawlers 层，只负责起点 HTTP/浏览器抓取和解析，不决定下载任务状态。
- `DownloadsWorker` 只依赖 registry，不再直接依赖番茄客户端。
- `DownloadsService.cancel` 也通过 registry 找到对应 runner 并调用 `cancelJob`。

创建任务流程：

```text
POST /v1/books/:platform/:bookId/downloads
  -> DTO 校验
  -> DownloadsRepository.createQueued(platform, bookId, range)
  -> BookDownload QUEUED
  -> DownloadsWorker 认领，状态 RUNNING
  -> registry 按 platform 选择 runner
  -> runner 创建任务并执行
  -> ArtifactStore 保存 TXT
  -> BookDownload SUCCEEDED
```

## 起点目录与章节解析

### 目录解析

- 使用现有 `QidianBrowserClient` 抓取 `https://www.qidian.com/book/{bookId}/`。
- 按 DOM 顺序遍历 `div.catalog-volume`，再遍历其中的 `li.chapter-item`。
- 每个章节分配全局 1-based `index`，不依赖每个卷内重置的 `data-rid`。
- 记录 `title`、`chapterId`、`sourceUrl` 和 `isVip`。
- `isVip` 以章节项内存在 `.chapter-locked` 为准。
- 目录为空或解析失败时抛出 `QIDIAN_CATALOG_PARSE_FAILED`。

### 章节解析

- 使用 `QidianBrowserClient` 抓取 `https://www.qidian.com/chapter/{bookId}/{chapterId}/`。
- 从 `<script id="vite-plugin-ssr_pageContext">` 读取 JSON。
- 提取 `pageContext.pageProps.pageData.chapterInfo`。
- 正文使用 `chapterInfo.content` 中的 `<p>` 段落。
- 校验 `vipStatus`；`vipStatus=1` 时按 VIP 章节处理。
- `cES=2` 时第一版直接失败，错误码 `QIDIAN_CHAPTER_ENCRYPTED`。
- SSR 缺失或正文为空时失败，错误码 `QIDIAN_CHAPTER_EMPTY`。

## 范围与 VIP 停止规则

定义：

```text
N = 目录章节总数
firstVip = 第一个 VIP 章节的全局 index；不存在时为 null
```

未指定范围：

```text
下载 1..(firstVip - 1)
firstVip 为 1 或 N=0 -> QIDIAN_RANGE_UNAVAILABLE
```

指定 `startChapter..endChapter`：

```text
先校验 1 <= start <= end <= N
越界 -> QIDIAN_RANGE_INVALID

若 firstVip 存在且 firstVip <= end：
    下载 start..(firstVip - 1)
    start > firstVip - 1 -> QIDIAN_RANGE_UNAVAILABLE

否则：
    下载 start..end
```

执行规则：

- 按范围逐章抓取，每成功保存一章递增 `savedChapters`。
- 遇到目录标记或章节页确认的 VIP 章节立即停止。
- 停止前已下载至少一章时任务 `succeeded`，TXT 只包含已下载免费章节。
- 范围内没有可下载免费章节时任务 `failed`。
- 不使用逐章失败标记，不因为单个免费章失败后继续抓取。

`progress` 示例：

```json
{
  "chapterTotal": 49,
  "savedChapters": 49,
  "savePhase": "completed",
  "stoppedAtChapter": 50,
  "stopReason": "CHAPTER_VIP"
}
```

没有提前停止时不写 `stoppedAtChapter` 和 `stopReason`，或二者为 `null`。

## 任务状态、取消、超时与恢复

状态流转沿用现有模型：

```text
QUEUED -> RUNNING -> SUCCEEDED
                 -> FAILED
RUNNING -> CANCELING -> CANCELED
```

- `QUEUED` 取消：直接 `CANCELED`。
- `RUNNING` 取消：先 `CANCELING`，再调用 runner 的 `cancelJob`。
  - `fanqie`：取消 TomatoDownloader 外部任务。
  - `qidian`：终止本地抓取循环和进行中的章节请求。
- 已处于 `CANCELING`：返回当前状态。
- 终态任务取消：返回 `409 Conflict`。
- 超时继续使用现有 `TOMATO_DOWNLOAD_TASK_TIMEOUT_MS`。
- 起点任务超时后取消 runner，并标记 `DOWNLOAD_TIMEOUT`。

重启恢复：

- `fanqie` 继续使用现有 TomatoDownloader 恢复逻辑。
- `qidian` 任务不跨进程持久化；重启时发现未完成的起点任务标记为 `QIDIAN_JOB_LOST`。

## 错误码

通用错误码：

```text
DOWNLOAD_TIMEOUT
DOWNSTREAM_TASK_LOST
DOWNLOADER_REJECTED
ARTIFACT_NOT_FOUND
ARTIFACT_TOO_LARGE
ARTIFACT_INVALID
ARTIFACT_STORE_FAILED
```

起点错误码：

```text
QIDIAN_CATALOG_FETCH_FAILED
QIDIAN_CATALOG_PARSE_FAILED
QIDIAN_RANGE_INVALID
QIDIAN_RANGE_UNAVAILABLE
QIDIAN_CHAPTER_FETCH_FAILED
QIDIAN_CHAPTER_EMPTY
QIDIAN_CHAPTER_ENCRYPTED
QIDIAN_ACCESS_BLOCKED
QIDIAN_JOB_LOST
```

错误码使用稳定英文值，`error.message` 使用中文说明，例如：

```json
{
  "code": "QIDIAN_RANGE_UNAVAILABLE",
  "message": "起点第50章为VIP章节，范围内没有可下载的免费章节"
}
```

## TXT 产物格式

UTF-8 无 BOM，结构如下：

```text
书名
作者：作者名

第一章 章节名

正文第一段

正文第二段

第二章 章节名

...
```

文件名：

- 整本下载：`书名.txt`
- 范围下载：`书名_第start-end章.txt`
- 因 VIP 提前停止：使用实际下载到的范围，例如 `书名_第1-49章.txt`
- 继续使用现有 `displayFilename` 清理非法字符。

## 测试策略

单元测试：

- `QidianCatalogParser`：多卷、全局序号、`.chapter-locked`、空目录报错。
- `QidianChapterParser`：免费正文、VIP 检测、SSR 缺失、空正文、`cES=2` 报错。
- `QidianDownloadRunner`：默认遇 VIP 停止、指定范围、范围起点是 VIP、范围越界、无 VIP 全下载。
- `BookDownloadRunnerRegistry`：`fanqie/qidian` 映射，未知平台报错。
- `DownloadsService` 和 `DownloadsWorker`：使用 fake qidian runner 验证状态流转、取消、超时和成功产物发布。
- 现有番茄测试移动到 `runners/fanqie/` 后保持通过。

契约/E2E：

- 通用 `POST /v1/books/:platform/:bookId/downloads` 的 Swagger 编译和 DTO 校验。
- 下载 E2E 使用 mock runner，不访问真实起点或番茄网络。
- 起点 parser 使用 `test/fixtures/qidian/` 下的 HTML fixture。

验证命令：

```powershell
npm test
npm run lint
npm run build
npx tsc --noEmit --incremental false
git diff --check
```

真实起点页面只用于手工冒烟验证，不进入自动测试。

## 文档行为

- 更新 `docs/API.md`，新增起点下载示例、范围规则、VIP 停止行为和错误码。
- 更新 `docs/USAGE.md`，补充 `POST /v1/books/qidian/:bookId/downloads` 的完整流程。
- 明确起点只支持免费章节，不绕过 VIP，不处理字体加密。

## 风险与限制

- 起点页面结构和 SSR 字段可能改版，parser 需要 fixture 和真实页面双保险。
- 免费新章可能出现字体加密，第一版直接失败。
- 起点请求依赖现有 Playwright 浏览器客户端，首次启动或风控变化时延迟可能增加。
- 起点本地任务不跨进程恢复，服务重启后未完成任务标记为 `QIDIAN_JOB_LOST`。
