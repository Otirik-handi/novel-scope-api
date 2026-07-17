# 项目名称

Novel Ranking API

## 项目简介

基于 NestJS 的小说榜单快照服务，聚合起点中文网与晋江文学城的榜单数据。服务通过定时任务或受 API Key 保护的手动刷新采集数据，并以本地 JSON 快照和内存缓存提供稳定查询；查询接口不会隐式触发网站采集。

## 项目结构

```text
novel-ranking-api/
|-- src/                         // NestJS 应用源码
|   |-- *.ts                     // 应用启动、模块和通用控制器
|   `-- rankings/                // 榜单领域与 HTTP API
|       |-- domain/              // 统一模型、快照键和 provider 契约
|       |-- dto/                 // 请求参数校验 DTO
|       |-- providers/           // 网站采集、解码和解析适配器
|       `-- *.service.ts         // 快照存储、刷新协调和定时调度
|-- test/                        // 端到端测试与测试资源
|   `-- fixtures/                // 固定 HTML 页面样本
|-- docs/                        // 设计说明与实施计划
|-- data/                        // 运行时 JSON 快照，默认不提交
|-- package*.json                // Node.js 依赖、脚本和锁文件
`-- AGENTS.md                    // 项目协作与开发约束
```

## 常用命令

```powershell
npm ci
npm run start:dev
npm test
npm run lint
npm run build
```

## Agent必须遵守的约束

- 与用户沟通默认使用中文。
- 文档撰写默认使用中文。
- 读取和编辑文本文件时优先使用 UTF-8 编码。
- 实现功能前必须评估成熟的第三方库；无论是否采用，都必须先向用户说明实现思路与取舍。例如网络采集应优先评估 Axios。
