# NovelScope API V0.2.1

## 约定

- 基础路径：`/v1`。
- 应用启动后可通过 `/api-docs` 使用 Swagger UI 交互式查看和执行接口；本文档保留完整响应示例、错误语义和缓存行为说明。
- 支持平台 `qidian`（起点中文网）和 `fanqie`（番茄小说）。
- 榜单路径末段是平台目录中的机器键 `rankTypeKey`。起点仍使用 `yuepiao`、`hotsales`、`recom`、`collect`；番茄键形如 `0_1_1139`。
- `bookId` 必须是对应平台的纯数字书籍 ID。
- 成功响应直接返回资源，不使用 `data` 包装层；日期时间使用 ISO 8601 字符串。
- 榜单快照和全量刷新结果同时返回机器键 `rankTypeKey` 与中文展示名 `rankType`。

## 查询最新榜单

```http
GET /v1/rankings/:platform/:rankTypeKey
```

该接口只读取最近一次成功保存的不可变快照，不触发采集。条目按 `rank` 升序返回。

番茄示例：

```http
GET /v1/rankings/fanqie/0_1_1139
```

成功响应（`200`，示例只展示一个条目）：

```json
{
  "id": "6a7dbdbc-6011-44e7-bc14-f11ac4977001",
  "platform": "fanqie",
  "rankTypeKey": "0_1_1139",
  "rankType": "女频-新书榜-古风世情",
  "sourceUrl": "https://fanqienovel.com/rank/0_1_1139",
  "fetchedAt": "2026-07-24T00:30:00.000Z",
  "createdAt": "2026-07-24T00:30:01.000Z",
  "items": [
    {
      "id": "8b8d9957-c36b-4a0e-98f0-4e5696bef001",
      "snapshotId": "6a7dbdbc-6011-44e7-bc14-f11ac4977001",
      "bookId": "ae081572-9484-4dd0-ae9a-16ce31013001",
      "rank": 1,
      "externalBookId": "7420000000000000000",
      "title": "作品标题",
      "author": "作者名称",
      "coverUrl": "https://example.com/cover.jpg",
      "sourceUrl": "https://fanqienovel.com/page/7420000000000000000",
      "metrics": {
        "readCount": 123456,
        "wordCount": 789000,
        "creationStatus": "连载中",
        "lastChapterTitle": "最新章节",
        "category": "古风世情"
      }
    }
  ]
}
```

番茄 `metrics` 可能包含 `readCount`、`wordCount`、`creationStatus`、`lastChapterTitle`、`category`，上游未提供的可选字段会省略。起点榜单目前返回空 `metrics`，因为自定义字体编码使榜单数值无法可靠还原。

合法榜单键没有已保存快照时返回 `404`，未登记的榜单键返回 `400`。

## 刷新单个榜单

```http
POST /v1/rankings/:platform/:rankTypeKey/refresh
```

例如：

```http
POST /v1/rankings/fanqie/0_1_1139/refresh
```

接口同步采集指定榜单。只有得到 10 个排名为 1-10、书号唯一且必填字段完整的条目时，才以一个事务新增快照。成功返回 `201`，结构与最新榜单相同。

采集、解析、完整性校验或持久化失败时返回安全的 `502`，不会向客户端暴露上游响应或内部错误：

```json
{
  "statusCode": 502,
  "message": "Failed to refresh ranking",
  "error": "Bad Gateway"
}
```

## 刷新平台全部榜单

```http
POST /v1/rankings/:platform/refresh
```

接口按平台静态目录顺序串行刷新：起点为 4 个榜单，番茄为 74 个榜单。单个榜单失败不会中止后续任务。成功项和失败项都包含 `rankTypeKey`、`rankType`；失败项只暴露固定错误码：

```json
[
  {
    "rankTypeKey": "0_1_1139",
    "rankType": "女频-新书榜-古风世情",
    "success": true,
    "snapshot": {
      "id": "6a7dbdbc-6011-44e7-bc14-f11ac4977001",
      "platform": "fanqie",
      "rankTypeKey": "0_1_1139",
      "rankType": "女频-新书榜-古风世情",
      "sourceUrl": "https://fanqienovel.com/rank/0_1_1139",
      "fetchedAt": "2026-07-24T00:30:00.000Z",
      "createdAt": "2026-07-24T00:30:01.000Z",
      "items": []
    }
  },
  {
    "rankTypeKey": "0_2_1139",
    "rankType": "女频-阅读榜-古风世情",
    "success": false,
    "error": "RANKING_REFRESH_FAILED"
  }
]
```

示例省略了成功快照的条目；真实成功快照始终包含 10 条记录。

## 查询书籍详情

```http
GET /v1/books/:platform/:bookId
```

