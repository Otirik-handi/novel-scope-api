# TomatoNovelDownloader 启动脚本设计

## 背景

NovelScope V0.2.1 依赖一个由项目独占的 `TomatoNovelDownloader-Win64-v2.4.13.exe` Web 服务。当前 README 要求用户在 PowerShell 中手工设置 `TOMATO_WEB_ADDR`、填写可执行文件路径并传入独立数据目录。该流程容易因路径引号、端口不一致或遗漏参数而失败，也不能复用项目已有的 `.env` 配置入口。

本改动提供一个仓库内启动脚本。用户只需在 `.env` 配置可执行文件和数据目录，然后运行 npm 命令，即可在当前控制台以前台方式启动 Downloader。

## 目标

- 通过 `.env` 配置 Downloader 可执行文件和独立数据目录。
- 从现有 `TOMATO_DOWNLOADER_BASE_URL` 派生 Downloader 的监听地址，避免 API 客户端地址与服务监听地址不一致。
- 以前台方式启动 Downloader，直接显示日志并透传退出结果。
- 对缺失配置、非法路径和不存在的可执行文件提供明确的启动错误。
- 使用参数数组调用子进程，正确支持包含空格的 Windows 路径，不通过 Shell 拼接命令。

## 非目标

- 不由 NovelScope API 自动启动、停止或重启 Downloader。
- 不提供后台运行、Windows 服务注册、进程守护或日志文件轮转。
- 不修改 Downloader 的 `config.yml`，现有版本和配置契约仍由应用启动检查负责。
- 不改变 `TOMATO_DOWNLOADER_BASE_URL`、下载 Worker 或 HTTP API 行为。
- 不支持从远程 URL 启动 Downloader；启动脚本只负责本机可执行文件。

## 配置契约

`.env.example` 新增两个必填变量：

```dotenv
TOMATO_DOWNLOADER_EXECUTABLE_PATH=C:/Tools/TomatoNovelDownloader-Win64-v2.4.13.exe
TOMATO_DOWNLOADER_DATA_DIR=C:/NovelScope/tomato-downloader
```

脚本继续使用现有变量：

```dotenv
TOMATO_DOWNLOADER_BASE_URL=http://127.0.0.1:18423
```

调用方预先注入的环境变量优先于 `.env`，与 `scripts/load-local-environment.cjs` 的现有行为一致。新增变量只供启动脚本使用，不加入 Nest 应用的运行时环境接口，因为 API 进程不读取可执行文件或 Downloader 数据目录。

## 启动入口

`package.json` 新增命令：

```json
{
  "scripts": {
    "start:downloader": "node scripts/start-tomato-downloader.cjs"
  }
}
```

用户运行：

```powershell
npm run start:downloader
```

脚本加载工作目录中的 `.env`，校验配置并执行等价命令：

```text
<TOMATO_DOWNLOADER_EXECUTABLE_PATH> --server --data-dir <TOMATO_DOWNLOADER_DATA_DIR>
```

子进程继承当前控制台的标准输入、标准输出和标准错误。脚本等待 Downloader 退出；正常退出时透传退出码，子进程无法创建或异常终止时输出安全、明确的错误并以非零状态退出。

## 地址派生

脚本使用标准 `URL` 解析 `TOMATO_DOWNLOADER_BASE_URL`，并将其 `host` 写入子进程环境变量 `TOMATO_WEB_ADDR`。例如：

```text
http://127.0.0.1:18423 -> 127.0.0.1:18423
```

为保持“只监听本机”的现有安全约束，启动脚本只接受：

- `http:` 协议；
- `127.0.0.1`、`localhost` 或 `[::1]` 主机；
- 显式端口；
- 根路径，且不含用户名、密码、查询参数或片段。

脚本始终用派生值覆盖子进程环境中的同名 `TOMATO_WEB_ADDR`，防止调用方注入的旧值造成端口漂移；父进程环境不会被修改。

## 路径与副作用

- `TOMATO_DOWNLOADER_EXECUTABLE_PATH` 必须是绝对路径，并指向现有普通文件。
- `TOMATO_DOWNLOADER_DATA_DIR` 必须是绝对路径。
- 数据目录不存在时，脚本在启动子进程前递归创建；已存在但不是目录时关闭式失败。
- 可执行文件路径和数据目录作为独立子进程参数传递，不使用 `shell: true`。
- 脚本不创建、修改或删除 Downloader `config.yml`，也不清理 Downloader 数据目录。

## 代码结构

- `scripts/start-tomato-downloader.cjs`：CLI 入口、配置规范化、路径校验、数据目录准备和前台子进程执行。
- `scripts/start-tomato-downloader.d.cts`：为 TypeScript/Jest 测试声明脚本导出的测试边界。
- `scripts/start-tomato-downloader.spec.ts`：验证配置和启动行为。
- `.env.example`：声明两个新增配置项。
- `package.json`：注册 `start:downloader` 命令。
- `README.md`：说明配置方法和新的启动命令，保留 Downloader `config.yml` 契约说明。

启动模块导出可注入依赖的函数，CLI 入口仅负责加载 `.env`、调用该函数、打印错误并设置退出码。文件系统和子进程是不可避免的 I/O 边界；测试通过临时目录验证真实路径行为，并只在子进程创建边界使用注入替身。

## 错误处理

以下情况在创建 Downloader 进程前失败，并且错误消息指出具体变量或资源：

- 任一必填变量缺失或只有空白；
- URL 不满足本机 HTTP 地址约束；
- 可执行文件或数据目录不是绝对路径；
- 可执行文件不存在或不是普通文件；
- 数据目录无法创建，或目标已存在但不是目录；
- 子进程创建失败。

错误消息不得包含 Downloader 密码，也不打印完整环境对象。路径可以出现在本地控制台错误中，便于用户修正配置。

## 测试策略

Jest 单元测试覆盖：

- 从合法配置构造正确的可执行文件、`--server`、`--data-dir` 参数和 `TOMATO_WEB_ADDR`；
- 包含空格的 Windows 风格路径仍作为单个参数传递；
- 调用方环境变量不会被 `.env` 覆盖，沿用现有环境加载器测试；
- 数据目录不存在时创建，已存在目录时复用；
- 缺失变量、相对路径、不存在的可执行文件、非目录数据路径和非法/非本机 URL 均关闭式失败；
- Downloader 退出码被启动脚本透传；
- 子进程创建错误转换为 CLI 非零退出结果。

完成后运行定向 Jest、完整单元测试、ESLint、构建、独立 TypeScript 检查和 `git diff --check`。测试不启动真实 TomatoNovelDownloader，也不访问网络或数据库。

## 文档行为

README 的“专用 TomatoNovelDownloader”章节继续要求版本 `2.4.13` 和现有 `config.yml` 契约，但把手工设置 `$env:TOMATO_WEB_ADDR` 与硬编码路径的命令替换为：

```powershell
npm run start:downloader
```

文档明确该命令以前台运行，关闭控制台或按 `Ctrl+C` 会终止 Downloader；应先启动 Downloader，再启动 NovelScope API。
