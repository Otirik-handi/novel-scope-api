import { Logger, NotFoundException } from "@nestjs/common";
import type { CrawlersService } from "../crawlers/crawlers.service";
import type { CrawledRanking } from "../crawlers/interfaces";
import type { RankingsRepository } from "./rankings.repository";
import { RankingIntegrityError, RankingsService } from "./rankings.service";

const snapshot = {
  id: "snapshot-1",
  platform: "qidian",
  rankType: "yuepiao",
  sourceUrl: "https://www.qidian.com/rank/yuepiao/",
  fetchedAt: new Date("2026-07-20T01:00:00.000Z"),
  createdAt: new Date("2026-07-20T01:00:01.000Z"),
  items: [],
};

function createSubject() {
  const repository = {
    findLatest: jest.fn(),
    saveSnapshot: jest.fn(),
  };
  const rankingCrawler = { crawl: jest.fn() };
  const crawlersService = {
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
    it("returns the latest stored snapshot without selecting or calling a crawler", async () => {
      const { service, repository, rankingCrawler, crawlersService } =
        createSubject();
      repository.findLatest.mockResolvedValue(snapshot);

      await expect(service.getLatest("qidian", "yuepiao")).resolves.toBe(
        snapshot,
      );
      expect(repository.findLatest).toHaveBeenCalledWith("qidian", "yuepiao");
      expect(crawlersService.getRankingCrawler).not.toHaveBeenCalled();
      expect(rankingCrawler.crawl).not.toHaveBeenCalled();
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
      expect(crawlersService.getRankingCrawler).toHaveBeenCalledWith("qidian");
      expect(rankingCrawler.crawl).toHaveBeenCalledWith("yuepiao");
      expect(repository.saveSnapshot).toHaveBeenCalledWith(crawled);
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
    ])("does not persist a ranking with %s", async (_reason, items) => {
      const { service, repository, rankingCrawler } = createSubject();
      rankingCrawler.crawl.mockResolvedValue({
        ...makeCrawledRanking(),
        items,
      });

      await expect(service.refresh("qidian", "yuepiao")).rejects.toThrow();
      expect(repository.saveSnapshot).not.toHaveBeenCalled();
    });

    it("propagates persistence failures without retrying or reading a partial snapshot", async () => {
      const { service, repository, rankingCrawler } = createSubject();
      rankingCrawler.crawl.mockResolvedValue(makeCrawledRanking());
      repository.saveSnapshot.mockRejectedValue(
        new Error("transaction failed"),
      );

      await expect(service.refresh("qidian", "yuepiao")).rejects.toThrow(
        "transaction failed",
      );
      expect(repository.saveSnapshot).toHaveBeenCalledTimes(1);
      expect(repository.findLatest).not.toHaveBeenCalled();
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
  });

  describe("refreshAll", () => {
    it("refreshes all four rank types strictly in order and continues after a failure", async () => {
      const { service, repository, rankingCrawler } = createSubject();
      const sensitiveError = new Error(
        "database failed at C:\\deploy\\secrets\\database.json for postgres://admin:secret@db/internal",
      );
      const loggerError = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation();
      const events: string[] = [];
      let activeCrawls = 0;
      let maximumActiveCrawls = 0;
      rankingCrawler.crawl.mockImplementation(async (rankType) => {
        events.push(`start:${rankType}`);
        activeCrawls += 1;
        maximumActiveCrawls = Math.max(maximumActiveCrawls, activeCrawls);
        await Promise.resolve();
        activeCrawls -= 1;
        events.push(`end:${rankType}`);

        if (rankType === "hotsales") {
          throw sensitiveError;
        }

        return makeCrawledRanking(rankType);
      });
      repository.saveSnapshot.mockImplementation(async (ranking) => ({
        ...snapshot,
        rankType: ranking.rankType,
        items: ranking.items,
      }));

      const result = await service.refreshAll("qidian");

      expect(maximumActiveCrawls).toBe(1);
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
        result.map(({ rankType, success }) => ({ rankType, success })),
      ).toEqual([
        { rankType: "yuepiao", success: true },
        { rankType: "hotsales", success: false },
        { rankType: "recom", success: true },
        { rankType: "collect", success: true },
      ]);
      expect(result[1]).toEqual({
        rankType: "hotsales",
        success: false,
        error: "RANKING_REFRESH_FAILED",
      });
      expect(JSON.stringify(result)).not.toContain(sensitiveError.message);
      expect(() => JSON.stringify(result)).not.toThrow();
      expect(loggerError).toHaveBeenCalledWith(
        "Failed to refresh ranking qidian/hotsales",
      );
      expect(repository.saveSnapshot).toHaveBeenCalledTimes(3);
    });

    it("logs only fixed ranking context for every thrown value", async () => {
      const { service, rankingCrawler } = createSubject();
      const loggerError = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation();
      const failures: Record<CrawledRanking["rankType"], unknown> = {
        yuepiao: new Error(
          "failed at C:\\deploy\\token.txt for postgres://admin:secret@db/internal?token=private",
        ),
        hotsales: "crawler token=string-secret",
        recom: {
          message: "object secret",
          source: "C:\\deploy\\object.json",
        },
        collect: null,
      };
      rankingCrawler.crawl.mockImplementation(
        async (rankType: CrawledRanking["rankType"]) => {
          throw failures[rankType];
        },
      );

      await expect(service.refreshAll("qidian")).resolves.toEqual([
        {
          rankType: "yuepiao",
          success: false,
          error: "RANKING_REFRESH_FAILED",
        },
        {
          rankType: "hotsales",
          success: false,
          error: "RANKING_REFRESH_FAILED",
        },
        {
          rankType: "recom",
          success: false,
          error: "RANKING_REFRESH_FAILED",
        },
        {
          rankType: "collect",
          success: false,
          error: "RANKING_REFRESH_FAILED",
        },
      ]);
      expect(loggerError.mock.calls).toEqual([
        ["Failed to refresh ranking qidian/yuepiao"],
        ["Failed to refresh ranking qidian/hotsales"],
        ["Failed to refresh ranking qidian/recom"],
        ["Failed to refresh ranking qidian/collect"],
      ]);

      const serializedLogs = JSON.stringify(
        loggerError.mock.calls,
      ).toLowerCase();
      expect(serializedLogs).not.toContain("c:\\deploy");
      expect(serializedLogs).not.toContain("postgres://");
      expect(serializedLogs).not.toContain("secret");
      expect(serializedLogs).not.toContain("token");
    });
  });
});

export function makeCrawledRanking(
  rankType: CrawledRanking["rankType"] = "yuepiao",
): CrawledRanking {
  return {
    platform: "qidian",
    rankType,
    sourceUrl: `https://www.qidian.com/rank/${rankType}/`,
    fetchedAt: new Date("2026-07-20T02:00:00.000Z"),
    items: Array.from({ length: 10 }, (_, index) => ({
      rank: index + 1,
      externalBookId: String(1000 + index),
      title: `Book ${index + 1}`,
      author: `Author ${index + 1}`,
      coverUrl: null,
      sourceUrl: `https://www.qidian.com/book/${1000 + index}/`,
      metrics: { score: index + 1 },
    })),
  };
}
