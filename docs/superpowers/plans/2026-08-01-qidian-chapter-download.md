# Qidian 免费章节下载实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现有下载 API 增加起点免费章节 TXT 下载，通过 `platform` 选择番茄或起点执行器。

**Architecture:** 在 `DownloadsWorker` 和 `DownloadsService` 前引入 `BookDownloadRunnerRegistry`；番茄 runner 包装现有 TomatoDownloaderClient，起点 runner 使用本地 `QidianChapterCrawler` 抓取免费章节并生成 TXT 流，最终统一写入 ArtifactStore。

**Tech Stack:** NestJS、Prisma、Axios、Cheerio、Playwright、Node.js streams。

---

## 执行状态（暂停点）

> 状态更新于 2026-08-01。用户要求暂停执行；此处仅记录完成情况和恢复点，不再继续开发。

- 工作区：`D:\Otirik\Workstation\novel-scope-api\.worktrees\qidian-chapter-download`
- 分支：`feature/qidian-chapter-download`
- 当前 HEAD：`39c12ab fix: close qidian browser context after aborted creation`
- 已完成 Task 1-6，并已通过两阶段 review：
  - Task 1：`ec88343`
  - Task 2：`f117c25`
  - Task 3：`ccb81ff`
  - Task 4：`ea2f952`
  - Task 5：`66fb5a7`
  - Task 6：`39c12ab`
- 最后验证：单元测试 55 suites / 573 tests 通过；`tsc`、`lint`、`git diff --check` 通过。
- 尚未执行：Task 7-10。
- 恢复点：从 Task 7「Repository、Service、Controller 支持 platform」继续；base commit 为 `39c12ab`。

---

## 实现原则

- 优先完成可运行实现，测试只保留最低限度的关键契约覆盖。
- 不新增依赖，不修改 Prisma schema。
- 保持旧 `fanqie` 路由兼容。
- 所有代码使用项目现有单引号风格。

---

## Task 1: 移动番茄下载器到 fanqie runner 目录

**Files:**
- Move: `src/downloads/tomato-downloader/` -> `src/downloads/runners/fanqie/tomato-downloader/`
- Modify: `src/downloads/downloads.module.ts`
- Modify: `src/downloads/downloads.service.ts`
- Modify: `src/downloads/downloads.worker.ts`
- Modify: `src/downloads/downloads.repository.ts`
- Modify: `src/downloads/downloads.module.spec.ts`
- Modify: `src/downloads/downloads.service.spec.ts`
- Modify: `src/downloads/downloads.worker.spec.ts`
- Modify: `src/downloads/downloads.repository.spec.ts`

- [ ] **Step 1: 移动目录并替换旧导入**

```powershell
New-Item -ItemType Directory -Force -Path src/downloads/runners/fanqie
git mv src/downloads/tomato-downloader src/downloads/runners/fanqie/tomato-downloader
```

将以下旧导入路径全部替换为新路径：

```text
./tomato-downloader/tomato-downloader.client
./tomato-downloader/tomato-downloader.contract
```

替换为：

```text
./runners/fanqie/tomato-downloader/tomato-downloader.client
./runners/fanqie/tomato-downloader/tomato-downloader.contract
```

搜索范围：`src/downloads/**/*.ts`。

- [ ] **Step 2: 验证移动后编译**

Run:

```powershell
npx tsc --noEmit --incremental false
```

Expected: 无类型错误，旧路径不再存在。

- [ ] **Step 3: Commit**

```powershell
git add -A src/downloads
git commit -m "refactor: move tomato downloader under fanqie runner"
```

---

## Task 2: 建立 runner 通用类型

**Files:**
- Create: `src/downloads/runners/book-download-runner.interface.ts`
- Modify: `src/downloads/runners/fanqie/tomato-downloader/tomato-downloader.contract.ts`
- Modify: `src/downloads/downloads.repository.ts`

- [ ] **Step 1: 创建通用接口**

Create `src/downloads/runners/book-download-runner.interface.ts`:

```typescript
import type { Readable } from "node:stream";
import type { Platform } from "../../shared/types/platform.type";

export interface ChapterRange {
  startChapter: number;
  endChapter: number;
}

export interface BookDownloadRequest {
  externalBookId: string;
  range: ChapterRange | null;
}

export interface DownloadTaskContext {
  id: string;
  startedAt: Date | null;
}

export type BookDownloadJobState =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "canceled";

export interface BookDownloadJob {
  id: string;
  externalBookId: string;
  title: string | null;
  author: string | null;
  state: BookDownloadJobState;
  message: string | null;
  progress: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
}

export interface BookDownloadJobRef {
  id: string;
}

export interface ArtifactSource {
  stream: Readable;
  contentType: string;
}

export interface BookDownloadRunner {
  readonly platform: Platform;
  initialize(): Promise<void>;
  listJobs(): Promise<BookDownloadJob[]>;
  createJob(request: BookDownloadRequest): Promise<BookDownloadJobRef>;
  getJob(jobId: string): Promise<BookDownloadJob | null>;
  cancelJob(jobId: string): Promise<void>;
  openArtifact(
    jobId: string,
    task: DownloadTaskContext,
    signal: AbortSignal,
  ): Promise<ArtifactSource>;
  releaseJob(jobId: string): Promise<void>;
}
```

- [ ] **Step 2: 让番茄契约复用通用 ChapterRange**

在 `src/downloads/runners/fanqie/tomato-downloader/tomato-downloader.contract.ts` 顶部增加：

```typescript
import type { ChapterRange } from "../book-download-runner.interface";
```

