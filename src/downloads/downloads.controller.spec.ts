import {
  ConflictException,
  GoneException,
  NotFoundException,
  StreamableFile,
} from "@nestjs/common";
import { validate } from "class-validator";
import { Readable } from "node:stream";
import { CreateBookDownloadDto } from "./dto/create-book-download.dto";
import { DownloadsController } from "./downloads.controller";
import {
  DownloadArtifactGoneError,
  DownloadConflictError,
  DownloadNotFoundError,
  type DownloadsService,
} from "./downloads.service";

describe("download DTO", () => {
  it.each([
    {},
    { startChapter: 1, endChapter: 1 },
    { startChapter: 20, endChapter: 30 },
  ])("accepts a valid body %p", async (body) => {
    await expect(
      validate(Object.assign(new CreateBookDownloadDto(), body)),
    ).resolves.toHaveLength(0);
  });

  it.each([
    { startChapter: 1 },
    { endChapter: 1 },
    { startChapter: 0, endChapter: 1 },
    { startChapter: 2, endChapter: 1 },
    { startChapter: 1.5, endChapter: 2 },
  ])("rejects an invalid body %p", async (body) => {
    await expect(
      validate(Object.assign(new CreateBookDownloadDto(), body)),
    ).resolves.not.toHaveLength(0);
  });
});

describe("DownloadsController", () => {
  function createSubject() {
    const service = {
      create: jest.fn(),
      get: jest.fn(),
      openFile: jest.fn(),
      cancel: jest.fn(),
      delete: jest.fn(),
    };
    return {
      controller: new DownloadsController(service as unknown as DownloadsService),
      service,
    };
  }

  it("returns created tasks directly", async () => {
    const { controller, service } = createSubject();
    const resource = { id: "download-1", status: "queued" };
    service.create.mockResolvedValue(resource);
    await expect(
      controller.create({ bookId: "7069948840148732967" }, {}),
    ).resolves.toBe(resource);
  });

  it.each([
    [new DownloadNotFoundError(), NotFoundException],
    [new DownloadConflictError(), ConflictException],
    [new DownloadArtifactGoneError(), GoneException],
  ])("maps domain errors safely", async (error, expected) => {
    const { controller, service } = createSubject();
    service.get.mockRejectedValue(error);
    await expect(controller.get({ downloadId: "download-1" })).rejects.toBeInstanceOf(
      expected,
    );
  });

  it("returns a StreamableFile with safe headers", async () => {
    const { controller, service } = createSubject();
    service.openFile.mockResolvedValue({
      stream: Readable.from(["正文"]),
      filename: "测试小说.txt",
      sizeBytes: 6,
    });
    const result = await controller.file({ downloadId: "download-1" });
    expect(result).toBeInstanceOf(StreamableFile);
    expect(service.openFile).toHaveBeenCalledWith("download-1");
  });
});
