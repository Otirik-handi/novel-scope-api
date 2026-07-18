# Novel Ranking API 接口文档

## 概览

Novel Ranking API 提供起点中文网与晋江文学城的榜单快照查询和刷新能力。查询接口只读取已保存的快照，不会触发采集；刷新接口会访问来源站点并更新快照。

默认服务地址为 `http://localhost:3000`。下文示例均以该地址为准。

## 认证

仅手动刷新接口需要认证。请求头必须携带与服务端 `API_KEY` 环境变量完全一致的值：

```http
X-API-Key: <API_KEY>
```

缺少该请求头、字段名错误或值不匹配时，接口返回 `401 Unauthorized`。

## 支持的榜单

| 平台 (`platform`) | 榜单标识 (`rank`) | `channel` |
| --- | --- | --- |
| `qidian` | `hotsales`、`yuepiao`、`signnewbook`、`newsign`、`newbook`、`pubnewbook`、`newauthor`、`recom`、`readindex`、`collect`、`sanjiang` | 不使用，不传即可 |
| `jjwxc` | `income`、`monthly`、`quarterly`、`completed`、`newcomer`、`thousandWords` | 可选；建议传字符串 `0` |

`platform` 与 `rank` 均为必填非空字符串。`platform` 仅允许 `qidian` 或 `jjwxc`。

## 健康检查

```http
GET /health
```

成功响应：

```json
{
  "status": "ok"
}
```

## 查询榜单快照

```http
GET /v1/rankings?platform={platform}&rank={rank}&channel={channel}
```

| 参数 | 位置 | 必填 | 说明 |
| --- | --- | --- | --- |
| `platform` | Query | 是 | 平台标识，取值见“支持的榜单”。 |
| `rank` | Query | 是 | 榜单标识，必须与对应平台匹配。 |
| `channel` | Query | 否 | 榜单频道。晋江通常使用 `0`。 |

起点热销榜示例：

```http
GET /v1/rankings?platform=qidian&rank=hotsales
```

晋江收益榜示例：

```http
GET /v1/rankings?platform=jjwxc&rank=income&channel=0
```

若不存在对应快照，返回 `503 Service Unavailable`：

```json
{
  "code": "SNAPSHOT_UNAVAILABLE",
  "key": {
    "platform": "jjwxc",
    "rank": "income",
    "channel": "0"
  }
}
```

## 手动刷新榜单

```http
POST /v1/admin/refresh
Content-Type: application/json
X-API-Key: <API_KEY>
```

请求体字段与查询接口相同。

起点热销榜请求体：

```json
{
  "platform": "qidian",
  "rank": "hotsales"
}
```

晋江收益榜请求体：

```json
{
  "platform": "jjwxc",
  "rank": "income",
  "channel": "0"
}
```

刷新成功时，接口返回状态为 `fresh` 的快照并持久化到本地。采集失败但已有旧快照时，接口返回旧数据并将状态标记为 `stale`，同时给出 `lastError`；旧快照不会被失败结果覆盖。若不存在旧快照，刷新请求会返回错误响应。

## 快照响应

查询和刷新成功后均返回以下结构：

```json
{
  "platform": "qidian",
  "rank": "hotsales",
  "channel": null,
  "sourceUrl": "https://m.qidian.com/rank/hotsales/",
  "fetchedAt": "2026-07-18T04:00:00.000Z",
  "status": "fresh",
  "items": [
    {
      "rank": 1,
      "bookId": "123456",
      "title": "示例作品",
      "author": "示例作者",
      "genres": ["玄幻"],
      "status": null,
      "wordCount": 123000,
      "description": "作品简介",
      "metrics": { "rankValue": 1000 },
      "url": "https://m.qidian.com/book/123456/"
    }
  ]
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `platform` | string | 来源平台。 |
| `rank` | string | 榜单标识。 |
| `channel` | string \| null | 榜单频道；未传时为 `null`。 |
| `sourceUrl` | string | 采集来源页面地址。 |
| `fetchedAt` | string | 最近一次成功采集时间，ISO 8601 格式。 |
| `status` | `fresh` \| `stale` | 快照状态。 |
| `lastError` | string，可选 | 仅在 `stale` 时表示最近一次刷新失败原因。 |
| `items` | array | 榜单作品列表。 |

### 作品字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `rank` | number | 榜单名次。 |
| `bookId` | string | 来源站点作品 ID。 |
| `title` | string | 作品标题。 |
| `author` | string | 作者名称。 |
| `genres` | string[] | 分类列表。 |
| `status` | string \| null | 连载状态；来源不可用时为 `null`。 |
| `wordCount` | number \| null | 字数；来源不可用时为 `null`。 |
| `description` | string \| null | 作品简介；来源不可用时为 `null`。 |
| `metrics` | object | 站点提供的指标，具体字段因平台而异。 |
| `url` | string | 作品详情页地址。 |

## 常见错误

| HTTP 状态 | 场景 | 处理建议 |
| --- | --- | --- |
| `400` | 缺少参数、`platform` 非法或 `rank` 为空。 | 按接口参数要求修正请求。 |
| `401` | 刷新请求未提供有效的 `X-API-Key`。 | 检查请求头与服务端 `API_KEY` 是否完全一致。 |
| `503` | 查询时尚未存在对应快照。 | 先调用手动刷新接口，或等待定时任务完成。 |
| `5xx` | 来源站点访问、页面解析或快照写入失败，且没有旧快照可返回。 | 稍后重试；如持续发生，请检查服务端日志。 |

## 使用建议

- 业务读取优先使用 `GET /v1/rankings`，避免每次请求都触发站点采集。
- 将 `status: "stale"` 视为可用但非最新的数据，并记录 `lastError` 以便排查。
- 不要将 `API_KEY` 放入前端代码、公开仓库或浏览器地址栏。
