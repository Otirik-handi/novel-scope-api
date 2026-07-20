import type { SchedulerRegistry } from "@nestjs/schedule";
import type { ConfigType } from "@nestjs/config";
import appConfig from "../config/app.config";
import type { RankingsService } from "./rankings.service";
import {
  RANKINGS_REFRESH_JOB_NAME,
  RankingsScheduler,
} from "./rankings.scheduler";

describe("RankingsScheduler", () => {
  it("registers the configured daily job for Asia/Shanghai and refreshes qidian", async () => {
    let registeredJob: { stop(): void } | undefined;
    const addCronJob = jest.fn((_name, job) => {
      registeredJob = job;
    });
    const deleteCronJob = jest.fn(() => {
      registeredJob?.stop();
    });
    const registry = {
      addCronJob,
      deleteCronJob,
    } as unknown as SchedulerRegistry;
    const service = {
      refreshAll: jest.fn().mockResolvedValue([]),
    } as unknown as RankingsService;
    const config = {
      port: 3000,
      bookDetailTtlHours: 3,
      rankingRefreshEnabled: true,
      rankingRefreshCron: "0 0 6 * * *",
      rankingRefreshTimeZone: "Asia/Shanghai",
    } as ConfigType<typeof appConfig>;
    const scheduler = new RankingsScheduler(service, registry, config);

    scheduler.onModuleInit();

    expect(addCronJob).toHaveBeenCalledTimes(1);
    expect(addCronJob).toHaveBeenCalledWith(
      RANKINGS_REFRESH_JOB_NAME,
      expect.any(Object),
    );
    const job = addCronJob.mock.calls[0]?.[1];
    expect(job.cronTime.source).toBe("0 0 6 * * *");
    expect(job.cronTime.timeZone).toBe("Asia/Shanghai");

    await job.fireOnTick();
    expect(service.refreshAll).toHaveBeenCalledWith("qidian");

    scheduler.onModuleDestroy();
    expect(deleteCronJob).toHaveBeenCalledWith(RANKINGS_REFRESH_JOB_NAME);
  });

  it("does not register a cron job when scheduling is disabled", () => {
    let registeredJob: { stop(): void } | undefined;
    const registry = {
      addCronJob: jest.fn((_name, job) => {
        registeredJob = job;
      }),
      deleteCronJob: jest.fn(() => registeredJob?.stop()),
    } as unknown as SchedulerRegistry;
    const service = {
      refreshAll: jest.fn(),
    } as unknown as RankingsService;
    const config = {
      port: 3000,
      bookDetailTtlHours: 3,
      rankingRefreshEnabled: false,
      rankingRefreshCron: "0 0 6 * * *",
      rankingRefreshTimeZone: "Asia/Shanghai",
    } as ConfigType<typeof appConfig>;
    const scheduler = new RankingsScheduler(service, registry, config);

    scheduler.onModuleInit();
    scheduler.onModuleDestroy();

    expect(registry.addCronJob).not.toHaveBeenCalled();
    expect(registry.deleteCronJob).not.toHaveBeenCalled();
    expect(service.refreshAll).not.toHaveBeenCalled();
  });
});
