# Novel Ranking API

## 项目简介

Novel Ranking API 是一个基于 NestJS 的小说榜单快照服务，聚合起点中文网与晋江文学城的榜单数据。服务将采集结果保存为本地 JSON 快照，并通过内存缓存提供稳定查询。

查询接口只读取已有快照，不会隐式触发网站采集。榜单可由定时任务每六小时刷新，或通过受 API Key 保护的管理接口手动刷新。数据来源不是实时数据，也不是官方公开 API；页面结构、访问可用性及服务条款均可能变化。

## 环境要求

- Node.js 20 或更高版本
- npm

可通过 `.env` 配置以下环境变量。可从 `.env.example` 复制开始：

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `API_KEY` | 是 | 无 | 手动刷新接口的访问密钥。 |
| `SNAPSHOT_DIR` | 否 | `data/snapshots` | JSON 快照保存目录。 |
| `PORT` | 否 | `3000` | HTTP 服务监听端口。 |

## 部署方法

安装依赖：

```powershell
npm install
```

创建 `.env` 并设置一个足够随机的 API Key：

```dotenv
API_KEY=replace-with-a-long-random-secret
SNAPSHOT_DIR=data/snapshots
PORT=3000
```

定时刷新清单使用与 `.env` 同级的必需文件 `refresh-rankings.json`。服务仅在启动时读取该文件；修改后必须重启。文件缺失、JSON 无效或配置字段不合法时，服务会启动失败，避免以未知刷新范围运行。

```json
{
  "cron": "0 0 */6 * * *",
  "targetConcurrency": 1,
  "jjwxcDetailConcurrency": 4,
  "targets": [
    { "platform": "qidian", "rank": "hotsales" },
    { "platform": "jjwxc", "rank": "income", "channel": "0" }
  ]
}
```

`cron` 是全局六字段 Cron 表达式；`targetConcurrency` 限制同时刷新的榜单数；`jjwxcDetailConcurrency` 限制单个晋江榜单同时请求的作品详情数。`targets` 至少包含一项，晋江目标必须显式指定字符串 `channel`，起点目标不使用频道。可按需将已支持的榜单和频道加入清单。

开发环境启动：

```powershell
npm run start:dev
```

构建并以生产模式启动：

```powershell
npm run build
npm run start
```

快照默认写入 `data/snapshots`。仓库初始清单每六小时刷新起点 `hotsales` 与晋江 `income`（频道 `0`）榜单；刷新失败时不会覆盖最近一次成功快照，已有数据会以 `stale` 状态返回。

## API 简介

完整的请求参数、响应结构、错误响应和使用示例请参阅 [接口文档](docs/API.md)。

### 健康检查

```http
GET /health
```

返回服务可用状态，不触发采集：

```json
{ "status": "ok" }
```

### 查询榜单

```http
GET /v1/rankings?platform=qidian&rank=hotsales
GET /v1/rankings?platform=jjwxc&rank=income&channel=0
```

参数说明：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `platform` | 是 | `qidian` 或 `jjwxc`。 |
| `rank` | 是 | 对应平台支持的非空榜单标识。 |
| `channel` | 否 | 榜单频道；晋江默认使用 `0`。 |

成功响应为榜单快照。`sourceUrl` 表示数据来源页，`fetchedAt` 表示最近采集时间，`status` 为 `fresh` 或 `stale`。当刷新失败但存在旧快照时，响应会保留旧数据、返回 `stale`，并在 `lastError` 中给出失败原因。尚无可用快照时接口返回 `503`。

### 手动刷新榜单

```http
POST /v1/admin/refresh
X-API-Key: <API_KEY>
Content-Type: application/json

{
  "platform": "qidian",
  "rank": "hotsales"
}
```

请求体字段与查询接口相同。请求必须携带与 `API_KEY` 一致的 `X-API-Key`，否则返回 `401`。刷新成功后返回最新快照；刷新失败时会保留已有快照，而不会以失败结果覆盖它。
