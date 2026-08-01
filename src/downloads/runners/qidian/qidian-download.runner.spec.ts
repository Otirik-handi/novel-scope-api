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
  });
});
