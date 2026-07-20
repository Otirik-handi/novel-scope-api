# Novel Ranking API V0.1

服务地址默认为 `http://localhost:3000`。详细字段、参数约束和错误响应以非生产环境的 `/api-docs` 或 `/api-docs-json` 为准。

## 通用约定

- V0.1 的 `platform` 固定为 `qidian`。
- 支持的 `rankType`：`hotsales`、`yuepiao`、`recom`、`collect`。
- 所有时间均为带 `Z` 的 UTC ISO 8601 字符串。
- 公共榜单接口每个客户端 IP 每分钟 60 次；书籍详情接口每分钟 10 次。
- 需要认证的刷新接口不使用公共 IP 限流。

错误响应统一包含以下字段：

```json
{
  "statusCode": 404,
  "code": "RANKING_SNAPSHOT_NOT_FOUND",
  "message": "Ranking snapshot not found",
  "requestId": "..."
}
```

## 健康检查

```http
GET /health/live
GET /health/ready
```

`/health/live` 仅确认进程响应。`/health/ready` 会确认 PostgreSQL 可用，绝不访问目标站。

## 榜单查询

```http
GET /v1/rankings/qidian/hotsales
```

接口只返回最新成功快照。没有成功快照时返回 `404 RANKING_SNAPSHOT_NOT_FOUND`，不会自动触发采集。

## 榜单历史

```http
GET /v1/rankings/qidian/hotsales/history?from=2026-07-18T00:00:00.000Z&to=2026-07-19T00:00:00.000Z&limit=20&cursor=...
```

`from` 和 `to` 为带时区的闭区间；`limit` 默认 20、最大 100。结果按 `fetchedAt DESC, id DESC` 排序，响应中的 `nextCursor` 为下一页游标；末页为 `null`。

## 手动刷新

刷新接口必须携带 `X-API-Key`：

```http
X-API-Key: <REFRESH_API_KEY>
```

```http
POST /v1/rankings/qidian/hotsales/refresh
POST /v1/rankings/qidian/refresh
```

单榜刷新成功时创建不可变历史快照。全量刷新逐榜返回 `success`、`failed` 或 `skipped`：全部成功为 `200`，部分成功或跳过为 `207`，全部失败为 `502`。相同榜单已有刷新时，单榜接口返回 `409 REFRESH_IN_PROGRESS`。

## 书籍详情

```http
GET /v1/books/qidian/1035420986
```

首次查询或详情过期时会同步采集。未过期数据直接返回；刷新失败而旧数据存在时返回 `200` 和 `stale: true`。没有旧数据时，上游失败返回 `502 BOOK_DETAIL_FETCH_FAILED`，刷新预算耗尽返回 `504 BOOK_DETAIL_FETCH_TIMEOUT`。
