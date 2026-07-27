# TomatoNovelDownloader Startup Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供一个从 `.env` 读取本机 TomatoNovelDownloader 可执行文件和独立数据目录、以前台方式安全启动并透传退出码的 npm 命令。

**Architecture:** 新增一个 CommonJS CLI，复用 `load-local-environment.cjs`，把配置校验、启动参数构造和子进程边界保持在单个聚焦模块内。路径准备使用 Node 标准库，Downloader 使用不经过 Shell 的 `spawnSync` 前台运行；Nest 应用环境接口不接触这两个仅供启动脚本使用的变量。

**Tech Stack:** Node.js 20 标准库、CommonJS、Jest、TypeScript 声明文件、npm scripts、PowerShell 文档示例。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `scripts/start-tomato-downloader.cjs` | 加载配置、校验路径和本机 URL、准备数据目录、前台启动子进程并形成 CLI 退出结果 |
| `scripts/start-tomato-downloader.d.cts` | 暴露给 TypeScript 测试的 CommonJS 类型边界 |
| `scripts/start-tomato-downloader.spec.ts` | 覆盖启动参数、路径、URL、失败和退出码行为 |
| `.env.example` | 声明可执行文件和独立数据目录变量 |
| `package.json` | 注册 `start:downloader` 命令 |
| `README.md` | 用 npm 命令替代手工 PowerShell 启动步骤 |

### Task 1：以测试定义配置和前台启动契约

**Files:**
- Create: `scripts/start-tomato-downloader.spec.ts`
- Create: `scripts/start-tomato-downloader.d.cts`
- Create: `scripts/start-tomato-downloader.cjs`

- [ ] **Step 1：写配置、参数和退出码的失败测试**

测试使用 `mkdtemp` 创建真实临时目录和占位可执行文件，只在外部子进程边界注入 `spawnSync` 替身。核心用例如下：

```typescript
it("starts the configured executable in the foreground", async () => {
  const executablePath = join(directory, "Tomato Downloader.exe");
  const dataDirectory = join(directory, "Downloader Data");
  await writeFile(executablePath, "", "utf8");
  const spawn = jest.fn(() => ({ status: 7, signal: null }));

  const exitCode = runTomatoDownloader(
    {
      TOMATO_DOWNLOADER_EXECUTABLE_PATH: executablePath,
      TOMATO_DOWNLOADER_DATA_DIR: dataDirectory,
      TOMATO_DOWNLOADER_BASE_URL: "http://127.0.0.1:18423",
    },
    { spawn },
  );

  expect(exitCode).toBe(7);
  expect(spawn).toHaveBeenCalledWith(
    executablePath,
    ["--server", "--data-dir", dataDirectory],
    expect.objectContaining({
      stdio: "inherit",
      shell: false,
      env: expect.objectContaining({ TOMATO_WEB_ADDR: "127.0.0.1:18423" }),
    }),
  );
  await expect(stat(dataDirectory)).resolves.toEqual(
    expect.objectContaining({ isDirectory: expect.any(Function) }),
  );
});
```

同一测试文件还需分别断言：

```typescript
function validEnvironment(
  executablePath: string,
  dataDirectory: string,
): NodeJS.ProcessEnv {
  return {
    TOMATO_DOWNLOADER_EXECUTABLE_PATH: executablePath,
    TOMATO_DOWNLOADER_DATA_DIR: dataDirectory,
    TOMATO_DOWNLOADER_BASE_URL: "http://127.0.0.1:18423",
  };
}

it.each([
  "TOMATO_DOWNLOADER_EXECUTABLE_PATH",
  "TOMATO_DOWNLOADER_DATA_DIR",
  "TOMATO_DOWNLOADER_BASE_URL",
])("rejects missing %s", async (key) => {
  const executablePath = join(directory, "Tomato Downloader.exe");
  await writeFile(executablePath, "", "utf8");
  const environment = validEnvironment(
    executablePath,
    join(directory, "Downloader Data"),
  );
  delete environment[key];

  expect(() => runTomatoDownloader(environment)).toThrow(key);
});

it.each([
  "https://127.0.0.1:18423",
  "http://0.0.0.0:18423",
  "http://example.com:18423",
  "http://127.0.0.1",
  "http://user@127.0.0.1:18423",
  "http://127.0.0.1:18423/api",
  "http://127.0.0.1:18423?token=value",
])("rejects unsafe Downloader base URL %s", async (baseUrl) => {
  const executablePath = join(directory, "Tomato Downloader.exe");
  await writeFile(executablePath, "", "utf8");
  const environment = validEnvironment(
    executablePath,
    join(directory, "Downloader Data"),
  );
  environment.TOMATO_DOWNLOADER_BASE_URL = baseUrl;

  expect(() => runTomatoDownloader(environment)).toThrow(
    "TOMATO_DOWNLOADER_BASE_URL must be a local HTTP URL with an explicit port",
  );
});
```

并覆盖：相对路径、不存在/非普通文件的可执行目标、数据目录目标为普通文件、`localhost` 和 `[::1]`、子进程 `error`、信号退出映射、CLI 错误输出不包含环境对象。

