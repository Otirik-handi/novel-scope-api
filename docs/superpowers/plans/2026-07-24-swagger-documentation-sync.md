# Swagger Documentation Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 README、详细 API 文档和 Swagger UI 对 V0.2.0 的文档入口与版本描述保持一致。

**Architecture:** Swagger UI 继续负责交互式接口查看和执行，`docs/API.md` 继续负责完整响应示例、错误语义和缓存契约，README 负责把两者串联并提醒真实外站和数据库副作用。生产代码只调整 Swagger 展示版本，不改变任何业务行为。

**Tech Stack:** NestJS 11、`@nestjs/swagger` 11、Jest 30、Markdown、Git

---

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `src/main.spec.ts` | 先定义 Swagger UI 应展示 V0.2.0 的启动行为 |
| `src/main.ts` | 生成 OpenAPI 文档并在 `/api-docs` 注册 Swagger UI |
| `README.md` | 提供 Swagger 入口、API.md 链接和手动执行风险提醒 |
| `docs/API.md` | 保留完整接口契约，并说明 Swagger 交互入口 |

### Task 1：同步 Swagger 展示版本

**Files:**

- Modify: `src/main.spec.ts`
- Modify: `src/main.ts`

> **记录点：Task 1（每完成一个 Step 立即更新）**
>
> - 状态：`未开始`
> - 已完成步骤：`0/5`
> - 恢复入口：`Step 1：将启动测试的期望版本改为 0.2.0`
> - 验证证据：`尚无（任务未开始）`
> - 提交：`尚无（任务未开始）`

- [ ] **Step 1：先修改测试期望**

将 `src/main.spec.ts` 的 Swagger `info` 断言改为：

```ts
info: {
  title: "NovelScope API",
  description: "小说数据查询与刷新 API",
  version: "0.2.0",
  contact: {},
},
```

- [ ] **Step 2：运行测试并确认预期失败**

Run:

```powershell
npx jest --runInBand --runTestsByPath "$((Resolve-Path src/main.spec.ts).Path)"
```

Expected: FAIL，实际版本为 `1.0`，期望版本为 `0.2.0`。

- [ ] **Step 3：最小修改生产元数据**

将 `src/main.ts` 中：

```ts
.setVersion("1.0")
```

改为：

```ts
.setVersion("0.2.0")
```

- [ ] **Step 4：重跑定向测试**

Run:

```powershell
npx jest --runInBand --runTestsByPath "$((Resolve-Path src/main.spec.ts).Path)"
```

Expected: 1/1 suite、1/1 test PASS。

- [ ] **Step 5：更新 Task 1 记录点**

将状态改为 `已完成`、步骤改为 `5/5`，写入红绿测试证据，恢复入口指向 Task 2 / Step 1。

### Task 2：同步 README 与详细 API 文档

**Files:**

- Modify: `README.md`
- Modify: `docs/API.md`

> **记录点：Task 2（每完成一个 Step 立即更新）**
>
> - 状态：`未开始`
> - 已完成步骤：`0/6`
> - 恢复入口：`Task 1 / Step 1`
> - 验证证据：`尚无（任务未开始）`
> - 提交：`尚无（任务未开始）`

- [ ] **Step 1：更新 README 的 API 入口说明**

在“API 与刷新行为”中明确：

````markdown
应用启动后，可通过 Swagger UI 交互式查看和执行接口：

```text
http://localhost:3000/api-docs
```

端口随 `PORT` 配置变化。完整响应示例、错误语义和缓存行为见 [docs/API.md](docs/API.md)。
````

并在行为列表后补充：通过 Swagger 执行 POST 刷新会访问外站并写入 `DATABASE_URL` 指向的数据库；详情 GET 在缓存不存在或过期时也可能访问外站。

- [ ] **Step 2：更新 API.md 的 Swagger 分工说明**

在“约定”中加入：

```markdown
- 应用启动后可通过 `/api-docs` 使用 Swagger UI 交互式查看和执行接口；本文档保留完整响应示例、错误语义和缓存行为说明。
```

将范围外说明改为：

```markdown
V0.2.0 不提供榜单历史查询、番茄分类远程发现、跨平台书籍去重、刷新鉴权或自定义响应包装。部署时应在反向代理或网络边界限制 POST 刷新端点。
```

- [ ] **Step 3：验证文档链接和描述一致**

Run:

```powershell
rg -n "api-docs|docs/API\.md|0\.2\.0|Swagger" README.md docs/API.md src/main.ts src/main.spec.ts
Test-Path docs/API.md
```

Expected: 四个文件均能定位到对应入口或版本，`Test-Path` 输出 `True`；API.md 不再声称 Swagger 位于范围外。

- [ ] **Step 4：运行全量验证**

Run:

```powershell
npm test
npm run lint
npm run build
npx tsc --noEmit --incremental false
git diff --check
```

Expected: 35/35 suites、377/377 tests 通过，其余命令退出码均为 `0`。

- [ ] **Step 5：审计并提交实现**

Run:

```powershell
git status --short
git diff -- README.md docs/API.md src/main.ts src/main.spec.ts
git add README.md docs/API.md src/main.ts src/main.spec.ts docs/superpowers/plans/2026-07-24-swagger-documentation-sync.md
git commit -m "docs: align swagger and api documentation"
```

Expected: 只有本计划文件和四个目标文件进入提交。

- [ ] **Step 6：更新 Task 2 记录点**

将状态改为 `已完成`、步骤改为 `6/6`，写入全量验证和提交证据。记录点最终更新可使用独立文档提交承载。

### Task 3：合并、清理并推送主分支

**Files:**

- Modify: `docs/superpowers/plans/2026-07-24-swagger-documentation-sync.md`（最终记录点）

> **记录点：Task 3（每完成一个 Step 立即更新）**
>
> - 状态：`未开始`
> - 已完成步骤：`0/6`
> - 恢复入口：`Task 2 / Step 1`
> - 验证证据：`尚无（任务未开始）`
> - 提交：`尚无（任务未开始）`

- [ ] **Step 1：获取远端并检查分叉**

Run: `git fetch origin`，再在主工作区运行 `git rev-list --left-right --count origin/main...main`。

Expected: 远端新增提交数为 `0`；若不为 `0`，先停止并审查远端变化。

- [ ] **Step 2：将功能分支快进合并到 main**

Run: `git merge --ff-only docs/swagger-documentation-sync`。

Expected: `main` 快进到实现提交，无冲突。

- [ ] **Step 3：清理 worktree 和本地功能分支**

确认功能 worktree 干净且提交已被 `main` 包含，然后运行 `git worktree remove .worktrees/swagger-documentation-sync` 和 `git branch -d docs/swagger-documentation-sync`。

- [ ] **Step 4：在 main 上做首次最终状态检查**

Run: `git status --short --branch`、`git log --oneline -5`、`git diff --check origin/main..main`。

Expected: 工作区干净，提交拓扑包含设计、计划和实现提交。

- [ ] **Step 5：推送 main**

Run: `git push origin main`。

Expected: 推送成功，远端 `origin/main` 更新到本地主分支最新提交。

- [ ] **Step 6：保留备份、完成记录点并二次推送**

确认 `stash@{0}: pre-merge-main-user-changes-20260724` 仍存在，不应用、不删除。将 Task 3 状态更新为 `已完成`、步骤改为 `6/6`，写入首次推送证据，提交为 `docs: record swagger documentation rollout`，再运行 `git push origin main` 推送最终记录提交。
