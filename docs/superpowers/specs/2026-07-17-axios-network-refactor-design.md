# Axios 网络请求重构设计

## 目标

将起点和晋江 provider 对全局 `fetch` 的直接依赖替换为 Axios，同时集中管理采集请求的超时、浏览器风格 `User-Agent` 和错误归一化。榜单快照、URL 映射、HTML 解析和刷新语义保持不变。

## 方案

新增可由 NestJS 注入的 `RankingHttpClient`。该客户端内部通过 `axios.create()` 创建唯一的 Axios 实例，并固定以下默认值：

- 超时：10 秒。
- `User-Agent`：稳定的现代 Chrome 浏览器标识字符串，不随机生成。
- `responseType`：`arraybuffer`，以原始字节返回所有页面。

客户端对外只暴露取得页面字节的方法，返回 `Buffer`。起点 provider 用 UTF-8 将字节转为文本；晋江榜单页也以 UTF-8 解析，详情页继续交给 `iconv-lite` 按 GB18030 解码。这样不会改变晋江中文详情的解码行为。

## 错误处理

Axios 默认将非 2xx 响应视为失败。客户端捕获 `AxiosError`，统一转换为 `HttpRequestError`，错误信息包含请求 URL，以及可用时的 HTTP 状态码或 Axios 错误码和原因。非 Axios 异常同样包装为该错误，保留原始异常作为 `cause`。

provider 不再检查 `Response.ok`。起点榜单请求或晋江榜单请求失败时，错误向上抛给刷新协调器，保留既有的快照回退策略。晋江每本书的详情请求仍在 provider 内捕获；单本详情失败时保留该榜单条目及其空的详情字段。

## 依赖与装配

在生产依赖中加入 `axios`。`RankingsModule` 注册 `RankingHttpClient`，并通过构造函数向两个 provider 注入。单元测试可向 provider 或客户端传入轻量的 HTTP 替身，不需要真实网络访问。

## 测试

- 客户端测试覆盖 10 秒超时、浏览器 `User-Agent`、`arraybuffer` 响应到 `Buffer` 的转换。
- 客户端测试覆盖网络错误、超时和非 2xx 响应被规范化为 `HttpRequestError`。
- 两个 provider 测试改为注入字节响应替身，继续覆盖榜单解析、URL 映射、无效榜单不发请求。
- 晋江测试继续验证 GB18030 详情解码，以及详情请求失败不会中断榜单。
- 执行现有全量测试、类型检查和构建，确认 API 与快照行为未回归。

## 非目标

本次不增加重试、代理、请求限流、随机 UA、Cookie 管理或采集策略调整。这些行为会扩大目标站点访问策略的变化，不属于等价网络层重构。
