# README 文档设计

## 目标

将现有的简略英文 README 扩展为面向服务使用者的中文文档，准确说明本项目的用途、Node.js 运行要求、原生部署步骤与 HTTP API。文档不引入项目尚未提供的 Docker、进程守护或反向代理配置。

## 结构

README 只使用以下四个一级标题：

1. 项目简介：说明服务聚合起点中文网与晋江文学城的榜单快照；查询只读取已有快照，不会隐式采集；来源非实时、非官方公开 API。
2. 环境要求：列出 Node.js 20+、npm 与可选的环境变量 `API_KEY`、`SNAPSHOT_DIR`、`PORT`。
3. 部署方法：给出 `npm install`、复制并配置 `.env`、开发启动、构建与生产启动命令；说明 JSON 快照目录与定时刷新频率。
4. API 简介：描述健康检查、榜单查询、受 `X-API-Key` 保护的手动刷新，提供请求示例、核心参数与快照字段含义。

## API 表述

- `GET /health` 用于存活检查，不触发采集。
- `GET /v1/rankings` 接受 `platform`、`rank` 和可选 `channel`；无快照时返回 503；查询不会刷新数据。
- `POST /v1/admin/refresh` 接受相同的榜单字段，必须携带正确的 `X-API-Key`；刷新失败时保留旧快照并标记为 `stale`。
- 响应的 `sourceUrl`、`fetchedAt`、`status`、`lastError` 用于区分来源、采集时间与刷新状态。

## 范围与验证

只修改 `README.md`，不改变应用代码、依赖、部署脚本或 API 行为。完成后检查 Markdown 标题结构、命令与源码脚本的一致性，以及 `API_KEY`、`SNAPSHOT_DIR`、`PORT` 与 `.env.example` 的一致性。
