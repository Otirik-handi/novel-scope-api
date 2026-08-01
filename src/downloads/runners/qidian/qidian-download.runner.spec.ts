import { QidianDownloadRunner } from "./qidian-download.runner";

async function waitForTerminal(
  runner: QidianDownloadRunner,
  jobId: string,
) {
  for (let i = 0; i < 100; i += 1) {
    const job = await runner.getJob(jobId);
    if (
      job !== null &&
      ["done", "failed", "canceled"].includes(job.state)
    ) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for qidian job");
}

function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    stream.on("data", (chunk) => {
      text += String(chunk);
    });
    stream.on("end", () => resolve(text));
    stream.on("error", reject);
  });
}

async function waitForCall(mock: jest.Mock): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (mock.mock.calls.length > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for mock call");
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("QidianDownloadRunner", () => {
  it("downloads free chapters and stops at the first vip chapter", async () => {
    const crawler = {
      fetchCatalog: jest.fn().mockResolvedValue({
        bookId: "1",
        title: "Test Book",
        author: "Test Author",
        chapters: [
          { index: 1, title: "One", chapterId: "100", sourceUrl: "https://www.qidian.com/chapter/1/100/", isVip: false },
          { index: 2, title: "Two", chapterId: "200", sourceUrl: "https://www.qidian.com/chapter/1/200/", isVip: false },
          { index: 3, title: "Three", chapterId: "300", sourceUrl: "https://www.qidian.com/chapter/1/300/", isVip: true },
        ],
      }),
      fetchChapter: jest.fn().mockResolvedValue({
        title: "Chapter",
        content: "Body text",
        isVip: false,
      }),
    };

    const runner = new QidianDownloadRunner(crawler as never);
    const ref = await runner.createJob({ externalBookId: "1", range: null });
    const job = await waitForTerminal(runner, ref.id);

    expect(job.state).toBe("done");
    expect(job.progress).toMatchObject({
      savedChapters: 2,
      stoppedAtChapter: 3,
      stopReason: "CHAPTER_VIP",
    });
    expect(crawler.fetchChapter).toHaveBeenCalledTimes(2);
    expect(crawler.fetchCatalog).toHaveBeenCalledWith(
      "1",
      expect.any(AbortSignal),
    );
    expect(crawler.fetchChapter).toHaveBeenCalledWith(
      "1",
      "100",
      expect.any(AbortSignal),
    );

    const artifact = await runner.openArtifact(
      ref.id,
      { id: "task-1", startedAt: null },
      new AbortController().signal,
    );
    const body = await readStream(artifact.stream);

    expect(body).toContain("\u4f5c\u8005\uff1aTest Author");
    expect(body).not.toContain("Author:");
  });

  it("maps a missing artifact to BookDownloadRunnerError", async () => {
    const crawler = {
      fetchCatalog: jest.fn(),
      fetchChapter: jest.fn(),
    };
    const runner = new QidianDownloadRunner(crawler as never);

    await expect(
      runner.openArtifact(
        "missing",
        { id: "task-missing", startedAt: null },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      name: "BookDownloadRunnerError",
      code: "ARTIFACT_NOT_FOUND",
      message: "Qidian artifact was not found",
    });
  });

  it("preserves a Qidian access-blocked error with a Chinese message", async () => {
    const crawler = {
      fetchCatalog: jest.fn().mockResolvedValue({
        bookId: "1",
        title: "Test Book",
        author: "Test Author",
        chapters: [
          {
            index: 1,
            title: "One",
            chapterId: "100",
            sourceUrl: "https://www.qidian.com/chapter/1/100/",
            isVip: false,
          },
        ],
      }),
      fetchChapter: jest.fn().mockRejectedValue({
        code: "QIDIAN_ACCESS_BLOCKED",
        message: "Qidian access was blocked",
      }),
    };
    const runner = new QidianDownloadRunner(crawler as never);

    const ref = await runner.createJob({ externalBookId: "1", range: null });
    const job = await waitForTerminal(runner, ref.id);

    expect(job.state).toBe("failed");
    expect(job.error).toEqual({
      code: "QIDIAN_ACCESS_BLOCKED",
      message: "\u8d77\u70b9\u8bbf\u95ee\u53d7\u9650",
    });
  });

  it("reports an invalid range in Chinese", async () => {
    const crawler = {
      fetchCatalog: jest.fn().mockResolvedValue({
        bookId: "1",
        title: "Test Book",
        author: "Test Author",
        chapters: [
          {
            index: 1,
            title: "One",
            chapterId: "100",
            sourceUrl: "https://www.qidian.com/chapter/1/100/",
            isVip: false,
          },
        ],
      }),
      fetchChapter: jest.fn(),
    };
    const runner = new QidianDownloadRunner(crawler as never);

    const ref = await runner.createJob({
      externalBookId: "1",
      range: { startChapter: 0, endChapter: 1 },
    });
    const job = await waitForTerminal(runner, ref.id);

    expect(job.state).toBe("failed");
    expect(job.error).toEqual({
      code: "QIDIAN_RANGE_INVALID",
      message: "\u8d77\u70b9\u7ae0\u8282\u8303\u56f4\u65e0\u6548",
    });
  });

  it("rejects a range whose start is after its end", async () => {
    const crawler = {
      fetchCatalog: jest.fn().mockResolvedValue({
        bookId: "1",
        title: "Test Book",
        author: "Test Author",
        chapters: Array.from({ length: 5 }, (_, index) => ({
          index: index + 1,
          title: `Chapter ${index + 1}`,
          chapterId: String(100 + index),
          sourceUrl: `https://www.qidian.com/chapter/1/${100 + index}/`,
          isVip: false,
        })),
      }),
      fetchChapter: jest.fn(),
    };
    const runner = new QidianDownloadRunner(crawler as never);

    const ref = await runner.createJob({
      externalBookId: "1",
      range: { startChapter: 5, endChapter: 4 },
    });
    const job = await waitForTerminal(runner, ref.id);

    expect(job.state).toBe("failed");
    expect(job.error).toEqual({
      code: "QIDIAN_RANGE_INVALID",
      message: "\u8d77\u70b9\u7ae0\u8282\u8303\u56f4\u65e0\u6548",
    });
    expect(crawler.fetchChapter).not.toHaveBeenCalled();
  });

  it("reports an unavailable starting chapter in Chinese", async () => {
    const crawler = {
      fetchCatalog: jest.fn().mockResolvedValue({
        bookId: "1",
        title: "Test Book",
        author: "Test Author",
        chapters: [
          {
            index: 1,
            title: "One",
            chapterId: "100",
            sourceUrl: "https://www.qidian.com/chapter/1/100/",
            isVip: false,
          },
          {
            index: 2,
            title: "Two",
            chapterId: "200",
            sourceUrl: "https://www.qidian.com/chapter/1/200/",
            isVip: true,
          },
        ],
      }),
      fetchChapter: jest.fn(),
    };
    const runner = new QidianDownloadRunner(crawler as never);

    const ref = await runner.createJob({
      externalBookId: "1",
      range: { startChapter: 2, endChapter: 2 },
    });
    const job = await waitForTerminal(runner, ref.id);

    expect(job.state).toBe("failed");
    expect(job.error).toEqual({
      code: "QIDIAN_RANGE_UNAVAILABLE",
      message: "\u8303\u56f4\u5185\u6ca1\u6709\u53ef\u4e0b\u8f7d\u7684\u8d77\u70b9\u514d\u8d39\u7ae0\u8282",
    });
  });

  it("reports a book with no free chapters in Chinese", async () => {
    const crawler = {
      fetchCatalog: jest.fn().mockResolvedValue({
        bookId: "1",
        title: "Test Book",
        author: "Test Author",
        chapters: [
          {
            index: 1,
            title: "One",
            chapterId: "100",
            sourceUrl: "https://www.qidian.com/chapter/1/100/",
            isVip: true,
          },
        ],
      }),
      fetchChapter: jest.fn(),
    };
    const runner = new QidianDownloadRunner(crawler as never);

    const ref = await runner.createJob({ externalBookId: "1", range: null });
    const job = await waitForTerminal(runner, ref.id);

    expect(job.state).toBe("failed");
    expect(job.error).toEqual({
      code: "QIDIAN_RANGE_UNAVAILABLE",
      message: "\u8303\u56f4\u5185\u6ca1\u6709\u53ef\u4e0b\u8f7d\u7684\u8d77\u70b9\u514d\u8d39\u7ae0\u8282",
    });
  });

  it("maps a non-Qidian catalog fetch failure to QIDIAN_CATALOG_FETCH_FAILED", async () => {
    const crawler = {
      fetchCatalog: jest.fn().mockRejectedValue({ reason: "network down" }),
      fetchChapter: jest.fn(),
    };
    const runner = new QidianDownloadRunner(crawler as never);

    const ref = await runner.createJob({ externalBookId: "1", range: null });
    const job = await waitForTerminal(runner, ref.id);

    expect(job.state).toBe("failed");
    expect(job.error).toEqual({
      code: "QIDIAN_CATALOG_FETCH_FAILED",
      message: "\u8d77\u70b9\u76ee\u5f55\u6293\u53d6\u5931\u8d25",
    });
    expect(crawler.fetchChapter).not.toHaveBeenCalled();
  });

  it("uses the Chinese fallback message for non-Qidian failures", async () => {
    const crawler = {
      fetchCatalog: jest.fn().mockResolvedValue({
        bookId: "1",
        title: "Test Book",
        author: "Test Author",
        chapters: [
          {
            index: 1,
            title: "One",
            chapterId: "100",
            sourceUrl: "https://www.qidian.com/chapter/1/100/",
            isVip: false,
          },
        ],
      }),
      fetchChapter: jest.fn().mockRejectedValue({ reason: "network down" }),
    };
    const runner = new QidianDownloadRunner(crawler as never);

    const ref = await runner.createJob({ externalBookId: "1", range: null });
    const job = await waitForTerminal(runner, ref.id);

    expect(job.state).toBe("failed");
    expect(job.error).toEqual({
      code: "QIDIAN_CHAPTER_FETCH_FAILED",
      message: "\u8d77\u70b9\u7ae0\u8282\u6293\u53d6\u5931\u8d25",
    });
  });

  it("normalizes unknown QIDIAN_ codes to the chapter fetch fallback", async () => {
    const crawler = {
      fetchCatalog: jest.fn().mockResolvedValue({
        bookId: "1",
        title: "Test Book",
        author: "Test Author",
        chapters: [
          {
            index: 1,
            title: "One",
            chapterId: "100",
            sourceUrl: "https://www.qidian.com/chapter/1/100/",
            isVip: false,
          },
        ],
      }),
      fetchChapter: jest.fn().mockRejectedValue({
        code: "QIDIAN_UNKNOWN",
        message: "unknown qidian error",
      }),
    };
    const runner = new QidianDownloadRunner(crawler as never);

    const ref = await runner.createJob({ externalBookId: "1", range: null });
    const job = await waitForTerminal(runner, ref.id);

    expect(job.state).toBe("failed");
    expect(job.error).toEqual({
      code: "QIDIAN_CHAPTER_FETCH_FAILED",
      message: "\u8d77\u70b9\u7ae0\u8282\u6293\u53d6\u5931\u8d25",
    });
  });

  it("marks a job canceled with no error after cancelJob", async () => {
    const chapter = deferred<{
      title: string;
      content: string;
      isVip: boolean;
    }>();
    const crawler = {
      fetchCatalog: jest.fn().mockResolvedValue({
        bookId: "1",
        title: "Test Book",
        author: "Test Author",
        chapters: [
          {
            index: 1,
            title: "One",
            chapterId: "100",
            sourceUrl: "https://www.qidian.com/chapter/1/100/",
            isVip: false,
          },
        ],
      }),
      fetchChapter: jest.fn().mockReturnValue(chapter.promise),
    };
    const runner = new QidianDownloadRunner(crawler as never);

    const ref = await runner.createJob({ externalBookId: "1", range: null });
    await waitForCall(crawler.fetchChapter);
    await runner.cancelJob(ref.id);
    chapter.resolve({
      title: "One",
      content: "Body text",
      isVip: false,
    });

    const job = await waitForTerminal(runner, ref.id);

    expect(job.state).toBe("canceled");
    expect(job.error).toBeNull();
    expect(job.message).toBeNull();
  });

  it("reports numeric timestamps with updatedAtMs after createdAtMs", async () => {
    const crawler = {
      fetchCatalog: jest.fn().mockResolvedValue({
        bookId: "1",
        title: "Test Book",
        author: "Test Author",
        chapters: [
          {
            index: 1,
            title: "One",
            chapterId: "100",
            sourceUrl: "https://www.qidian.com/chapter/1/100/",
            isVip: false,
          },
        ],
      }),
      fetchChapter: jest.fn().mockResolvedValue({
        title: "One",
        content: "Body text",
        isVip: false,
      }),
    };
    const runner = new QidianDownloadRunner(crawler as never);

    const ref = await runner.createJob({ externalBookId: "1", range: null });
    const job = await waitForTerminal(runner, ref.id);

    expect(typeof job.createdAtMs).toBe("number");
    expect(typeof job.updatedAtMs).toBe("number");
    expect(job.updatedAtMs).toBeGreaterThanOrEqual(job.createdAtMs);
  });
});