缓存存在且未过期时直接返回，不访问外站。缓存不存在或已过期时同步采集并 upsert 最近一次成功结果。

番茄数字书号示例：

```http
GET /v1/books/fanqie/7420000000000000000
```

成功响应（`200`）：

```json
{
  "bookId": "ae081572-9484-4dd0-ae9a-16ce31013001",
  "platform": "fanqie",
  "externalBookId": "7420000000000000000",
  "title": "作品标题",
  "author": "作者名称",
  "description": "规范化后的作品简介",
  "coverUrl": "https://example.com/cover.jpg",
  "genres": ["古风世情"],
  "bookStatus": "连载中",
  "wordCount": 789000,
  "metadata": {},
  "sourceUrl": "https://fanqienovel.com/page/7420000000000000000",
  "fetchedAt": "2026-07-24T00:31:00.000Z",
  "expiresAt": "2026-07-24T03:31:00.000Z",
  "stale": false
}
```

过期详情刷新失败时仍返回 `200` 和最近一次成功数据，`stale` 为 `true`。失败不会覆盖旧行。首次采集失败且没有缓存时返回 `502`。

## 强制刷新书籍详情

```http
POST /v1/books/:platform/:bookId/refresh
```

例如：

```http
POST /v1/books/fanqie/7420000000000000000/refresh
```

该接口跳过 TTL 检查并同步采集。成功时 upsert 详情并返回 `stale: false`；失败时返回安全的 `502`，且不会覆盖最近一次成功数据。

## 创建番茄正文下载任务

```http
POST /v1/books/fanqie/:bookId/downloads
```

空对象下载整本：

```json
{}
```

也可指定 1-based 闭区间：

```json
{
  "startChapter": 20,
  "endChapter": 30
}
```

两个范围字段必须同时省略或同时提供，并满足 `1 <= startChapter <= endChapter`。成功返回 `202 Accepted`；每次调用创建独立任务，不做去重。

## 查询正文下载任务

```http
GET /v1/downloads/:downloadId
```

成功响应示例：

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "platform": "fanqie",
  "externalBookId": "7069948840148732967",
  "format": "txt",
  "range": { "startChapter": 20, "endChapter": 30 },
  "status": "succeeded",
  "progress": { "chapterTotal": 11, "savedChapters": 11, "groupTotal": 1, "groupDone": 1, "savePhase": "TextSave" },
  "artifact": {
    "filename": "作品标题_第20-30章.txt",
    "sizeBytes": 45678,
    "sha256": "64位十六进制哈希",
    "downloadUrl": "/v1/downloads/11111111-1111-4111-8111-111111111111/file"
  },
  "error": null,
  "createdAt": "2026-07-26T10:00:00.000Z",
  "startedAt": "2026-07-26T10:00:01.000Z",
  "finishedAt": "2026-07-26T10:00:20.000Z",
  "updatedAt": "2026-07-26T10:00:20.000Z"
}
```

状态为 `queued`、`running`、`canceling`、`succeeded`、`failed` 或 `canceled`。失败任务只返回稳定错误码和安全消息，不包含 Downloader 密码、响应正文或内部路径。

## 下载 TXT

```http
GET /v1/downloads/:downloadId/file
```

仅 `succeeded` 任务返回 `text/plain; charset=utf-8`。文件大小上限为 256 MiB，并附带 UTF-8 `Content-Disposition`。任务未成功时返回 `409`；记录成功但文件丢失时返回 `410`。

## 取消和删除正文任务

```http
POST   /v1/downloads/:downloadId/cancel
DELETE /v1/downloads/:downloadId
```

- queued 任务取消后立即成为 `canceled`。
- running 任务先成为 `canceling`；取消竞态中下游已经完成时仍可能成为 `succeeded`。
- 只能删除 `succeeded/failed/canceled` 任务；成功返回 `204` 并移除 NovelScope TXT。
- 终态任务和 TXT 默认永久保留，直到调用 DELETE。

## 错误语义

- `400 Bad Request`：平台、榜单机器键或书号形状不受支持。
- `404 Not Found`：榜单键合法，但数据库中还没有成功快照。
- `409 Conflict`：任务状态不允许下载、取消或删除。
- `410 Gone`：任务声明成功，但 NovelScope artifact 已丢失。
- `502 Bad Gateway`：采集、解析、完整性校验或持久化失败；响应不包含上游敏感信息。
- 详情 TTL 过期且刷新失败：存在旧缓存时返回 `200` 与 `stale: true`，不存在缓存时返回 `502`。

## V0.2.1 范围外

V0.2.1 不提供榜单历史查询、番茄分类远程发现、跨平台书籍去重、任务列表、用户归属、写操作鉴权或自定义响应包装。部署时应在反向代理或网络边界限制刷新、下载创建、取消和删除端点。
