import { SchedulerRegistry } from "@nestjs/schedule";
import request from "supertest";
import type {
  CrawledRanking,
  RankType,
  RankingCrawler,
} from "../../src/crawlers/interfaces";
import { RANK_TYPES } from "../../src/crawlers/interfaces";
import type { CrawlersService } from "../../src/crawlers/crawlers.service";
import { RANKINGS_REFRESH_JOB_NAME } from "../../src/rankings/rankings.scheduler";
import { RANKING_REFRESH_FAILED } from "../../src/rankings/rankings.service";
import {
  createE2eApplication,
  type E2eApplication,
} from "../setup-env";

describe("Rankings API (e2e)", () => {
  const crawlRanking: jest.MockedFunction<RankingCrawler["crawl"]> = jest.fn();
  const crawlersService: Pick<
    CrawlersService,
    "getRankingCrawler" | "getBookCrawler"
  > = {
    getRankingCrawler: (platform) => {
      if (platform !== "qidian") {
        throw new Error(`Unexpected ranking platform: ${String(platform)}`);
      }
      return { crawl: crawlRanking };
    },
    getBookCrawler: () => {
      throw new Error("Unexpected book crawler access in rankings E2E");
    },
  };
  let context: E2eApplication;

  beforeAll(async () => {
    context = await createE2eApplication(crawlersService);
  });

  beforeEach(async () => {
    crawlRanking.mockReset();
    crawlRanking.mockRejectedValue(new Error("Unexpected ranking crawl"));
    await cleanQidianData();
  });

  afterEach(async () => {
    await cleanQidianData();
  });

  afterAll(async () => {
    await context.close();
  });

  async function cleanQidianData(): Promise<void> {
    await context.prisma.rankingSnapshot.deleteMany({
      where: { platform: "qidian" },
    });
    await context.prisma.book.deleteMany({
      where: { platform: "qidian" },
    });
  }

  function makeRanking(
    rankType: RankType,
    sequence = 1,
  ): CrawledRanking {
    const offset = RANK_TYPES.indexOf(rankType) * 100 + sequence * 1000;

    return {
      platform: "qidian",
      rankType,
      sourceUrl: `https://www.qidian.com/rank/${rankType}/?e2e=${sequence}`,
      fetchedAt: new Date(`2026-07-20T0${sequence}:00:00.000Z`),
      items: Array.from({ length: 10 }, (_, index) => {
        const rank = 10 - index;
        const externalBookId = String(9_900_000_000 + offset + rank);
        return {
          rank,
          externalBookId,
          title: `${rankType} 第 ${rank} 名`,
          author: `作者 ${rank}`,
          coverUrl: null,
          sourceUrl: `https://www.qidian.com/book/${externalBookId}/`,
          metrics: { score: rank * 100 },
        };
      }),
    };
  }

  it("returns 404 when no latest snapshot exists", async () => {
    const response = await request(context.app.getHttpServer())
      .get("/v1/rankings/qidian/yuepiao")
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: "Ranking snapshot not found",
    });
    expect(crawlRanking).not.toHaveBeenCalled();
  });

  it.each([
    "/v1/rankings/unknown/yuepiao",
    "/v1/rankings/qidian/unknown",
  ])("returns 400 for invalid route parameters: %s", async (path) => {
    await request(context.app.getHttpServer()).get(path).expect(400);
    expect(crawlRanking).not.toHaveBeenCalled();
  });

  it("refreshes one ranking, persists it, and returns latest items ordered by rank", async () => {
    crawlRanking.mockResolvedValueOnce(makeRanking("yuepiao"));

    const refreshed = await request(context.app.getHttpServer())
      .post("/v1/rankings/qidian/yuepiao/refresh")
      .expect(201);
    const latest = await request(context.app.getHttpServer())
      .get("/v1/rankings/qidian/yuepiao")
      .expect(200);

    expect(crawlRanking).toHaveBeenCalledTimes(1);
    expect(crawlRanking).toHaveBeenCalledWith("yuepiao");
    expect(refreshed.body).not.toHaveProperty("data");
    expect(latest.body).not.toHaveProperty("data");
    expect(latest.body.id).toBe(refreshed.body.id);
    expect(latest.body.items.map((item: { rank: number }) => item.rank)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
    await expect(
      context.prisma.rankingSnapshot.count({
        where: { platform: "qidian", rankType: "yuepiao" },
      }),
    ).resolves.toBe(1);
  });

  it("maps a single refresh failure to a safe 502", async () => {
    crawlRanking.mockRejectedValueOnce(
      new Error("upstream failed with secret-token"),
    );

    const response = await request(context.app.getHttpServer())
      .post("/v1/rankings/qidian/hotsales/refresh")
      .expect(502);

    expect(response.body).toMatchObject({
      statusCode: 502,
      message: "Failed to refresh ranking",
    });
    expect(JSON.stringify(response.body)).not.toContain("secret-token");
    await expect(context.prisma.rankingSnapshot.count()).resolves.toBe(0);
  });

  it("refreshes all four rankings in order and continues after one failure", async () => {
    const attempted: RankType[] = [];
    crawlRanking.mockImplementation(async (rankType) => {
      attempted.push(rankType);
      if (rankType === "hotsales") {
        throw new Error("private upstream diagnostics");
      }
      return makeRanking(rankType, 2);
    });

    const response = await request(context.app.getHttpServer())
      .post("/v1/rankings/qidian/refresh")
      .expect(201);

    expect(attempted).toEqual(RANK_TYPES);
    expect(response.body).toHaveLength(4);
    expect(
      response.body.map(
        (result: { rankType: RankType; success: boolean }) => ({
          rankType: result.rankType,
          success: result.success,
        }),
      ),
    ).toEqual([
      { rankType: "yuepiao", success: true },
      { rankType: "hotsales", success: false },
      { rankType: "recom", success: true },
      { rankType: "collect", success: true },
    ]);
    expect(response.body[1]).toEqual({
      rankType: "hotsales",
      success: false,
      error: RANKING_REFRESH_FAILED,
    });
    expect(response.body[0].snapshot.items).toHaveLength(10);
    expect(response.body[2].snapshot.items).toHaveLength(10);
    expect(response.body[3].snapshot.items).toHaveLength(10);
    expect(JSON.stringify(response.body)).not.toContain(
      "private upstream diagnostics",
    );
    await expect(context.prisma.rankingSnapshot.count()).resolves.toBe(3);
  });

  it("does not register the ranking cron job in the test environment", () => {
    const registry = context.app.get(SchedulerRegistry);

    expect(
      registry.doesExist("cron", RANKINGS_REFRESH_JOB_NAME),
    ).toBe(false);
  });
});
