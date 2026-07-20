# 项目名称

Novel Ranking API

## 项目简介

基于 NestJS 的小说榜单快照服务，聚合起点中文网榜单数据。服务通过定时任务或受 API Key 保护的手动刷新采集数据，并以 PostgreSQL 快照提供稳定查询；查询接口不会隐式触发网站采集。

## 项目结构

```text
novel-ranking-api/
|-- src/
|   |-- api/                     // 控制器、DTO、鉴权和异常响应
|   |-- axios/                   // Axios 请求客户端、重试和限速
|   |-- crawlers/qidian/
|   |   |-- rank/                // 起点榜单采集与解析
|   |   |   `-- book/            // 起点书籍详情采集与解析
|   |-- db/                      // Prisma、持久化存储和 advisory lock
|   |-- types/                   // 领域模型和共享类型
|   |-- services/                // 刷新、详情、调度和日志清理服务
|   |-- config/                  // 环境变量校验
|   `-- *.ts                     // 应用启动、模块和通用控制器
|-- test/                        // E2E 测试与固定 HTML fixtures
|-- prisma/                      // Prisma schema 与迁移
|-- docs/                        // 设计说明与实施计划
|-- package*.json                // Node.js 依赖、脚本和锁文件
`-- AGENTS.md                    // 项目协作与开发约束
```

## 常用命令

```powershell
npm ci
npm run db:generate
npm run start:dev
npm test
npm run lint
npm run build
```

## Agent 必须遵守的约束

- 与用户沟通默认使用中文。
- 文档撰写默认使用中文。
- 读取和编辑文本文件时优先使用 UTF-8 编码。
- 实现功能前必须评估成熟的第三方库；无论是否采用，都必须先向用户说明实现思路与取舍。例如网络采集应优先评估 Axios。
