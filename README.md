# Novel Ranking API

基于 NestJS、Prisma 和 PostgreSQL 的起点中文网榜单快照服务。V0.1 仅支持起点的月票、畅销、推荐和收藏榜；查询接口只读取数据库中已成功持久化的快照，不会隐式采集上游网站。

## 运行要求

- Node.js 20+
- PostgreSQL 14+
- 具备目标站允许使用的公开访问渠道

## 本地启动

1. 复制 `.env.example` 为 `.env`，填写 `DATABASE_URL`、`REFRESH_API_KEY` 和稳定的 `QIDIAN_USER_AGENT`。
2. 安装依赖并生成 Prisma Client：

```powershell
npm ci
npm run db:generate
```

3. 在空数据库应用已提交迁移：

```powershell
npm run db:migrate:deploy
```

4. 启动开发服务：

```powershell
npm run start:dev
```

应用不会在启动时采集。服务就绪后，使用 API Key 调用 `POST /v1/rankings/qidian/refresh` 初始化全部榜单。

## 配置

`DATABASE_URL`、`REFRESH_API_KEY` 与 `QIDIAN_USER_AGENT` 必填，缺失或格式非法时应用会拒绝启动。其余可选项和默认值见 [`.env.example`](.env.example)。

- 起点请求最多同时运行 2 个，连续请求最少间隔 1 秒。
- 单个 HTTP 请求默认超时 10 秒；网络错误、408、429 和 5xx 最多重试 2 次。
- 榜单每天 06:00（`Asia/Shanghai`）刷新，单个榜单失败不会阻塞其他榜单。
- 书籍详情默认 3 小时过期；刷新失败时返回上一次成功数据并标记 `stale: true`。

## 开发验证

```powershell
npm test
npm run lint
npm run build
```

连接到可创建和删除数据库的开发 PostgreSQL 后，可运行真实迁移、约束、索引和 advisory lock 集成测试。该命令会从当前目录的 `.env` 读取 `DATABASE_URL`，创建随机临时库、执行迁移并在结束后删除它：

```powershell
$env:RUN_DATABASE_INTEGRATION_TESTS='true'
npm run test:db
```

## 文档与部署

非生产环境提供 `/api-docs` 和 `/api-docs-json`。接口概览、认证和调用示例见 [docs/API.md](docs/API.md)，字段与错误细节以 OpenAPI 为准。

部署顺序为：执行 `npm run db:migrate:deploy`、启动应用、确认 `GET /health/ready` 返回 200、再由受控运维调用全量刷新接口。生产环境设置 `NODE_ENV=production` 后不会暴露 OpenAPI 页面。
