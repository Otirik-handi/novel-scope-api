import { BadGatewayException } from "@nestjs/common";
import { validate } from "class-validator";
import { BookParamsDto } from "./dto/book-params.dto";
import { BooksController } from "./books.controller";
import {
  BookRefreshError,
  type BooksService,
} from "./books.service";

describe("book route DTO", () => {
  it.each([
    { platform: "other", bookId: "1031940621" },
    { platform: "qidian", bookId: "abc" },
    { platform: "qidian", bookId: "12.3" },
    { platform: "qidian", bookId: "+123" },
    { platform: "qidian", bookId: " 123 " },
  ])("rejects unsupported route parameters %p", async (values) => {
    const dto = Object.assign(new BookParamsDto(), values);

    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });

  it.each(["qidian", "fanqie"] as const)(
    "accepts %s and a numeric book ID",
    async (platform) => {
    const dto = Object.assign(new BookParamsDto(), {
      platform,
      bookId: "1031940621",
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    },
  );
});

describe("BooksController", () => {
  function createSubject() {
    const service = { getDetail: jest.fn(), refreshDetail: jest.fn() };
    return {
      controller: new BooksController(service as unknown as BooksService),
      service,
    };
  }

  it("returns a fresh or stale book resource directly", async () => {
    const { controller, service } = createSubject();
    const resource = {
      platform: "qidian",
      externalBookId: "1031940621",
      title: "测试作品",
      stale: true,
    };
    service.getDetail.mockResolvedValue(resource);

    await expect(
      controller.getDetail({ platform: "qidian", bookId: "1031940621" }),
    ).resolves.toBe(resource);
  });

  it("maps a book refresh domain error to a safe 502", async () => {
    const { controller, service } = createSubject();
    service.getDetail.mockRejectedValue(
      new BookRefreshError(new Error("axios failed with secret-token")),
    );

    let caught: unknown;
    try {
      await controller.getDetail({
        platform: "qidian",
        bookId: "1031940621",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BadGatewayException);
    expect((caught as BadGatewayException).getResponse()).toEqual({
      statusCode: 502,
      message: "Failed to fetch book detail",
      error: "Bad Gateway",
    });
    expect(
      JSON.stringify((caught as BadGatewayException).getResponse()),
    ).not.toContain("secret");
  });

  it("rethrows an initial database lookup error for Nest to map to 500", async () => {
    const { controller, service } = createSubject();
    const databaseError = new Error("prisma lookup failed");
    service.getDetail.mockRejectedValue(databaseError);

    await expect(
      controller.getDetail({ platform: "qidian", bookId: "1031940621" }),
    ).rejects.toBe(databaseError);
  });

  it("returns a forced Fanqie refresh directly", async () => {
    const { controller, service } = createSubject();
    const resource = {
      platform: "fanqie",
      externalBookId: "7621419029625834521",
      stale: false,
    };
    service.refreshDetail.mockResolvedValue(resource);

    await expect(
      controller.refreshDetail({
        platform: "fanqie",
        bookId: "7621419029625834521",
      }),
    ).resolves.toBe(resource);
  });

  it("maps a forced refresh domain error to a safe 502", async () => {
    const { controller, service } = createSubject();
    service.refreshDetail.mockRejectedValue(
      new BookRefreshError(new Error("private crawler failure")),
    );

    await expect(
      controller.refreshDetail({
        platform: "fanqie",
        bookId: "7621419029625834521",
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