删除文件内原 `ChapterRange` 接口，并在导出区保留：

```typescript
export type { ChapterRange };
```

- [ ] **Step 3: Repository 使用通用 ChapterRange**

修改 `src/downloads/downloads.repository.ts`：

```typescript
import type { ChapterRange } from "./runners/book-download-runner.interface";
```

删除原来对番茄 contract 的 `ChapterRange` 导入。

- [ ] **Step 4: 验证编译**

Run:

```powershell
npx tsc --noEmit --incremental false
```

Expected: 无类型错误。

- [ ] **Step 5: Commit**

```powershell
git add src/downloads/runners/book-download-runner.interface.ts src/downloads/runners/fanqie/tomato-downloader/tomato-downloader.contract.ts src/downloads/downloads.repository.ts
git commit -m "feat: add generic book download runner contract"
```

---

## Task 3: 创建 FanqieDownloadRunner 和 Registry

**Files:**
- Create: `src/downloads/runners/book-download-runner.registry.ts`
- Create: `src/downloads/runners/fanqie/fanqie-download.runner.ts`
- Test: `src/downloads/runners/book-download-runner.registry.spec.ts`

- [ ] **Step 1: 创建 Registry**

Create `src/downloads/runners/book-download-runner.registry.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import type { Platform } from "../../shared/types/platform.type";
import type { BookDownloadRunner } from "./book-download-runner.interface";

@Injectable()
export class BookDownloadRunnerRegistry {
  private readonly runners = new Map<Platform, BookDownloadRunner>();

  constructor(...runners: BookDownloadRunner[]) {
    for (const runner of runners) {
      this.runners.set(runner.platform, runner);
    }
  }

  list(): BookDownloadRunner[] {
    return [...this.runners.values()];
  }

  resolve(platform: Platform): BookDownloadRunner {
    const runner = this.runners.get(platform);
    if (!runner) {
      throw new Error(`No download runner for platform: ${platform}`);
    }
    return runner;
  }
}
```

- [ ] **Step 2: 创建 FanqieDownloadRunner**

Create `src/downloads/runners/fanqie/fanqie-download.runner.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import { setTimeout as sleep } from "node:timers/promises";
import { TomatoDownloaderClient } from "./tomato-downloader/tomato-downloader.client";
import {
  TOMATO_DOWNLOADER_SUPPORTED_VERSION,
  type DownloaderConfig,
  type DownloaderJob,
  type DownloaderLibraryItem,
} from "./tomato-downloader/tomato-downloader.contract";
import type {
  ArtifactSource,
  BookDownloadJob,
  BookDownloadJobRef,
  BookDownloadRequest,
  BookDownloadRunner,
  DownloadTaskContext,
} from "../book-download-runner.interface";

@Injectable()
export class FanqieDownloadRunner implements BookDownloadRunner {
  readonly platform = "fanqie" as const;

  constructor(private readonly client: TomatoDownloaderClient) {}

  async initialize(): Promise<void> {
    const [status, config] = await Promise.all([
      this.client.getStatus(),
      this.client.getConfig(),
    ]);
    this.assertContract(status.version, config);
  }

  async listJobs(): Promise<BookDownloadJob[]> {
    return (await this.client.listJobs()).map(toBookDownloadJob);
  }

  async createJob(
    request: BookDownloadRequest,
  ): Promise<BookDownloadJobRef> {
    return this.client.createJob(request.externalBookId, request.range);
  }

  async getJob(jobId: string): Promise<BookDownloadJob | null> {
    const job = await this.client.getJob(jobId);
    return job === null ? null : toBookDownloadJob(job);
  }

  async cancelJob(jobId: string): Promise<void> {
    await this.client.cancelJob(jobId);
  }

  async openArtifact(
    jobId: string,
    task: DownloadTaskContext,
    signal: AbortSignal,
  ): Promise<ArtifactSource> {
    const job = await this.getJob(jobId);
    if (!job?.title) {
      throw new Error("ARTIFACT_NOT_FOUND");
    }
    const item = await this.findArtifact(job.title, task, signal);
    if (item === null) {
      throw new Error("ARTIFACT_NOT_FOUND");
    }
    return this.client.openArtifact(item.relativePath, signal);
  }

  async releaseJob(_jobId: string): Promise<void> {}

  private async findArtifact(
    title: string,
    task: DownloadTaskContext,
    signal: AbortSignal,
  ): Promise<DownloaderLibraryItem | null> {
    let scan = await this.client.scanLibrary(true, signal);
    while (scan.running) {
      await sleep(1_000, undefined, { signal });
      scan = await this.client.scanLibrary(false, signal);
    }
    const expected = `${downloaderSafeFsName(title)}.txt`;
    const earliest = (task.startedAt ?? new Date()).getTime() - 5_000;
    const candidates = scan.items.filter(
      (item) =>
        item.kind === "file" &&
        !/[\\/]/.test(item.relativePath) &&
        item.extension.toLowerCase() === "txt" &&
        item.name === expected &&
        item.modifiedAtMs !== null &&
        item.modifiedAtMs >= earliest,
    );
    return candidates.length === 1 ? candidates[0]! : null;
  }

  private assertContract(
    version: string,
    config: DownloaderConfig,
  ): void {
    const valid =
      version === TOMATO_DOWNLOADER_SUPPORTED_VERSION &&
      config.useOfficialApi &&
      config.novelFormat === "txt" &&
      !config.bulkFiles &&
      !config.enableSegmentComments &&
      !config.enableAudiobook &&
      !config.autoOpenDownloadedFiles &&
      !config.askFormatAfterDownload &&
      config.preferredBookNameField !== "ask_after_download" &&
      config.allowOverwriteFiles;
    if (!valid) {
      throw new Error(
        "Downloader version or configuration does not satisfy the NovelScope contract",
      );
    }
  }
}

function toBookDownloadJob(job: DownloaderJob): BookDownloadJob {
  return {
    id: job.id,
    externalBookId: job.bookId,
    title: job.title,
    author: job.author,
    state: job.state,
    message: job.message,
    progress: job.progress,
    error:
      job.state === "failed"
        ? {
            code: "DOWNLOADER_REJECTED",
            message: job.message ?? "Downloader rejected the task",
          }
        : null,
  };
}

function downloaderSafeFsName(name: string): string {
  const replacements: Record<string, string> = {
    ":": "\uFF1A",
    '"': "\uFF02",
    "<": "\u300A",
    ">": "\u300B",
    "/": "\u3001",
    "\\": "\u3001",
    "|": "\uFF5C",
    "?": "\uFF1F",
    "*": "\uFF0A",
  };
  let cleaned = [...name]
    .map((character) =>
      character.charCodeAt(0) < 32
        ? "_"
        : (replacements[character] ?? character),
    )
    .join("");
  cleaned = cleaned.replace(/[ .]+$/g, "");
  if (cleaned.length === 0) cleaned = "unnamed";
  return cleaned.replace(/[ .]+$/g, "") || "unnamed";
}
```