- [ ] **Step 2：运行定向测试并确认红灯原因正确**

Run:

```powershell
npx jest scripts/start-tomato-downloader.spec.ts --runInBand
```

Expected: FAIL，明确提示无法解析 `./start-tomato-downloader.cjs`；失败来自启动器尚不存在，而不是测试语法或环境问题。

- [ ] **Step 3：声明启动器的测试边界**

创建 `scripts/start-tomato-downloader.d.cts`，声明：

```typescript
interface SpawnResult {
  error?: Error;
  status: number | null;
  signal: NodeJS.Signals | null;
}

interface RunnerDependencies {
  spawn?: (
    command: string,
    args: readonly string[],
    options: {
      env: NodeJS.ProcessEnv;
      shell: false;
      stdio: "inherit";
    },
  ) => SpawnResult;
}

export function deriveTomatoWebAddress(baseUrl: string): string;
export function runTomatoDownloader(
  environment: NodeJS.ProcessEnv,
  dependencies?: RunnerDependencies,
): number;
export function main(
  environment?: NodeJS.ProcessEnv,
  dependencies?: RunnerDependencies & {
    writeError?: (message: string) => void;
  },
): number;
```

- [ ] **Step 4：写通过测试所需的最小启动器**

创建 `scripts/start-tomato-downloader.cjs`，实现以下边界：

```javascript
const { spawnSync } = require("node:child_process");
const { mkdirSync, statSync } = require("node:fs");
const { constants } = require("node:os");
const { isAbsolute, resolve } = require("node:path");
const { loadLocalEnvironment } = require("./load-local-environment.cjs");

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function requiredEnvironmentValue(environment, key) {
  const value = environment[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function deriveTomatoWebAddress(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("TOMATO_DOWNLOADER_BASE_URL must be a local HTTP URL with an explicit port");
  }
  if (
    url.protocol !== "http:" ||
    !LOCAL_HOSTS.has(url.hostname) ||
    url.port === "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("TOMATO_DOWNLOADER_BASE_URL must be a local HTTP URL with an explicit port");
  }
  return url.host;
}
```

`runTomatoDownloader()` 继续完成绝对路径校验、普通文件校验、递归创建并复核数据目录，然后调用：

```javascript
function normalizeExecutablePath(environment) {
  const rawPath = requiredEnvironmentValue(
    environment,
    "TOMATO_DOWNLOADER_EXECUTABLE_PATH",
  );
  if (!isAbsolute(rawPath)) {
    throw new Error("TOMATO_DOWNLOADER_EXECUTABLE_PATH must be an absolute path");
  }
  const executablePath = resolve(rawPath);
  let stats;
  try {
    stats = statSync(executablePath);
  } catch {
    throw new Error(
      `TOMATO_DOWNLOADER_EXECUTABLE_PATH must point to an existing file: ${executablePath}`,
    );
  }
  if (!stats.isFile()) {
    throw new Error(
      `TOMATO_DOWNLOADER_EXECUTABLE_PATH must point to an existing file: ${executablePath}`,
    );
  }
  return executablePath;
}

function prepareDataDirectory(environment) {
  const rawPath = requiredEnvironmentValue(
    environment,
    "TOMATO_DOWNLOADER_DATA_DIR",
  );
  if (!isAbsolute(rawPath)) {
    throw new Error("TOMATO_DOWNLOADER_DATA_DIR must be an absolute path");
  }
  const dataDirectory = resolve(rawPath);
  try {
    mkdirSync(dataDirectory, { recursive: true });
  } catch {
    throw new Error(
      `TOMATO_DOWNLOADER_DATA_DIR could not be created: ${dataDirectory}`,
    );
  }
  if (!statSync(dataDirectory).isDirectory()) {
    throw new Error(
      `TOMATO_DOWNLOADER_DATA_DIR must point to a directory: ${dataDirectory}`,
    );
  }
  return dataDirectory;
}

function childExitCode(result) {
  if (result.error) throw result.error;
  if (Number.isInteger(result.status)) return result.status;
  if (result.signal) {
    const signalNumber = constants.signals[result.signal];
    if (Number.isInteger(signalNumber)) return 128 + signalNumber;
  }
  throw new Error("Downloader exited without a status or known signal");
}

function runTomatoDownloader(environment, dependencies = {}) {
  const executablePath = normalizeExecutablePath(environment);
  const dataDirectory = prepareDataDirectory(environment);
  const baseUrl = requiredEnvironmentValue(
    environment,
    "TOMATO_DOWNLOADER_BASE_URL",
  );
  const webAddress = deriveTomatoWebAddress(baseUrl);
  const spawn = dependencies.spawn ?? spawnSync;
  const result = spawn(
    executablePath,
    ["--server", "--data-dir", dataDirectory],
    {
      env: { ...environment, TOMATO_WEB_ADDR: webAddress },
      shell: false,
      stdio: "inherit",
    },
  );
  return childExitCode(result);
}

function main(environment = process.env, dependencies = {}) {
  try {
    return runTomatoDownloader(environment, dependencies);
  } catch (error) {
    const writeError = dependencies.writeError ?? console.error;
    writeError(error instanceof Error ? error.message : "Downloader startup failed");
    return 1;
  }
}

if (require.main === module) {
  loadLocalEnvironment();
  process.exitCode = main();
}

module.exports = { deriveTomatoWebAddress, main, runTomatoDownloader };
```

