import { BadGatewayException, NotFoundException } from "@nestjs/common";
import { validate } from "class-validator";
import { RankingParamsDto } from "./dto/ranking-params.dto";
import { PlatformParamsDto } from "./dto/platform-params.dto";
import { RankingsController } from "./rankings.controller";
import type { RankingsService } from "./rankings.service";

describe("ranking route DTOs", () => {
  it.each([
    [PlatformParamsDto, { platform: "other" }],
    [RankingParamsDto, { platform: "qidian", rankType: "unknown" }],
  ])("rejects unsupported route parameters", async (Dto, values) => {
    const dto = Object.assign(new Dto(), values);

    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });

  it("accepts qidian and a supported ranking type", async () => {
    const dto = Object.assign(new RankingParamsDto(), {
      platform: "qidian",
      rankType: "collect",
    });

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
      controller.getLatest({ platform: "qidian", rankType: "yuepiao" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("maps a single ranking refresh failure to BadGatewayException", async () => {
    const { controller, service } = createSubject();
    service.refresh.mockRejectedValue(new Error("crawler blocked"));

    await expect(
      controller.refresh({ platform: "qidian", rankType: "hotsales" }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it("returns each result from an all-ranking refresh", async () => {
    const { controller, service } = createSubject();
    const results = [{ rankType: "yuepiao", success: false, error: "blocked" }];
    service.refreshAll.mockResolvedValue(results);

    await expect(controller.refreshAll({ platform: "qidian" })).resolves.toBe(
      results,
    );
  });
});