- [ ] **Step 3: 最小 registry 测试**

Create `src/downloads/runners/book-download-runner.registry.spec.ts`:

```typescript
import { BookDownloadRunnerRegistry } from "./book-download-runner.registry";
import type { BookDownloadRunner } from "./book-download-runner.interface";

describe("BookDownloadRunnerRegistry", () => {
  it("resolves platform runners", () => {
    const fanqie = { platform: "fanqie" } as BookDownloadRunner;
    const qidian = { platform: "qidian" } as BookDownloadRunner;
    const registry = new BookDownloadRunnerRegistry(fanqie, qidian);

    expect(registry.resolve("fanqie")).toBe(fanqie);
    expect(registry.resolve("qidian")).toBe(qidian);
  });
});
```

- [ ] **Step 4: 验证**

Run:

```powershell
npm test -- --runInBand src/downloads/runners/book-download-runner.registry.spec.ts
npx tsc --noEmit --incremental false
```

Expected: 测试通过，无类型错误。

- [ ] **Step 5: Commit**

```powershell
git add src/downloads/runners
git commit -m "feat: add fanqie download runner and runner registry"
```

---

## Task 4: 起点目录和章节解析器

**Files:**
- Create: `src/crawlers/qidian/chapters/qidian-chapter.error.ts`
- Create: `src/crawlers/qidian/chapters/qidian-catalog.parser.ts`
- Create: `src/crawlers/qidian/chapters/qidian-chapter.parser.ts`
- Test: `src/crawlers/qidian/chapters/qidian-catalog.parser.spec.ts`

- [ ] **Step 1: 创建错误类型**

Create `src/crawlers/qidian/chapters/qidian-chapter.error.ts`:

```typescript
export class QidianChapterCrawlerError extends Error {
  override readonly name = "QidianChapterCrawlerError";

  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
```

- [ ] **Step 2: 创建目录解析器**

Create `src/crawlers/qidian/chapters/qidian-catalog.parser.ts`:

```typescript
import { load } from "cheerio";
import { QIDIAN_BASE_URL } from "../qidian.constants";
import { QidianChapterCrawlerError } from "./qidian-chapter.error";

export interface QidianCatalogChapter {
  index: number;
  title: string;
  chapterId: string;
  sourceUrl: string;
  isVip: boolean;
}

export interface QidianCatalogParseInput {
  html: string;
  sourceUrl: string;
}

export class QidianCatalogParser {
  parse(input: QidianCatalogParseInput): QidianCatalogChapter[] {
    const $ = load(input.html);
    const chapters: QidianCatalogChapter[] = [];

    $(".catalog-volume").each((_volumeIndex, volume) => {
      $(volume).find("li.chapter-item").each((_chapterIndex, li) => {
        const link = $(li).find("a.chapter-name").first();
        const href = link.attr("href") ?? "";
        const chapterId = this.parseChapterId(href);
        if (chapterId === null) return;

        chapters.push({
          index: chapters.length + 1,
          title: normalizeHtmlText(link.text()),
          chapterId,
          sourceUrl: new URL(href, QIDIAN_BASE_URL).href,
          isVip: $(li).find(".chapter-locked").length > 0,
        });
      });
    });

    if (chapters.length === 0) {
      throw new QidianChapterCrawlerError(
        "QIDIAN_CATALOG_PARSE_FAILED",
        "起点目录为空或无法解析",
      );
    }

    return chapters;
  }

  private parseChapterId(href: string): string | null {
    try {
      const url = new URL(href, QIDIAN_BASE_URL);
      return url.pathname.match(/^\/chapter\/\d+\/(\d+)\/?$/)?.[1] ?? null;
    } catch {
      return null;
    }
  }
}

function normalizeHtmlText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
```

- [ ] **Step 3: 创建章节解析器**

Create `src/crawlers/qidian/chapters/qidian-chapter.parser.ts`:

```typescript
import { load } from "cheerio";
import { QidianChapterCrawlerError } from "./qidian-chapter.error";

export interface QidianChapterParseInput {
  html: string;
  sourceUrl: string;
  bookId: string;
  chapterId: string;
}

export interface QidianChapterContent {
  title: string;
  content: string;
  isVip: boolean;
  encrypted: boolean;
}

export class QidianChapterParser {
  parse(input: QidianChapterParseInput): QidianChapterContent {
    const $ = load(input.html);
    const script = $("#vite-plugin-ssr_pageContext").first().html();
    let data: unknown;

    try {
      data = JSON.parse(script ?? "");
    } catch {
      throw this.emptyError();
    }

    const chapterInfo = findChapterInfo(data);
    if (
      chapterInfo === null ||
      typeof chapterInfo.content !== "string" ||
      chapterInfo.content.trim() === ""
    ) {
      throw this.emptyError();
    }

    const title =
      typeof chapterInfo.chapterName === "string" &&
      chapterInfo.chapterName.trim() !== ""
        ? chapterInfo.chapterName.trim()
        : `第${input.chapterId}章`;

    return {
      title,
      content: contentToPlainText(chapterInfo.content),
      isVip: chapterInfo.vipStatus === 1,
      encrypted: chapterInfo.cES === 2,
    };
  }

  private emptyError(): QidianChapterCrawlerError {
    return new QidianChapterCrawlerError(
      "QIDIAN_CHAPTER_EMPTY",
      "起点章节正文缺失或为空",
    );
  }
}

function findChapterInfo(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  const root = value as Record<string, unknown>;
  const pageContext = root.pageContext as Record<string, unknown> | undefined;
  const pageProps = pageContext?.pageProps as Record<string, unknown> | undefined;
  const pageData = pageProps?.pageData as Record<string, unknown> | undefined;
  const chapterInfo = pageData?.chapterInfo;
  return typeof chapterInfo === "object" && chapterInfo !== null
    ? (chapterInfo as Record<string, unknown>)
    : null;
}

function contentToPlainText(content: string): string {
  const $ = load(content);
  const paragraphs = $("p")
    .toArray()
    .map((node) => $(node).text().replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 0);
  return paragraphs.length > 0 ? paragraphs.join("\n") : content.trim();
}
```

- [ ] **Step 4: 目录解析最小测试**

Create `src/crawlers/qidian/chapters/qidian-catalog.parser.spec.ts`:

```typescript
import { QidianCatalogParser } from "./qidian-catalog.parser";

describe("QidianCatalogParser", () => {
  it("assigns global indexes and detects VIP chapters", () => {
    const html = `
      <div class="catalog-volume">
        <ul class="volume-chapters">
          <li class="chapter-item"><a class="chapter-name" href="//www.qidian.com/chapter/1/100/">第一章</a></li>
          <li class="chapter-item"><a class="chapter-name" href="//www.qidian.com/chapter/1/200/">第二章</a><em class="chapter-locked"></em></li>
        </ul>
      </div>
    `;

    const chapters = new QidianCatalogParser().parse({ html, sourceUrl: "https://www.qidian.com/book/1/" });

    expect(chapters).toEqual([
      expect.objectContaining({ index: 1, chapterId: "100", isVip: false }),
      expect.objectContaining({ index: 2, chapterId: "200", isVip: true }),
    ]);
  });
});
```

- [ ] **Step 5: 验证**

Run:

```powershell
npm test -- --runInBand src/crawlers/qidian/chapters/qidian-catalog.parser.spec.ts
npx tsc --noEmit --incremental false
```

Expected: 测试通过，无类型错误。

- [ ] **Step 6: Commit**

```powershell
git add src/crawlers/qidian/chapters
git commit -m "feat: add qidian catalog and chapter parsers"
```

---

## Task 5: 创建 QidianChapterCrawler

**Files:**
- Create: `src/crawlers/qidian/chapters/qidian-chapter.crawler.ts`
- Modify: `src/crawlers/qidian/qidian.module.ts`
- Modify: `src/crawlers/crawlers.module.ts`

- [ ] **Step 1: 创建 crawler**

Create `src/crawlers/qidian/chapters/qidian-chapter.crawler.ts`:

```typescript
import type { QidianBrowserClient } from "../qidian-browser.client";
import { QidianBookParser } from "../books/qidian-book.parser";
import { QidianCatalogParser } from "./qidian-catalog.parser";
import { QidianChapterParser } from "./qidian-chapter.parser";
import { QidianChapterCrawlerError } from "./qidian-chapter.error";
import type { QidianCatalogChapter } from "./qidian-catalog.parser";
import type { QidianChapterContent } from "./qidian-chapter.parser";
import { QIDIAN_BOOK_PATH_PREFIX } from "../qidian.constants";

export interface QidianCatalog {
  bookId: string;
  title: string;
  author: string;
  chapters: QidianCatalogChapter[];
}

export class QidianChapterCrawler {
  constructor(
    private readonly client: Pick<QidianBrowserClient, "fetchPage">,
    private readonly bookParser = new QidianBookParser(),
    private readonly catalogParser = new QidianCatalogParser(),
    private readonly chapterParser = new QidianChapterParser(),
  ) {}

  async fetchCatalog(externalBookId: string): Promise<QidianCatalog> {
    if (!/^\d+$/.test(externalBookId)) {
      throw new QidianChapterCrawlerError(
        "QIDIAN_RANGE_INVALID",
        "无效的起点书号",
      );
    }

    const page = await this.client.fetchPage(
      `${QIDIAN_BOOK_PATH_PREFIX}${externalBookId}/`,
    );
    const book = this.bookParser.parse({
      html: page.html,
      sourceUrl: page.sourceUrl,
      fetchedAt: new Date(),
    });
    const chapters = this.catalogParser.parse({
      html: page.html,
      sourceUrl: page.sourceUrl,
    });

    return {
      bookId: externalBookId,
      title: book.title,
      author: book.author,
      chapters,
    };
  }

  async fetchChapter(
    externalBookId: string,
    chapterId: string,
  ): Promise<QidianChapterContent> {
    const page = await this.client.fetchPage(
      `/chapter/${externalBookId}/${chapterId}/`,
    );
    return this.chapterParser.parse({
      html: page.html,
      sourceUrl: page.sourceUrl,
      bookId: externalBookId,
      chapterId,
    });
  }
}
```

