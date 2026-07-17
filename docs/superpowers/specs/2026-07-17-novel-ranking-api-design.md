# 小说榜单聚合 API 设计

## 目标

构建独立的 Node.js、TypeScript 和 NestJS 服务，聚合起点中文网与晋江文学城的榜单数据。服务基于本地定时快照提供稳定接口，而不是在每次客户端请求时即时抓取目标网站。

现有 `oh-story-claudecode` 项目仅作为参考资料。本服务不会修改或在运行时引入其代码。

## 范围

最小可行版本包含：

- 从起点移动端 SSR 页面采集榜单。
- 采集晋江榜单列表及作品详情指标。
- 统一的榜单响应数据模型。
- 每六小时定时刷新，以及经鉴权的手动刷新接口。
- JSON 文件快照、内存缓存、过期数据标识和健康检查。
- 覆盖接口契约和解析行为的单元测试、HTTP 层测试。

最小可行版本不包含番茄、七猫、刺猬猫、浏览器 CDP、浏览器池、历史趋势数据库、用户账户、限流和多租户访问控制。

## 架构

```text
定时任务 / 经鉴权的刷新请求
              |
        平台采集适配器
          |           |
      起点 SSR      晋江 HTML
              |
        统一榜单快照
              |
    JSON 文件存储与内存缓存
              |
      NestJS HTTP 控制器
```

`RankingProvider` 是平台边界。每个适配器负责校验支持的榜单标识、请求源页面、解析平台特有数据，并返回统一快照。应用服务负责刷新协调、持久化、缓存加载和过期数据处理。

起点适配器请求 `m.qidian.com` 榜单页面，解析 `script#vite-plugin-ssr_pageContext` 中的 JSON。晋江适配器请求 `topten.php`，并请求 `onebook.php` 补齐收藏数、营养液、积分、字数和连载状态，使用 GB18030 解码。

调度器每六小时刷新已配置榜单。刷新失败绝不覆盖最近一次成功快照。服务启动时从本地数据目录加载快照；若尚未有快照，首次查询不会隐式触发采集，而是明确返回不可用，直到定时任务或受保护的刷新接口成功。

## 对外 API

### 查询榜单

`GET /v1/rankings?platform={platform}&rank={rank}&channel={channel}`

示例：

```text
GET /v1/rankings?platform=qidian&rank=hotsales
GET /v1/rankings?platform=jjwxc&rank=income&channel=0
```

`channel` 对起点可选；晋江默认值为 `0`。

成功响应结构：

```json
{
  "platform": "qidian",
  "rank": "hotsales",
  "channel": null,
  "sourceUrl": "https://m.qidian.com/rank/hotsales/",
  "fetchedAt": "2026-07-17T12:00:00.000Z",
  "status": "fresh",
  "items": [
    {
      "rank": 1,
      "bookId": "123",
      "title": "示例作品",
      "author": "示例作者",
      "genres": ["玄幻", "东方玄幻"],
      "status": "连载中",
      "wordCount": null,
      "description": "作品简介",
      "metrics": { "rankValue": "..." },
      "url": "https://m.qidian.com/book/123/"
    }
  ]
}
```

`status` 在定时或手动刷新成功后为 `fresh`；若新的刷新失败但存在较早快照，则为 `stale`。过期响应包含 `lastError`。

### 手动刷新榜单

`POST /v1/admin/refresh`

请求必须携带与环境变量 `API_KEY` 匹配的 `X-API-Key`。

```json
{ "platform": "qidian", "rank": "hotsales", "channel": "0" }
```

### 健康检查

`GET /health` 返回服务可用状态，不触发采集。

## 错误处理

- 无效或不受支持的查询参数返回 `400`。
- 未知的平台或榜单返回 `404`。
- 不存在任何快照时返回 `503`，并提供机器可读的不可用原因。
- 刷新接口缺少或使用无效 API 密钥时返回 `401`。
- 适配器请求或解析失败会按快照键记录错误，且不会替换已有数据。

## 持久化

快照保存为 `data/snapshots/{platform}--{rank}--{channel}.json`。每个文件保存统一响应和刷新元数据。通过临时文件写入后重命名的方式实现原子替换，避免对外提供不完整快照。

## 测试

- 适配器单元测试使用保存的起点 SSR、晋江榜单与晋江详情 HTML fixture。
- 应用服务测试覆盖刷新成功、快照持久化和刷新失败后的过期回退。
- 控制器测试验证查询参数、响应状态、无快照响应和 API 密钥鉴权。

## 运行约束

源页面不是有文档保障的公开 API。页面结构、访问限制和服务条款都可能变化。服务必须以保守的定时策略采集，在每个响应中标识来源 URL 和采集时间，并避免宣称数据是实时数据。
