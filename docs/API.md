# NovelScope API V0.1

## 约定

- 基础路径：`/v1`
- V0.1 只支持平台 `qidian`。
- 榜单类型：`yuepiao`（月票）、`hotsales`（畅销）、`recom`（推荐）、`collect`（收藏）。
- `bookId` 必须是起点的纯数字书籍 ID。
- 成功响应直接返回资源，不使用 `data` 包装层。
- 日期时间使用 ISO 8601 字符串。

## 查询最新榜单

```http
GET /v1/rankings/:platform/:rankType
```

该接口只查询最近一次成功保存的快照，不触发采集。条目按 `rank` 升序返回。

成功响应（`200`，示例只展示一个条目）：

```json
{
  "id": "6a7dbdbc-6011-44e7-bc14-f11ac4977001",
  "platform": "qidian",
  "rankType": "yuepiao",
  "sourceUrl": "https://www.qidian.com/rank/yuepiao/",
  "fetchedAt": "2026-07-20T06:00:00.000Z",
  "createdAt": "2026-07-20T06:00:01.000Z",
  "items": [
    {
      "id": "8b8d9957-c36b-4a0e-98f0-4e5696bef001",
      "snapshotId": "6a7dbdbc-6011-44e7-bc14-f11ac4977001",
      "bookId": "ae081572-9484-4dd0-ae9a-16ce31013001",
      "rank": 1,
      "externalBookId": "1031940621",
      "title": "作品标题",
      "author": "作者名称",
      "coverUrl": "https://bookcover.yuewen.com/example.jpg",
      "sourceUrl": "https://www.qidian.com/book/1031940621/",
      "metrics": {}
    }
  ]
}
```

> V0.1 榜单 `metrics` 返回空对象。起点使用自定义字体（`hqwWDMYz`）将月票数等数值编码为不可读字符，HTML 文本解析无法还原。

没有已保存快照时返回 `404`：

```json
{
  "statusCode": 404,
  "message": "Ranking snapshot not found",
  "error": "Not Found"
}
```

## 刷新单个榜单

```http
POST /v1/rankings/:platform/:rankType/refresh
```

同步采集指定榜单。只有得到 10 个唯一、完整的条目时才以一个事务新增快照。成功返回 `201`，响应结构与"查询最新榜单"相同。

采集、解析、完整性校验或持久化失败时返回安全的 `502`，不会返回上游异常详情：

```json
{
  "statusCode": 502,
  "message": "Failed to refresh ranking",
  "error": "Bad Gateway"
}
```

## 刷新全部榜单

```http
POST /v1/rankings/:platform/refresh
```

按 `yuepiao`、`hotsales`、`recom`、`collect` 顺序串行刷新。单个榜单失败不会中止后续榜单；请求本身成功完成时返回 `201` 和严格的四项结果。

部分失败示例（成功项的 `snapshot` 结构与最新榜单相同）：

```json
[
  {
    "rankType": "yuepiao",
    "success": true,
    "snapshot": {
      "id": "6a7dbdbc-6011-44e7-bc14-f11ac4977001",
      "platform": "qidian",
      "rankType": "yuepiao",
      "sourceUrl": "https://www.qidian.com/rank/yuepiao/",
      "fetchedAt": "2026-07-20T06:00:00.000Z",
      "createdAt": "2026-07-20T06:00:01.000Z",
      "items": []
    }
  },
  {
    "rankType": "hotsales",
    "success": false,
    "error": "RANKING_REFRESH_FAILED"
  },
  {
    "rankType": "recom",
    "success": true,
    "snapshot": {
      "id": "13a848df-6f27-4e84-908b-ec9b83ed3001",
      "platform": "qidian",
      "rankType": "recom",
      "sourceUrl": "https://www.qidian.com/rank/recom/",
      "fetchedAt": "2026-07-20T06:00:02.000Z",
      "createdAt": "2026-07-20T06:00:03.000Z",
      "items": []
    }
  },
  {
    "rankType": "collect",
    "success": true,
    "snapshot": {
      "id": "4213f078-8368-4f33-b128-cc682b68d001",
      "platform": "qidian",
      "rankType": "collect",
      "sourceUrl": "https://www.qidian.com/rank/collect/",
      "fetchedAt": "2026-07-20T06:00:04.000Z",
      "createdAt": "2026-07-20T06:00:05.000Z",
      "items": []
    }
  }
]
```

示例中的 `items` 为节省篇幅而省略；真实成功快照始终包含 10 条记录。

## 查询书籍详情

```http
GET /v1/books/:platform/:bookId
```

缓存存在且未过期时直接返回，不访问起点。缓存不存在或已过期时同步采集并保存最近一次成功结果。

成功响应（`200`）：

```json
{
  "bookId": "ae081572-9484-4dd0-ae9a-16ce31013001",
  "platform": "qidian",
  "externalBookId": "1031940621",
  "title": "作品标题",
  "author": "作者名称",
  "description": "规范化后的作品简介",
  "coverUrl": "https://bookcover.yuewen.com/example.jpg",
  "genres": ["玄幻", "东方玄幻"],
  "bookStatus": "连载",
  "wordCount": 1234567,
  "metadata": {
    "datePublished": "2022-10-07T18:08:41+08:00",
    "dateModified": "2026-07-20T20:03:54+08:00",
    "totalRecommendations": 6335600,
    "weeklyRecommendations": 11200
  },
  "sourceUrl": "https://www.qidian.com/book/1031940621/",
  "fetchedAt": "2026-07-20T06:00:00.000Z",
  "expiresAt": "2026-07-20T09:00:00.000Z",
  "stale": false
}
```

V0.1 从以下来源提取数据：
- **JSON-LD** 结构化脚本（`application/ld+json`）：书名、作者、简介、封面、分类、发布日期
- **OG meta 标签**：作品状态
- **DOM 选择器**：字数（`p.count > em:first-of-type`）、总推荐、周推荐（`p.count` 内后续 `<em>` 元素）、更新时间（`span.update-time`）

过期详情刷新失败时仍返回 `200` 和旧数据，`stale` 为 `true`。失败不会覆盖旧行，`fetchedAt`、`expiresAt` 和其他详情字段保持最近一次成功值。

首次采集失败且没有缓存时返回 `502`：

```json
{
  "statusCode": 502,
  "message": "Failed to fetch book detail",
  "error": "Bad Gateway"
}
```

## 强制刷新书籍详情

```http
POST /v1/books/:platform/:bookId/refresh
```

跳过 TTL 缓存检查，直接触发 Playwright 采集并覆盖数据库记录。响应结构与"查询书籍详情"成功响应一致。采集或校验失败返回 `502`。

## 参数错误

不支持的平台、榜单类型或非纯数字 `bookId` 返回 `400`。NestJS 会以数组形式列出具体 DTO 校验消息，例如：

```json
{
  "statusCode": 400,
  "message": ["bookId must match /^\\d+$/ regular expression"],
  "error": "Bad Request"
}
```

V0.1 不提供榜单历史查询、Swagger/OpenAPI 页面、API Key 鉴权或自定义错误包装。