- [ ] **Step 2: QidianModule 暴露 crawler**

修改 `src/crawlers/qidian/qidian.module.ts`：

```typescript
import { QidianChapterCrawler } from "./chapters/qidian-chapter.crawler";
```

在 providers 中新增：

```typescript
{
  provide: QidianChapterCrawler,
  inject: [QidianBrowserClient],
  useFactory: (client: QidianBrowserClient) =>
    new QidianChapterCrawler(client),
},
```

在 exports 中新增 `QidianChapterCrawler`。

- [ ] **Step 3: CrawlersModule 再导出**

修改 `src/crawlers/crawlers.module.ts`：

```typescript
import { QidianChapterCrawler } from "./qidian/chapters/qidian-chapter.crawler";
```

exports 改为：

```typescript
exports: [CrawlersService, QidianChapterCrawler],
```

- [ ] **Step 4: 验证编译**

Run:

```powershell
npx tsc --noEmit --incremental false
```

Expected: 无类型错误。

- [ ] **Step 5: Commit**

```powershell
git add src/crawlers
git commit -m "feat: add qidian chapter crawler"
```

---

## Task 6: 创建 QidianDownloadRunner

**Files:**
- Create: `src/downloads/runners/qidian/qidian-download.runner.ts`

- [ ] **Step 1: 创建 runner**

Create `src/downloads/runners/qidian/qidian-download.runner.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Injectable } from "@nestjs/common";
import { QidianChapterCrawler } from "../../../crawlers/qidian/chapters/qidian-chapter.crawler";
import { QidianChapterCrawlerError } from "../../../crawlers/qidian/chapters/qidian-chapter.error";
import type { QidianCatalogChapter } from "../../../crawlers/qidian/chapters/qidian-catalog.parser";
import type {
  ArtifactSource,
  BookDownloadJob,
  BookDownloadJobRef,
  BookDownloadRequest,
  BookDownloadRunner,
  BookDownloadJobState,
  DownloadTaskContext,
} from "../book-download-runner.interface";

interface RunningQidianJob {
  id: string;
  request: BookDownloadRequest;
  state: BookDownloadJobState;
  controller: AbortController;
  title: string | null;
  author: string | null;
  progress: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
  parts: string[];
}

@Injectable()
export class QidianDownloadRunner implements BookDownloadRunner {
  readonly platform = "qidian" as const;
  private readonly jobs = new Map<string, RunningQidianJob>();

  constructor(private readonly crawler: QidianChapterCrawler) {}

  async initialize(): Promise<void> {}

  async listJobs(): Promise<BookDownloadJob[]> {
    return [...this.jobs.values()].map((job) => this.toJob(job));
  }

  async createJob(request: BookDownloadRequest): Promise<BookDownloadJobRef> {
    const id = randomUUID();
    const job: RunningQidianJob = {
      id,
      request,
      state: "queued",
      controller: new AbortController(),
      title: null,
      author: null,
      progress: null,
      error: null,
      parts: [],
    };
    this.jobs.set(id, job);
    void this.execute(job);
    return { id };
  }

  async getJob(jobId: string): Promise<BookDownloadJob | null> {
    const job = this.jobs.get(jobId);
    return job === undefined ? null : this.toJob(job);
  }

  async cancelJob(jobId: string): Promise<void> {
    this.jobs.get(jobId)?.controller.abort();
  }

  async openArtifact(
    jobId: string,
    _task: DownloadTaskContext,
  ): Promise<ArtifactSource> {
    const job = this.jobs.get(jobId);
    if (job === undefined || job.state !== "done") {
      throw new Error("ARTIFACT_NOT_FOUND");
    }
    return {
      stream: Readable.from(job.parts),
      contentType: "text/plain; charset=utf-8",
    };
  }

  async releaseJob(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }

  private async execute(job: RunningQidianJob): Promise<void> {
    job.state = "running";
    try {
      const catalog = await this.crawler.fetchCatalog(
        job.request.externalBookId,
      );
      const chapters = this.selectRange(
        catalog.chapters,
        job.request.range,
      );
      job.title = catalog.title;
      job.author = catalog.author;
      job.parts.push(`${catalog.title}\n作者：${catalog.author}\n`);
      job.progress = {
        chapterTotal: chapters.length,
        savedChapters: 0,
        savePhase: "crawling",
      };

      let savedChapters = 0;
      for (const chapter of chapters) {
        this.throwIfAborted(job);
        const content = await this.crawler.fetchChapter(
          catalog.bookId,
          chapter.chapterId,
        );
        this.throwIfAborted(job);

        if (content.isVip) {
          this.stopAtVip(job, chapter);
          break;
        }
        if (content.encrypted) {
          throw new QidianChapterCrawlerError(
            "QIDIAN_CHAPTER_ENCRYPTED",
            `第${chapter.index}章「${chapter.title}」为字体加密章节，暂不支持下载`,
          );
        }

        savedChapters += 1;
        job.parts.push(`\n${chapter.title}\n\n${content.content}\n`);
        job.progress = {
          chapterTotal: chapters.length,
          savedChapters,
          savePhase: "crawling",
        };
      }

      if (savedChapters === 0) {
        throw new QidianChapterCrawlerError(
          "QIDIAN_RANGE_UNAVAILABLE",
          "范围内没有可下载的起点免费章节",
        );
      }

      job.progress = {
        ...(job.progress ?? {}),
        savePhase: "completed",
      };
      job.state = "done";
    } catch (error) {
      if (job.controller.signal.aborted) {
        job.state = "canceled";
        job.error = null;
        return;
      }
      job.state = "failed";
      job.error = normalizeError(error);
    }
  }

  private selectRange(
    chapters: QidianCatalogChapter[],
    range: BookDownloadRequest["range"],
  ): QidianCatalogChapter[] {
    const firstVipIndex =
      chapters.find((chapter) => chapter.isVip)?.index ?? null;
    let endIndex =
      firstVipIndex === null ? chapters.length : firstVipIndex - 1;

    if (range !== null) {
      if (
        range.startChapter < 1 ||
        range.endChapter > chapters.length
      ) {
        throw new QidianChapterCrawlerError(
          "QIDIAN_RANGE_INVALID",
          "起点章节范围超出目录",
        );
      }
      endIndex = Math.min(endIndex, range.endChapter);
      if (range.startChapter > endIndex) {
        throw new QidianChapterCrawlerError(
          "QIDIAN_RANGE_UNAVAILABLE",
          `起点第${range.startChapter}章为VIP章节，范围内没有可下载的免费章节`,
        );
      }
      return chapters.filter(
        (chapter) =>
          chapter.index >= range.startChapter &&
          chapter.index <= endIndex,
      );
    }

    if (endIndex < 1) {
      throw new QidianChapterCrawlerError(
        "QIDIAN_RANGE_UNAVAILABLE",
        "起点这本书没有可下载的免费章节",
      );
    }
    return chapters.filter((chapter) => chapter.index <= endIndex);
  }

  private stopAtVip(
    job: RunningQidianJob,
    chapter: QidianCatalogChapter,
  ): void {
    job.progress = {
      ...(job.progress ?? {}),
      stoppedAtChapter: chapter.index,
      stopReason: "CHAPTER_VIP",
    };
  }

  private throwIfAborted(job: RunningQidianJob): void {
    if (job.controller.signal.aborted) {
      throw new QidianChapterCrawlerError(
        "QIDIAN_JOB_CANCELED",
        "起点下载任务已取消",
      );
    }
  }

  private toJob(job: RunningQidianJob): BookDownloadJob {
    return {
      id: job.id,
      externalBookId: job.request.externalBookId,
      title: job.title,
      author: job.author,
      state: job.state,
      message: job.error?.message ?? null,
      progress: job.progress,
      error: job.error,
    };
  }
}

function normalizeError(error: unknown): { code: string; message: string } {
  if (error instanceof QidianChapterCrawlerError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "QIDIAN_CHAPTER_FETCH_FAILED",
    message: error instanceof Error ? error.message : "起点章节抓取失败",
  };
}
```

