import { SchedulerRegistry } from "@nestjs/schedule";
import request from "supertest";
import type {
  CrawledRanking,
  RankingCatalog,
  RankingCrawler,
  RankingDefinition,
} from "../../src/crawlers/interfaces";
import type { CrawlersService } from "../../src/crawlers/crawlers.service";
import {
  FANQIE_RANKINGS_REFRESH_JOB_NAME,
  QIDIAN_RANKINGS_REFRESH_JOB_NAME,
} from "../../src/rankings/rankings.scheduler";
import { RANKING_REFRESH_FAILED } from "../../src/rankings/rankings.service";
import type { Platform } from "../../src/shared/types/platform.type";
import { createE2eApplication, type E2eApplication } from "../setup-env";

const qidianDefinitions = [
  { platform: "qidian", rankTypeKey: "yuepiao", rankType: "月票榜" },
  { platform: "qidian", rankTypeKey: "hotsales", rankType: "畅销榜" },
  { platform: "qidian", rankTypeKey: "recom", rankType: "推荐榜" },
  { platform: "qidian", rankTypeKey: "collect", rankType: "收藏榜" },
] as const satisfies readonly RankingDefinition[];

const fanqieDefinitions = [
  {
    platform: "fanqie",
    rankTypeKey: "0_1_1139",
    rankType: "女频-新书榜-古风世情",
  },
  {
    platform: "fanqie",
    rankTypeKey: "0_2_1139",
    rankType: "女频-阅读榜-古风世情",
  },
] as const satisfies readonly RankingDefinition[];

function createCatalog(definitions: readonly RankingDefinition[]): RankingCatalog {
  return {
    list: () => definitions,
    resolve: (rankTypeKey) => definitions.find((item) => item.rankTypeKey === rankTypeKey) ?? null,
  };
}

