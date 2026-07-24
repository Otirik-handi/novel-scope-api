import {
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import type { CrawlersService } from "../crawlers/crawlers.service";
import type {
  CrawledRanking,
  RankingCatalog,
  RankingDefinition,
} from "../crawlers/interfaces";
import { QidianRankingCatalog } from "../crawlers/qidian/rankings/qidian-ranking.catalog";
import type { RankingsRepository } from "./rankings.repository";
import { RankingIntegrityError, RankingsService } from "./rankings.service";

const qidianCatalog = new QidianRankingCatalog();
const snapshot = {
  id: "snapshot-1",
  platform: "qidian",
  rankTypeKey: "yuepiao",
  rankType: "月票榜",
  sourceUrl: "https://www.qidian.com/rank/yuepiao/",
  fetchedAt: new Date("2026-07-20T01:00:00.000Z"),
  createdAt: new Date("2026-07-20T01:00:01.000Z"),
  items: [],
};

function createSubject(catalog: RankingCatalog = qidianCatalog) {
  const repository = {
    findLatest: jest.fn(),
    saveSnapshot: jest.fn(),
  };
  const rankingCrawler = { crawl: jest.fn() };
  const crawlersService = {
    getRankingCatalog: jest.fn(() => catalog),
    getRankingCrawler: jest.fn(() => rankingCrawler),
  };

  return {
    service: new RankingsService(
      repository as unknown as RankingsRepository,
      crawlersService as unknown as CrawlersService,
    ),
    repository,
    rankingCrawler,
    crawlersService,
  };
}

describe("RankingsService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getLatest", () => {
    it("resolves the catalog before querying by platform and machine key", async () => {
      const { service, repository, rankingCrawler, crawlersService } =
        createSubject();
      repository.findLatest.mockResolvedValue(snapshot);

      await expect(service.getLatest("qidian", "yuepiao")).resolves.toBe(
        snapshot,
      );
      expect(crawlersService.getRankingCatalog).toHaveBeenCalledWith("qidian");
      expect(repository.findLatest).toHaveBeenCalledWith("qidian", "yuepiao");
      expect(crawlersService.getRankingCrawler).not.toHaveBeenCalled();
      expect(rankingCrawler.crawl).not.toHaveBeenCalled();
    });

    it("rejects an unregistered key before querying persistence", async () => {
      const { service, repository } = createSubject();

      await expect(
        service.getLatest("qidian", "0_1_1139"),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.findLatest).not.toHaveBeenCalled();
    });

    it("throws NotFoundException when no snapshot has been stored", async () => {
      const { service, repository } = createSubject();
      repository.findLatest.mockResolvedValue(null);

      await expect(
        service.getLatest("qidian", "collect"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("refresh", () => {
    it("crawls and persists one complete ranking snapshot", async () => {
      const { service, repository, rankingCrawler, crawlersService } =
        createSubject();
      const crawled = makeCrawledRanking();
      const saved = { ...snapshot, items: crawled.items };
      rankingCrawler.crawl.mockResolvedValue(crawled);
      repository.saveSnapshot.mockResolvedValue(saved);

      await expect(service.refresh("qidian", "yuepiao")).resolves.toBe(saved);
      expect(crawlersService.getRankingCatalog).toHaveBeenCalledWith("qidian");
      expect(crawlersService.getRankingCrawler).toHaveBeenCalledWith("qidian");
      expect(rankingCrawler.crawl).toHaveBeenCalledWith("yuepiao");
      expect(repository.saveSnapshot).toHaveBeenCalledWith(crawled);
    });

    it.each([
      ["platform", { platform: "fanqie" }],
      ["machine key", { rankTypeKey: "hotsales" }],
      ["display name", { rankType: "错误榜名" }],
    ])("does not persist a crawler result with the wrong %s", async (_label, patch) => {
      const { service, repository, rankingCrawler } = createSubject();
      rankingCrawler.crawl.mockResolvedValue({
        ...makeCrawledRanking(),
        ...patch,
      });

      await expect(
        service.refresh("qidian", "yuepiao"),
      ).rejects.toBeInstanceOf(RankingIntegrityError);
      expect(repository.saveSnapshot).not.toHaveBeenCalled();
    });

    it.each([
      ["too few items", makeCrawledRanking().items.slice(0, 9)],
      [
        "duplicate book IDs",
        [
          ...makeCrawledRanking().items.slice(0, 9),
          { ...makeCrawledRanking().items[9], externalBookId: "1000" },
        ],
      ],
      [
        "duplicate ranks",
        [
          ...makeCrawledRanking().items.slice(0, 9),
          { ...makeCrawledRanking().items[9], rank: 1 },
        ],
      ],
      [
        "blank required field",
        [
          { ...makeCrawledRanking().items[0], title: " " },
          ...makeCrawledRanking().items.slice(1),
        ],
      ],
    ])("does not persist a ranking with %s", async (_reason, items) => {
      const { service, repository, rankingCrawler } = createSubject();
      rankingCrawler.crawl.mockResolvedValue({ ...makeCrawledRanking(), items });

      await expect(
        service.refresh("qidian", "yuepiao"),
      ).rejects.toBeInstanceOf(RankingIntegrityError);
      expect(repository.saveSnapshot).not.toHaveBeenCalled();
    });

    it.each(["", "   "])(
      "does not persist a ranking with a blank source URL (%j)",
      async (sourceUrl) => {
        const { service, repository, rankingCrawler } = createSubject();
        rankingCrawler.crawl.mockResolvedValue({
          ...makeCrawledRanking(),
          sourceUrl,
        });

        await expect(
          service.refresh("qidian", "yuepiao"),
        ).rejects.toBeInstanceOf(RankingIntegrityError);
        expect(repository.saveSnapshot).not.toHaveBeenCalled();
      },
    );

    it("propagates persistence failures without reading a partial snapshot", async () => {
      const { service, repository, rankingCrawler } = createSubject();
      rankingCrawler.crawl.mockResolvedValue(makeCrawledRanking());
      repository.saveSnapshot.mockRejectedValue(new Error("transaction failed"));

      await expect(service.refresh("qidian", "yuepiao")).rejects.toThrow(
        "transaction failed",
      );
      expect(repository.saveSnapshot).toHaveBeenCalledTimes(1);
      expect(repository.findLatest).not.toHaveBeenCalled();
    });
  });

  describe("refreshAll", () => {
    it("refreshes the four Qidian definitions serially and continues after failure", async () => {
      const { service, repository, rankingCrawler } = createSubject();
      const events: string[] = [];
      let active = 0;
      let maximumActive = 0;
      rankingCrawler.crawl.mockImplementation(async (rankTypeKey: string) => {
        events.push(`start:${rankTypeKey}`);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        events.push(`end:${rankTypeKey}`);

        if (rankTypeKey === "hotsales") {
          throw new Error("private crawler detail");
        }

        return makeCrawledRanking(rankTypeKey);
      });
      repository.saveSnapshot.mockImplementation(async (ranking) => ({
        ...snapshot,
        rankTypeKey: ranking.rankTypeKey,
        rankType: ranking.rankType,
        items: ranking.items,
      }));

      const results = await service.refreshAll("qidian");

      expect(maximumActive).toBe(1);
      expect(events).toEqual([
        "start:yuepiao",
        "end:yuepiao",
        "start:hotsales",
        "end:hotsales",
        "start:recom",
        "end:recom",
        "start:collect",
        "end:collect",
      ]);
      expect(
        results.map(({ rankTypeKey, rankType, success }) => ({
          rankTypeKey,
          rankType,
          success,
        })),
      ).toEqual([
        { rankTypeKey: "yuepiao", rankType: "月票榜", success: true },
        { rankTypeKey: "hotsales", rankType: "畅销榜", success: false },
        { rankTypeKey: "recom", rankType: "推荐榜", success: true },
        { rankTypeKey: "collect", rankType: "收藏榜", success: true },
      ]);
      expect(results[1]).toEqual({
        rankTypeKey: "hotsales",
        rankType: "畅销榜",
        success: false,
        error: "RANKING_REFRESH_FAILED",
      });
      expect(JSON.stringify(results)).not.toContain("private crawler detail");
      expect(repository.saveSnapshot).toHaveBeenCalledTimes(3);
    });

    it("uses a Fanqie catalog's stable definition order", async () => {
      const definitions: RankingDefinition[] = [
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
        {
          platform: "fanqie",
          rankTypeKey: "1_1_1141",
          rankType: "男频-新书榜-西方奇幻",
        },
      ];
      const catalog: RankingCatalog = {
        list: () => definitions,
        resolve: (rankTypeKey) =>
          definitions.find((item) => item.rankTypeKey === rankTypeKey) ?? null,
      };
      const { service, repository, rankingCrawler } = createSubject(catalog);
      rankingCrawler.crawl.mockImplementation(async (rankTypeKey: string) => {
        const definition = catalog.resolve(rankTypeKey)!;

        if (rankTypeKey === "0_2_1139") {
          throw new Error("blocked");
        }

        return makeCrawledRanking(rankTypeKey, definition);
      });
      repository.saveSnapshot.mockImplementation(async (ranking) => ({
        ...snapshot,
        platform: "fanqie",
        rankTypeKey: ranking.rankTypeKey,
        rankType: ranking.rankType,
        items: ranking.items,
      }));

      const results = await service.refreshAll("fanqie");

      expect(rankingCrawler.crawl.mock.calls.map(([key]) => key)).toEqual(
        definitions.map((item) => item.rankTypeKey),
      );
      expect(results.map((result) => result.success)).toEqual([
        true,
        false,
        true,
      ]);
      expect(results[1]).toEqual({
        rankTypeKey: "0_2_1139",
        rankType: "女频-阅读榜-古风世情",
        success: false,
        error: "RANKING_REFRESH_FAILED",
      });
    });
  });
});

export function makeCrawledRanking(
  rankTypeKey = "yuepiao",
  definition: RankingDefinition = qidianCatalog.resolve(rankTypeKey)!,
): CrawledRanking {
  return {
    platform: definition.platform,
    rankTypeKey: definition.rankTypeKey,
    rankType: definition.rankType,
    sourceUrl:
      definition.platform === "qidian"
        ? `https://www.qidian.com/rank/${rankTypeKey}/`
        : `https://fanqienovel.com/rank/${rankTypeKey}`,
    fetchedAt: new Date("2026-07-20T02:00:00.000Z"),
    items: Array.from({ length: 10 }, (_, index) => ({
      rank: index + 1,
      externalBookId: String(1000 + index),
      title: `Book ${index + 1}`,
      author: `Author ${index + 1}`,
      coverUrl: null,
      sourceUrl:
        definition.platform === "qidian"
          ? `https://www.qidian.com/book/${1000 + index}/`
          : `https://fanqienovel.com/page/${1000 + index}`,
      metrics: { score: index + 1 },
    })),
  };
}