- [ ] **Step 2: 验证编译**

Run:

```powershell
npx tsc --noEmit --incremental false
```

Expected: 无类型错误。

- [ ] **Step 3: Commit**

```powershell
git add src/downloads/runners/qidian
git commit -m "feat: add qidian download runner"
```

---

## Task 7: Repository、Service、Controller 支持 platform

**Files:**
- Modify: `src/downloads/downloads.repository.ts`
- Modify: `src/downloads/downloads.service.ts`
- Modify: `src/downloads/downloads.controller.ts`
- Create: `src/downloads/dto/platform-book-download-params.dto.ts`

- [ ] **Step 1: Repository 接收 platform**

修改 `src/downloads/downloads.repository.ts` 的 `createQueued`：

```typescript
async createQueued(
  platform: Platform,
  externalBookId: string,
  range: ChapterRange | null,
): Promise<StoredBookDownload> {
  return this.prisma.$transaction(async (transaction) => {
    await transaction.book.createMany({
      data: [{ platform, externalBookId }],
      skipDuplicates: true,
    });
    const book = await transaction.book.findUniqueOrThrow({
      where: {
        platform_externalBookId: { platform, externalBookId },
      },
      select: { id: true },
    });
    return transaction.bookDownload.create({
      data: {
        bookId: book.id,
        startChapter: range?.startChapter ?? null,
        endChapter: range?.endChapter ?? null,
      },
      include: INCLUDE_BOOK,
    });
  });
}
```

顶部新增：

```typescript
import type { Platform } from "../shared/types/platform.type";
```

- [ ] **Step 2: Service 使用 registry**

修改 `src/downloads/downloads.service.ts`：

- 删除 `TomatoDownloaderClient` 导入，新增：

```typescript
import type { BookDownloadRunnerRegistry } from "./runners/book-download-runner.registry";
import type { Platform } from "../shared/types/platform.type";
```

- 构造函数改为：

```typescript
constructor(
  private readonly repository: DownloadsRepository,
  private readonly runners: BookDownloadRunnerRegistry,
  private readonly artifacts: ArtifactStore,
  private readonly clock: DownloadsClock,
) {}
```

- `create` 增加平台参数：