如果 `result.error` 存在则抛出；有数字状态时原样返回；有已知信号时返回 `128 + constants.signals[result.signal]`。`main()` 只输出 `Error.message` 并返回 `1`。

- [ ] **Step 5：运行定向测试并确认绿灯**

Run:

```powershell
npx jest scripts/start-tomato-downloader.spec.ts --runInBand
```

Expected: PASS，新增套件全部通过，没有启动真实 Downloader。

- [ ] **Step 6：重构并保持绿灯**

提取重复错误消息和路径验证小函数，但不增加后台模式、重试、配置写入或进程守护。再次运行定向 Jest，Expected: PASS。

- [ ] **Step 7：提交启动器核心**

```powershell
git add scripts/start-tomato-downloader.cjs scripts/start-tomato-downloader.d.cts scripts/start-tomato-downloader.spec.ts
git commit -m "feat: add tomato downloader startup runner"
```

### Task 2：接入配置、npm 命令和用户文档

**Files:**
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1：先写元数据契约测试**

在 `scripts/start-tomato-downloader.spec.ts` 增加真实文件断言：

```typescript
it("exposes the documented npm and environment configuration", async () => {
  const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
  const example = await readFile(resolve(".env.example"), "utf8");

  expect(packageJson.scripts["start:downloader"]).toBe(
    "node scripts/start-tomato-downloader.cjs",
  );
  expect(example).toContain("TOMATO_DOWNLOADER_EXECUTABLE_PATH=");
  expect(example).toContain("TOMATO_DOWNLOADER_DATA_DIR=");
});
```

- [ ] **Step 2：运行测试并确认缺少 npm 命令的红灯**

Run:

```powershell
npx jest scripts/start-tomato-downloader.spec.ts --runInBand
```

Expected: FAIL，期望 `start:downloader`，实际为 `undefined`。

- [ ] **Step 3：添加配置示例和 npm 命令**

在 `.env.example` 的 Downloader 必填配置附近加入：

```dotenv
TOMATO_DOWNLOADER_EXECUTABLE_PATH=C:/Tools/TomatoNovelDownloader-Win64-v2.4.13.exe
TOMATO_DOWNLOADER_DATA_DIR=C:/NovelScope/tomato-downloader
```

在 `package.json` 的启动命令附近加入：

```json
"start:downloader": "node scripts/start-tomato-downloader.cjs"
```

- [ ] **Step 4：运行定向测试并确认绿灯**

Run: `npx jest scripts/start-tomato-downloader.spec.ts --runInBand`

Expected: PASS。

- [ ] **Step 5：更新 README 启动教程**

在最小 `.env` 示例中加入两个变量；把手工 `$env:TOMATO_WEB_ADDR` 与 EXE 命令替换为：

```powershell
npm run start:downloader
```

说明脚本从 `TOMATO_DOWNLOADER_BASE_URL` 派生监听地址、在前台显示日志、使用 `TOMATO_DOWNLOADER_DATA_DIR`，并要求先启动 Downloader 再启动 API。

- [ ] **Step 6：运行完整验证**

Run:

```powershell
npm test
npm run lint
npm run build
npx tsc --noEmit --incremental false
git diff --check
```

Expected: 所有命令退出码为 `0`；普通 Jest 不访问网络或数据库。

- [ ] **Step 7：检查最终差异并提交接入**

Run:

```powershell
git diff -- .env.example package.json README.md scripts/start-tomato-downloader.cjs scripts/start-tomato-downloader.d.cts scripts/start-tomato-downloader.spec.ts
git status --short
```

确认只包含规格内文件后提交：

```powershell
git add .env.example package.json README.md scripts/start-tomato-downloader.spec.ts
git commit -m "docs: expose tomato downloader startup command"
```

### Task 3：交付前审查

**Files:**
- Review: all files changed since design commit `68b82cc`

- [ ] **Step 1：核对规格覆盖**

逐项确认前台运行、环境优先级、本机 URL 派生、绝对路径、数据目录创建、无 Shell 参数传递、退出码、文档和无真实外部调用均有实现或测试证据。

- [ ] **Step 2：重新运行高信号验证**

Run:

```powershell
npx jest scripts/start-tomato-downloader.spec.ts --runInBand
npm run lint
npm run build
git diff --check HEAD~2
```

Expected: 全部退出码为 `0`。

- [ ] **Step 3：检查工作区和提交历史**

Run:

```powershell
git status --short
git log -4 --oneline --decorate
```

Expected: 工作区干净；历史包含设计、启动器核心和配置/文档提交。
