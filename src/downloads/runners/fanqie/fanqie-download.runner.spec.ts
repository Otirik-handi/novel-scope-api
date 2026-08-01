import { FanqieDownloadRunner } from "./fanqie-download.runner";
import type { TomatoDownloaderClient } from "./tomato-downloader/tomato-downloader.client";
import { TomatoDownloaderClientError } from "./tomato-downloader/tomato-downloader.client";

describe("FanqieDownloadRunner", () => {
  it("maps a missing artifact to ARTIFACT_NOT_FOUND", async () => {
    const client = {
      getJob: jest.fn().mockResolvedValue({
        id: "job-1",
        bookId: "book-1",
        title: "Test Novel",
        author: "Author",
        state: "done",
        message: null,
        progress: null,
        createdAtMs: 1,
        updatedAtMs: 2,
      }),
      scanLibrary: jest.fn().mockResolvedValue({ running: false, items: [] }),
      openArtifact: jest.fn(),
    } as unknown as TomatoDownloaderClient;

    const runner = new FanqieDownloadRunner(client);
    const task = { id: "download-1", startedAt: new Date("2026-08-01T00:00:00.000Z") };

    await expect(
      runner.openArtifact("job-1", task, new AbortController().signal),
    ).rejects.toMatchObject({ code: "ARTIFACT_NOT_FOUND" });
  });

  it("maps downloader 404 to ARTIFACT_NOT_FOUND", async () => {
    const signal = new AbortController().signal;
    const client = {
      getJob: jest.fn().mockResolvedValue({
        id: "job-7",
        bookId: "book-1",
        title: "Test Novel",
        author: "Author",
        state: "done",
        message: null,
        progress: null,
        createdAtMs: 1,
        updatedAtMs: 2,
      }),
      scanLibrary: jest.fn().mockResolvedValue({
        running: false,
        items: [
          {
            kind: "file",
            name: "Test Novel.txt",
            relativePath: "Test Novel.txt",
            extension: "txt",
            sizeBytes: 1,
            modifiedAtMs: Date.now(),
          },
        ],
      }),
      openArtifact: jest
        .fn()
        .mockRejectedValue(
          new TomatoDownloaderClientError(
            "NOT_FOUND",
            "Downloader artifact was not found",
          ),
        ),
    } as unknown as TomatoDownloaderClient;

    const runner = new FanqieDownloadRunner(client);
    const task = { id: "download-7", startedAt: new Date() };

    await expect(
      runner.openArtifact("job-7", task, signal),
    ).rejects.toMatchObject({ code: "ARTIFACT_NOT_FOUND" });
  });

  it("rejects an artifact for a job that is not done", async () => {
    const client = {
      getJob: jest.fn().mockResolvedValue({
        id: "job-2",
        bookId: "book-1",
        title: "Test Novel",
        author: "Author",
        state: "running",
        message: null,
        progress: null,
        createdAtMs: 1,
        updatedAtMs: 2,
      }),
      scanLibrary: jest.fn(),
      openArtifact: jest.fn(),
    } as unknown as TomatoDownloaderClient;

    const runner = new FanqieDownloadRunner(client);
    const task = { id: "download-2", startedAt: new Date("2026-08-01T00:00:00.000Z") };

    await expect(
      runner.openArtifact("job-2", task, new AbortController().signal),
    ).rejects.toMatchObject({ code: "ARTIFACT_NOT_FOUND" });
  });

  it("preserves downloader job timestamps", async () => {
    const client = {
      getJob: jest.fn().mockResolvedValue({
        id: "job-1",
        bookId: "book-1",
        title: "Test Novel",
        author: "Author",
        state: "done",
        message: null,
        progress: null,
        createdAtMs: 1,
        updatedAtMs: 2,
      }),
    } as unknown as TomatoDownloaderClient;

    const runner = new FanqieDownloadRunner(client);

    await expect(runner.getJob("job-1")).resolves.toMatchObject({
      createdAtMs: 1,
      updatedAtMs: 2,
    });
  });

  it("opens a matching artifact for a done job", async () => {
    const signal = new AbortController().signal;
    const stream = { pipe() {} } as never;
    const client = {
      getJob: jest.fn().mockResolvedValue({
        id: "job-3",
        bookId: "book-1",
        title: "Test Novel",
        author: "Author",
        state: "done",
        message: null,
        progress: null,
        createdAtMs: 1,
        updatedAtMs: 2,
      }),
      scanLibrary: jest.fn().mockResolvedValue({
        running: false,
        items: [
          {
            kind: "file",
            name: "Test Novel.txt",
            relativePath: "Test Novel.txt",
            extension: "txt",
            sizeBytes: 1,
            modifiedAtMs: Date.now(),
          },
        ],
      }),
      openArtifact: jest.fn().mockResolvedValue({
        stream,
        contentType: "text/plain; charset=utf-8",
      }),
    } as unknown as TomatoDownloaderClient;

    const runner = new FanqieDownloadRunner(client);
    const task = { id: "download-3", startedAt: new Date() };

    await expect(
      runner.openArtifact("job-3", task, signal),
    ).resolves.toEqual({ stream, contentType: "text/plain; charset=utf-8" });
    expect(client.openArtifact).toHaveBeenCalledWith(
      "Test Novel.txt",
      signal,
    );
  });

  it("hides downloader failure details from the error contract", async () => {
    const client = {
      getJob: jest.fn().mockResolvedValue({
        id: "job-4",
        bookId: "book-1",
        title: "Test Novel",
        author: "Author",
        state: "failed",
        message: "C:/secret/downloader/path",
        progress: null,
        createdAtMs: 1,
        updatedAtMs: 2,
      }),
      listJobs: jest.fn(),
      createJob: jest.fn(),
      cancelJob: jest.fn(),
      scanLibrary: jest.fn(),
      openArtifact: jest.fn(),
    } as unknown as TomatoDownloaderClient;

    const runner = new FanqieDownloadRunner(client);
    const job = await runner.getJob("job-4");

    expect(job?.message).toBeNull();
    expect(JSON.stringify(job)).not.toContain("C:/secret/downloader/path");
    expect(job?.error).toEqual({
      code: "DOWNLOADER_REJECTED",
      message: "Downloader rejected the task",
    });
  });

  it("rejects ambiguous artifact candidates", async () => {
    const signal = new AbortController().signal;
    const client = {
      getJob: jest.fn().mockResolvedValue({
        id: "job-5",
        bookId: "book-1",
        title: "Test Novel",
        author: "Author",
        state: "done",
        message: null,
        progress: null,
        createdAtMs: 1,
        updatedAtMs: 2,
      }),
      scanLibrary: jest.fn().mockResolvedValue({
        running: false,
        items: [
          {
            kind: "file",
            name: "Test Novel.txt",
            relativePath: "Test Novel.txt",
            extension: "txt",
            sizeBytes: 1,
            modifiedAtMs: Date.now(),
          },
          {
            kind: "file",
            name: "Test Novel.txt",
            relativePath: "Test Novel (2).txt",
            extension: "txt",
            sizeBytes: 1,
            modifiedAtMs: Date.now(),
          },
        ],
      }),
      openArtifact: jest.fn(),
    } as unknown as TomatoDownloaderClient;

    const runner = new FanqieDownloadRunner(client);
    const task = { id: "download-5", startedAt: new Date() };

    await expect(
      runner.openArtifact("job-5", task, signal),
    ).rejects.toMatchObject({ code: "ARTIFACT_NOT_FOUND" });
  });

  it("rejects stale artifact candidates", async () => {
    const signal = new AbortController().signal;
    const startedAt = new Date("2026-08-01T12:00:00.000Z");
    const client = {
      getJob: jest.fn().mockResolvedValue({
        id: "job-6",
        bookId: "book-1",
        title: "Test Novel",
        author: "Author",
        state: "done",
        message: null,
        progress: null,
        createdAtMs: 1,
        updatedAtMs: 2,
      }),
      scanLibrary: jest.fn().mockResolvedValue({
        running: false,
        items: [
          {
            kind: "file",
            name: "Test Novel.txt",
            relativePath: "Test Novel.txt",
            extension: "txt",
            sizeBytes: 1,
            modifiedAtMs: startedAt.getTime() - 60_000,
          },
        ],
      }),
      openArtifact: jest.fn(),
    } as unknown as TomatoDownloaderClient;

    const runner = new FanqieDownloadRunner(client);
    const task = { id: "download-6", startedAt };

    await expect(
      runner.openArtifact("job-6", task, signal),
    ).rejects.toMatchObject({ code: "ARTIFACT_NOT_FOUND" });
  });
});