```typescript
async create(
  platform: Platform,
  externalBookId: string,
  range: Partial<ChapterRange>,
): Promise<DownloadResource> {
  const normalizedRange =
    range.startChapter !== undefined && range.endChapter !== undefined
      ? {
          startChapter: range.startChapter,
          endChapter: range.endChapter,
        }
      : null;
  return this.toResource(
    await this.repository.createQueued(
      platform,
      externalBookId,
      normalizedRange,
    ),
  );
}
```

- `cancel` 中的番茄客户端调用替换为：

```typescript
if (task.downstreamJobId !== null) {
  await Promise.resolve(
    this.runners.resolve(task.book.platform).cancelJob(task.downstreamJobId),
  ).catch(() => undefined);
}
```

- `toResource` 的 `platform` 改为：

```typescript
platform: task.book.platform,
```

- [ ] **Step 3: 创建 platform 参数 DTO**

Create `src/downloads/dto/platform-book-download-params.dto.ts`:

```typescript
import { IsIn, Matches } from "class-validator";
import type { Platform } from "../../shared/types/platform.type";
import { SUPPORTED_PLATFORMS } from "../../shared/types/platform.type";

export class PlatformBookDownloadParamsDto {
  @IsIn(SUPPORTED_PLATFORMS)
  platform!: Platform;

  @Matches(/^\d+$/)
  bookId!: string;
}
```

- [ ] **Step 4: Controller 增加通用路由并保留旧路由**

修改 `src/downloads/downloads.controller.ts`：

```typescript
import { PlatformBookDownloadParamsDto } from "./dto/platform-book-download-params.dto";
```

新增路由：

```typescript
@Post("books/:platform/:bookId/downloads")
@HttpCode(HttpStatus.ACCEPTED)
@ApiOperation({ summary: "创建正文下载任务" })
async create(
  @Param() params: PlatformBookDownloadParamsDto,
  @Body() body: CreateBookDownloadDto,
): Promise<DownloadResource> {
  return this.execute(() =>
    this.service.create(params.platform, params.bookId, body),
  );
}
```

旧路由改为：

```typescript
@Post("books/fanqie/:bookId/downloads")
@HttpCode(HttpStatus.ACCEPTED)
@ApiOperation({ summary: "创建番茄正文下载任务（兼容）" })
async createFanqie(
  @Param() params: FanqieDownloadBookParamsDto,
  @Body() body: CreateBookDownloadDto,
): Promise<DownloadResource> {
  return this.execute(() =>
    this.service.create("fanqie", params.bookId, body),
  );
}
```

- [ ] **Step 5: 验证编译**

Run:

```powershell
npx tsc --noEmit --incremental false
```

Expected: 无类型错误。

- [ ] **Step 6: Commit**

```powershell
git add src/downloads
git commit -m "feat: add platform-aware download API"
```

---

## Task 8: 重构 DownloadsWorker 使用 Registry

**Files:**
- Modify: `src/downloads/downloads.worker.ts`

- [ ] **Step 1: 替换依赖和核心流程**

修改 `src/downloads/downloads.worker.ts`：

- 删除 `TomatoDownloaderClient` 相关导入，新增：

```typescript
import type { BookDownloadRunner } from "./runners/book-download-runner.interface";
import type { BookDownloadRunnerRegistry } from "./runners/book-download-runner.registry";
```

- 构造函数改为：

```typescript
constructor(
  private readonly repository: DownloadsRepository,
  private readonly runners: BookDownloadRunnerRegistry,
  private readonly artifacts: ArtifactStore,
  private readonly clock: DownloadsWorkerClock,
  private readonly sleeper: DownloadsWorkerSleeper,
  private readonly options: DownloadsWorkerOptions,
) {}
```

- 将 `initialize` 中的番茄客户端调用替换为：

```typescript
for (const runner of this.runners.list()) {
  await runner.initialize();
}
const downstreamJobs = (
  await Promise.all(
    this.runners.list().map(async (runner) => ({
      platform: runner.platform,
      jobs: await runner.listJobs(),
    })),
  )
).flatMap((entry) =>
  entry.jobs.map((job) => ({ platform: entry.platform, job })),
);
```

- 将 recoverable 校验改为按 `task.book.platform` 找 runner 和 job：

```typescript
const knownJobIds = new Set(
  recoverable
    .map((task) => task.downstreamJobId)
    .filter((value): value is string => value !== null),
);
const unknownActive = downstreamJobs.find(
  ({ job }) =>
    (job.state === "queued" || job.state === "running") &&
    !knownJobIds.has(job.id),
);
```

- 将 `processOnce` 中的 `this.client` 替换为 `this.runners.resolve(task.book.platform)`，并在创建下游任务前保存 runner：

```typescript
const runner = this.runners.resolve(task.book.platform);
if (task.downstreamJobId === null) {
  const downstream = await runner.createJob({
    externalBookId: task.book.externalBookId,
    range:
      task.startChapter === null || task.endChapter === null
        ? null
        : { startChapter: task.startChapter, endChapter: task.endChapter },
  });
  ...
}
...
const job = await runner.getJob(downstreamJobId);
```

- 在 `processOnce` 的 `case "failed"` 中改为：

```typescript
case "failed":
  await this.fail(
    task,
    job.error?.code ?? "DOWNLOADER_REJECTED",
    job.error?.message ?? "Downloader rejected the task",
  );
  return;
```

- 将 `complete` 中的 artifact 获取替换为：

```typescript
const source = await runner.openArtifact(
  job.id,
  { id: task.id, startedAt: task.startedAt },
  signal,
);
```

