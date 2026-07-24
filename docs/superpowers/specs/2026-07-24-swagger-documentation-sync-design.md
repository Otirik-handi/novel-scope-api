# Swagger 文档入口同步设计

## 背景

NovelScope API V0.2.0 已在 `/api-docs` 注册 Swagger UI，并完成手动 API 验证。现有 README 仍只指向 `docs/API.md`，API 文档的范围说明还写着不提供 Swagger，Swagger 页面自身的版本则显示为 `1.0`。三处信息需要统一。

## 目标

- README 同时说明 Swagger 交互验证入口和 `docs/API.md` 的详细契约职责。
- 保留 `docs/API.md` 中的响应示例、错误语义、缓存和 stale 行为说明。
- Swagger 页面显示与项目一致的 `0.2.0` 版本。
- 不改变路由、请求参数、响应结构、采集、缓存或数据库行为。

## 变更设计

### README

在“API 与刷新行为”章节中：

- 将 Swagger UI 的默认地址写为 `http://localhost:3000/api-docs`，并说明端口随 `PORT` 配置变化。
- 将 Swagger 定位为交互式查看和执行接口的入口。
- 保留指向 `docs/API.md` 的链接，将其定位为完整响应示例、错误语义和缓存行为契约。
- 提醒使用 Swagger 执行刷新接口会访问外站并写入 `DATABASE_URL` 指向的数据库；书籍详情查询在缓存不存在或过期时也可能访问外站。
- 保留五个现有 API 路径和刷新行为摘要，避免 README 与详细 API 文档重复扩张。

### API 文档

保留 `docs/API.md` 文件和现有详细内容：

- 在约定部分增加 Swagger UI 入口说明。
- 从“V0.2.0 范围外”中删除“不提供 Swagger/OpenAPI 页面”的过时表述。
- 不把 Swagger 尚未表达完整的响应 Schema 和错误示例从本文件移除。

### Swagger 元数据

- 将 `DocumentBuilder.setVersion()` 从 `1.0` 改为 `0.2.0`。
- 同步更新 `src/main.spec.ts` 中的版本断言。
- 不新增响应 DTO、`ApiResponse` 装饰器或其他 Swagger 扩展。

## 验证

- 搜索并确认 README、API 文档和 Swagger 元数据对入口及版本的描述一致。
- 确认 `docs/API.md` 仍存在且 README 链接有效。
- 运行 `npm test`、`npm run lint`、`npm run build` 和 `npx tsc --noEmit --incremental false`。
- 运行 `git diff --check` 并检查提交只包含本设计范围内的文件。

## 交付

实施变更提交到本地 `main`。推送前先获取远端状态；若远端没有新增分叉，则将本地 `main` 推送到 `origin/main`。合并前保留的 stash 不在本次处理范围内，不删除或应用。