describe("Rankings API (e2e)", () => {
  const definitions = [...qidianDefinitions, ...fanqieDefinitions];
  const catalogs: Record<Platform, RankingCatalog> = {
    qidian: createCatalog(qidianDefinitions),
    fanqie: createCatalog(fanqieDefinitions),
  };
  const crawlRanking: jest.MockedFunction<RankingCrawler["crawl"]> = jest.fn();
  const crawlersService: Pick<
    CrawlersService,
    "getRankingCatalog" | "getRankingCrawler" | "getBookCrawler"
  > = {
    getRankingCatalog: (platform) => catalogs[platform],
    getRankingCrawler: (platform) => {
      if (!(platform in catalogs)) {
        throw new Error(`Unexpected ranking platform: ${String(platform)}`);
      }
      return { crawl: crawlRanking };
    },
    getBookCrawler: () => {
      throw new Error("Unexpected book crawler access in rankings E2E");
    },
  };
  let context: E2eApplication | undefined;

  beforeAll(async () => {
    context = await createE2eApplication(crawlersService);
  });

  beforeEach(async () => {
    crawlRanking.mockReset();
    crawlRanking.mockRejectedValue(new Error("Unexpected ranking crawl"));
    await cleanRankingData();
  });

  afterEach(async () => {
    await cleanRankingData();
  });

  afterAll(async () => {
    await context?.close();
  });

  async function cleanRankingData(): Promise<void> {
    if (context === undefined) return;

    await context.prisma.rankingSnapshot.deleteMany({
      where: { platform: { in: ["qidian", "fanqie"] } },
    });
    await context.prisma.book.deleteMany({
      where: { platform: { in: ["qidian", "fanqie"] } },
    });
  }

  function requireContext(): E2eApplication {
    if (context === undefined) {
      throw new Error("Rankings E2E application was not initialized");
    }
    return context;
  }

  function requireDefinition(platform: Platform, rankTypeKey: string): RankingDefinition {
    const definition = catalogs[platform].resolve(rankTypeKey);
    if (definition === null) {
      throw new Error(`Missing test definition: ${platform}/${rankTypeKey}`);
    }
    return definition;
  }

  function makeRanking(platform: Platform, rankTypeKey: string, sequence = 1): CrawledRanking {
    const definition = requireDefinition(platform, rankTypeKey);
    const definitionOffset = definitions.findIndex(
      (item) => item.platform === platform && item.rankTypeKey === rankTypeKey,
    );

    return {
      ...definition,
      sourceUrl:
        platform === "qidian"
          ? `https://www.qidian.com/rank/${rankTypeKey}/?e2e=${sequence}`
          : `https://fanqienovel.com/rank/${rankTypeKey}?e2e=${sequence}`,
      fetchedAt: new Date(Date.UTC(2026, 6, 20, sequence)),
      items: Array.from({ length: 10 }, (_, index) => {
        const rank = 10 - index;
        const externalBookId = String(9_900_000_000 + definitionOffset * 100 + rank);
        return {
          rank,
          externalBookId,
          title: `${definition.rankType} 第 ${rank} 名 v${sequence}`,
          author: `作者 ${rank}`,
          coverUrl: null,
          sourceUrl:
            platform === "qidian"
              ? `https://www.qidian.com/book/${externalBookId}/`
              : `https://fanqienovel.com/page/${externalBookId}`,
          metrics: { score: rank * 100 + sequence },
        };
      }),
    };
  }

  it("returns 404 for a registered Fanqie key without a snapshot", async () => {
    const response = await request(requireContext().app.getHttpServer())
      .get("/v1/rankings/fanqie/0_1_1139")
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: "Ranking snapshot not found",
    });
    expect(crawlRanking).not.toHaveBeenCalled();
  });

  it.each([
    "/v1/rankings/unknown/0_1_1139",
    "/v1/rankings/fanqie/unknown",
    "/v1/rankings/qidian/0_1_1139",
  ])("returns 400 for an invalid platform or catalog key: %s", async (path) => {
    await request(requireContext().app.getHttpServer()).get(path).expect(400);
    expect(crawlRanking).not.toHaveBeenCalled();
  });

  it("refreshes a complete Fanqie ranking in one transaction", async () => {
    crawlRanking.mockResolvedValueOnce(makeRanking("fanqie", "0_1_1139"));

    const refreshed = await request(requireContext().app.getHttpServer())
      .post("/v1/rankings/fanqie/0_1_1139/refresh")
      .expect(201);
    const latest = await request(requireContext().app.getHttpServer())
      .get("/v1/rankings/fanqie/0_1_1139")
      .expect(200);

    expect(crawlRanking).toHaveBeenCalledWith("0_1_1139");
    expect(latest.body.id).toBe(refreshed.body.id);
    expect(latest.body).toMatchObject({
      platform: "fanqie",
      rankTypeKey: "0_1_1139",
      rankType: "女频-新书榜-古风世情",
    });
    expect(latest.body.items).toHaveLength(10);
    expect(latest.body.items.map((item: { rank: number }) => item.rank)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    await expect(
      requireContext().prisma.rankingItem.count({
        where: { snapshotId: refreshed.body.id },
      }),
    ).resolves.toBe(10);
  });

  it("maps a Fanqie refresh failure to a safe 502 without partial writes", async () => {
    crawlRanking.mockRejectedValueOnce(new Error("upstream failed with private-token"));

    const response = await request(requireContext().app.getHttpServer())
      .post("/v1/rankings/fanqie/0_1_1139/refresh")
      .expect(502);

    expect(response.body).toMatchObject({
      statusCode: 502,
      message: "Failed to refresh ranking",
    });
    expect(JSON.stringify(response.body)).not.toContain("private-token");
    await expect(requireContext().prisma.rankingSnapshot.count()).resolves.toBe(0);
    await expect(requireContext().prisma.book.count()).resolves.toBe(0);
  });

  it("rejects an incomplete Fanqie ranking without persisting books", async () => {
    const incomplete = makeRanking("fanqie", "0_1_1139");
    crawlRanking.mockResolvedValueOnce({
      ...incomplete,
      items: incomplete.items.slice(0, 9),
    });

    await request(requireContext().app.getHttpServer())
      .post("/v1/rankings/fanqie/0_1_1139/refresh")
      .expect(502);

    await expect(requireContext().prisma.rankingSnapshot.count()).resolves.toBe(0);
    await expect(requireContext().prisma.book.count()).resolves.toBe(0);
  });

  it("keeps Fanqie history immutable and returns the newest snapshot", async () => {
    crawlRanking
      .mockResolvedValueOnce(makeRanking("fanqie", "0_1_1139", 1))
      .mockResolvedValueOnce(makeRanking("fanqie", "0_1_1139", 2));

    const first = await request(requireContext().app.getHttpServer())
      .post("/v1/rankings/fanqie/0_1_1139/refresh")
      .expect(201);
    const second = await request(requireContext().app.getHttpServer())
      .post("/v1/rankings/fanqie/0_1_1139/refresh")
      .expect(201);
    const latest = await request(requireContext().app.getHttpServer())
      .get("/v1/rankings/fanqie/0_1_1139")
      .expect(200);
    const persistedFirst = await requireContext().prisma.rankingSnapshot.findUniqueOrThrow({
      where: { id: first.body.id },
      include: { items: { orderBy: { rank: "asc" } } },
    });

    expect(second.body.id).not.toBe(first.body.id);
    expect(latest.body.id).toBe(second.body.id);
    expect(persistedFirst.items[0].title).toContain("v1");
    await expect(
      requireContext().prisma.rankingSnapshot.count({
        where: { platform: "fanqie", rankTypeKey: "0_1_1139" },
      }),
    ).resolves.toBe(2);
    await expect(
      requireContext().prisma.book.count({
        where: { platform: "fanqie" },
      }),
    ).resolves.toBe(10);
  });

  it("isolates the latest Fanqie snapshot by machine key", async () => {
    crawlRanking
      .mockResolvedValueOnce(makeRanking("fanqie", "0_1_1139"))
      .mockResolvedValueOnce(makeRanking("fanqie", "0_2_1139"));

    const newBooks = await request(requireContext().app.getHttpServer())
      .post("/v1/rankings/fanqie/0_1_1139/refresh")
      .expect(201);
    const reads = await request(requireContext().app.getHttpServer())
      .post("/v1/rankings/fanqie/0_2_1139/refresh")
      .expect(201);

    const latestNewBooks = await request(requireContext().app.getHttpServer())
      .get("/v1/rankings/fanqie/0_1_1139")
      .expect(200);
    const latestReads = await request(requireContext().app.getHttpServer())
      .get("/v1/rankings/fanqie/0_2_1139")
      .expect(200);

    expect(latestNewBooks.body.id).toBe(newBooks.body.id);
    expect(latestReads.body.id).toBe(reads.body.id);
    expect(latestNewBooks.body.rankType).toBe("女频-新书榜-古风世情");
    expect(latestReads.body.rankType).toBe("女频-阅读榜-古风世情");
  });

  it("continues a Fanqie refresh-all after one safe failure", async () => {
    const attempted: string[] = [];
    crawlRanking.mockImplementation(async (rankTypeKey) => {
      attempted.push(rankTypeKey);
      if (rankTypeKey === "0_2_1139") {
        throw new Error("private upstream diagnostics");
      }
      return makeRanking("fanqie", rankTypeKey, 2);
    });

    const response = await request(requireContext().app.getHttpServer())
      .post("/v1/rankings/fanqie/refresh")
      .expect(201);

    expect(attempted).toEqual(["0_1_1139", "0_2_1139"]);
    expect(response.body[0]).toMatchObject({
      rankTypeKey: "0_1_1139",
      rankType: "女频-新书榜-古风世情",
      success: true,
    });
    expect(response.body[1]).toEqual({
      rankTypeKey: "0_2_1139",
      rankType: "女频-阅读榜-古风世情",
      success: false,
      error: RANKING_REFRESH_FAILED,
    });
    expect(JSON.stringify(response.body)).not.toContain("private upstream diagnostics");
    await expect(requireContext().prisma.rankingSnapshot.count()).resolves.toBe(1);
  });

  it("keeps the four Qidian ranking keys working", async () => {
    crawlRanking.mockImplementation((rankTypeKey) =>
      Promise.resolve(makeRanking("qidian", rankTypeKey, 2)),
    );

    const response = await request(requireContext().app.getHttpServer())
      .post("/v1/rankings/qidian/refresh")
      .expect(201);

    expect(response.body.map((item: { rankTypeKey: string }) => item.rankTypeKey)).toEqual(
      qidianDefinitions.map((item) => item.rankTypeKey),
    );
    expect(response.body.every((item: { success: boolean }) => item.success)).toBe(true);
  });

  it("does not register either ranking cron job in the test environment", () => {
    const registry = requireContext().app.get(SchedulerRegistry);

    expect(registry.doesExist("cron", QIDIAN_RANKINGS_REFRESH_JOB_NAME)).toBe(false);
    expect(registry.doesExist("cron", FANQIE_RANKINGS_REFRESH_JOB_NAME)).toBe(false);
  });
});