- 在 `complete` 的 catch 中，先检查 `error.code` 是否为可展示错误码，再回退到 `ARTIFACT_STORE_FAILED`：

```typescript
const code =
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof error.code === "string"
    ? error.code
    : "ARTIFACT_STORE_FAILED";
await this.fail(
  task,
  code,
  String(error instanceof Error ? error.message : error),
);
```

- `complete`、`timeout`、`finishMissingTask` 中调用 runner 的 `cancelJob` 或 `releaseJob`。

- 将 `fail` 扩展为支持任意错误码：

```typescript
private async fail(
  task: StoredBookDownload,
  code: string,
  message: string,
): Promise<void> {
  await this.repository.fail(task.id, {
    code,
    message,
    finishedAt: this.clock.now(),
  });
  this.activeTaskId = null;
}
```

删除 worker 内番茄专用的 `assertContract`、`findArtifact` 和 `downloaderSafeFsName`，它们已移入 `FanqieDownloadRunner`。

- [ ] **Step 2: 验证编译**

Run:

```powershell
npx tsc --noEmit --incremental false
```

Expected: 无类型错误。

- [ ] **Step 3: Commit**

```powershell
git add src/downloads/downloads.worker.ts
git commit -m "refactor: route download worker through runner registry"
```

---

## Task 9: 更新 DownloadsModule 依赖注入

**Files:**
- Modify: `src/downloads/downloads.module.ts`
- Modify: `src/downloads/interfaces/download.interface.ts`
- Modify: `src/downloads/dto/create-book-download.dto.ts`
- Modify: `src/downloads/dto/create-book-download.swagger.spec.ts`

- [ ] **Step 1: 更新接口类型**

修改 `src/downloads/interfaces/download.interface.ts`：

```typescript
import type { Platform } from "../../shared/types/platform.type";
```

将 `DownloadResource.platform` 改为：

```typescript
platform: Platform;
```

- [ ] **Step 2: 更新 DTO Swagger 可见性**

当前 `CreateBookDownloadDto` 的私有 `chapterRangeOrder` 已有 `@ApiHideProperty()`，保持不变。若 `npm run swagger:compile` 报循环依赖，确认该字段仍然隐藏。

- [ ] **Step 3: 更新 Module**

修改 `src/downloads/downloads.module.ts`：

```typescript
import { CrawlersModule } from "../crawlers/crawlers.module";
import { QidianChapterCrawler } from "../crawlers/qidian/chapters/qidian-chapter.crawler";
import { BookDownloadRunnerRegistry } from "./runners/book-download-runner.registry";
import { FanqieDownloadRunner } from "./runners/fanqie/fanqie-download.runner";
import { QidianDownloadRunner } from "./runners/qidian/qidian-download.runner";
```

`imports` 改为：

```typescript
imports: [
  ConfigModule.forFeature(downloadConfig),
  DatabaseModule,
  CrawlersModule,
],
```

providers 新增：

```typescript
{
  provide: FanqieDownloadRunner,
  inject: [TomatoDownloaderClient],
  useFactory: (client: TomatoDownloaderClient) =>
    new FanqieDownloadRunner(client),
},
{
  provide: QidianDownloadRunner,
  inject: [QidianChapterCrawler],
  useFactory: (crawler: QidianChapterCrawler) =>
    new QidianDownloadRunner(crawler),
},
{
  provide: BookDownloadRunnerRegistry,
  inject: [FanqieDownloadRunner, QidianDownloadRunner],
  useFactory: (
    fanqie: FanqieDownloadRunner,
    qidian: QidianDownloadRunner,
  ) => new BookDownloadRunnerRegistry(fanqie, qidian),
},
```

`DownloadsService` 和 `DownloadsWorker` 的注入列表中把 `TomatoDownloaderClient` 替换为 `BookDownloadRunnerRegistry`，对应 factory 参数也替换为 `runners`。

- [ ] **Step 4: 验证 Swagger 编译**

Run:

```powershell
npm run swagger:compile
npx tsc --noEmit --incremental false
```

Expected: Swagger 插件编译通过，无类型错误。

- [ ] **Step 5: Commit**

```powershell
git add src/downloads
git commit -m "feat: wire qidian runner into downloads module"
```

---

## Task 10: 文档和最终验证

**Files:**
- Modify: `docs/API.md`
- Modify: `docs/USAGE.md`

- [ ] **Step 1: 更新 API 文档**

在 `docs/API.md` 的下载章节增加：

```text
POST /v1/books/qidian/:bookId/downloads
```

说明：

- 支持 `startChapter`/`endChapter` 1-based 闭区间。
- 目录按全局顺序编号。
- 遇到第一个 VIP 章节停止。
- 范围起点是 VIP 或范围内没有免费章节时任务失败。

- [ ] **Step 2: 更新使用文档**

在 `docs/USAGE.md` 增加一条起点 TXT 下载示例，与番茄流程保持一致。

- [ ] **Step 3: 全量验证**

Run:

```powershell
npm run lint
npm run build
npx tsc --noEmit --incremental false
git diff --check
```

Expected: 全部通过。

- [ ] **Step 4: 手工冒烟**

启动 API 后执行：

```powershell
$bookId = "1043182343"
$body = @{ startChapter = 1; endChapter = 3 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3000/v1/books/qidian/$bookId/downloads" -ContentType "application/json" -Body $body
```

确认任务最终 `succeeded`，并且 `GET /v1/downloads/:id/file` 返回 TXT。

- [ ] **Step 5: Commit**

```powershell
git add docs/API.md docs/USAGE.md
git commit -m "docs: document qidian download workflow"
```
