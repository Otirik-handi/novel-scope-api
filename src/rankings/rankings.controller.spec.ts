import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { validate } from "class-validator";
import { RankingParamsDto } from "./dto/ranking-params.dto";
import { PlatformParamsDto } from "./dto/platform-params.dto";
import { RankingsController } from "./rankings.controller";
import type { RankingsService } from "./rankings.service";

describe("ranking route DTOs", () => {
  it.each([
    [PlatformParamsDto, { platform: "other" }],
    [RankingParamsDto, { platform: "qidian", rankTypeKey: "" }],
  ])("rejects unsupported route parameters", async (Dto, values) => {
    const dto = Object.assign(new Dto(), values);

    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });

  it.each([
    { platform: "qidian", rankTypeKey: "collect" },
    { platform: "fanqie", rankTypeKey: "0_1_1139" },
    { platform: "qidian", rankTypeKey: "unknown" },
  ])("accepts a non-empty ranking key shape for $platform", async (values) => {
    const dto = Object.assign(new RankingParamsDto(), values);

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});

describe("RankingsController", () => {
  function createSubject() {
    const service = {
      getLatest: jest.fn(),
      refresh: jest.fn(),
      refreshAll: jest.fn(),
    };
    return {
      controller: new RankingsController(service as unknown as RankingsService),
      service,
    };
  }

  it("preserves the not-found response from latest snapshot queries", async () => {
    const { controller, service } = createSubject();
    service.getLatest.mockRejectedValue(new NotFoundException());

    await expect(
      controller.getLatest({ platform: "qidian", rankTypeKey: "yuepiao" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("preserves a catalog validation error from latest queries", async () => {
    const { controller, service } = createSubject();
    service.getLatest.mockRejectedValue(new BadRequestException());

    await expect(
      controller.getLatest({ platform: "fanqie", rankTypeKey: "unknown" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("maps a single ranking refresh failure to BadGatewayException", async () => {
    const { controller, service } = createSubject();
    service.refresh.mockRejectedValue(new Error("crawler blocked"));

    await expect(
      controller.refresh({ platform: "qidian", rankTypeKey: "hotsales" }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it("does not map catalog validation errors to BadGatewayException", async () => {
    const { controller, service } = createSubject();
    const error = new BadRequestException("Unsupported ranking type key");
    service.refresh.mockRejectedValue(error);

    await expect(
      controller.refresh({ platform: "fanqie", rankTypeKey: "unknown" }),
    ).rejects.toBe(error);
  });

  it("returns each result from an all-ranking refresh", async () => {
    const { controller, service } = createSubject();
    const results = [
      {
        rankTypeKey: "yuepiao",
        rankType: "月票榜",
        success: false,
        error: "RANKING_REFRESH_FAILED",
      },
    ];
    service.refreshAll.mockResolvedValue(results);

    await expect(controller.refreshAll({ platform: "qidian" })).resolves.toBe(
      results,
    );
  });
});
