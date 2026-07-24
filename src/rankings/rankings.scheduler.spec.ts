import type { ConfigType } from "@nestjs/config";
import type { SchedulerRegistry } from "@nestjs/schedule";
import type { CronJob } from "cron";
import appConfig from "../config/app.config";
import type { RankingsService } from "./rankings.service";
import {
  FANQIE_RANKINGS_REFRESH_JOB_NAME,
  QIDIAN_RANKINGS_REFRESH_JOB_NAME,
  RankingsScheduler,
} from "./rankings.scheduler";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createRegistry() {
  const jobs = new Map<string, CronJob>();
  const addCronJob = jest.fn((name: string, job: CronJob) => jobs.set(name, job));
  const getCronJob = jest.fn((name: string) => {
    const job = jobs.get(name);
    if (job === undefined) throw new Error(`Cron job not found: ${name}`);
    return job;
  });
  const deleteCronJob = jest.fn((name: string) => {
    if (!jobs.delete(name)) throw new Error(`Cron job not found: ${name}`);
  });
  return {
    registry: { addCronJob, getCronJob, deleteCronJob } as unknown as SchedulerRegistry,
    jobs,
    addCronJob,
    getCronJob,
    deleteCronJob,
  };
}

function createConfig(rankingRefreshEnabled = true) {
  return {
    port: 3000,
    bookDetailTtlHours: 3,
    rankingRefreshEnabled,
    qidianRankingRefreshCron: "0 0 6 * * *",
    fanqieRankingRefreshCron: "0 30 0 * * *",
    rankingRefreshTimeZone: "Asia/Shanghai",
  } as ConfigType<typeof appConfig>;
}

describe("RankingsScheduler", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("registers two configured jobs with their platform and shared safeguards", async () => {
    jest.useFakeTimers();
    const { registry, jobs, addCronJob } = createRegistry();
    const service = { refreshAll: jest.fn().mockResolvedValue([]) };
    const scheduler = new RankingsScheduler(
      service as unknown as RankingsService,
      registry,
      createConfig(),
    );

    scheduler.onModuleInit();

    expect(addCronJob.mock.calls.map(([name]) => name)).toEqual([
      QIDIAN_RANKINGS_REFRESH_JOB_NAME,
      FANQIE_RANKINGS_REFRESH_JOB_NAME,
    ]);
    const qidianJob = jobs.get(QIDIAN_RANKINGS_REFRESH_JOB_NAME)!;
    const fanqieJob = jobs.get(FANQIE_RANKINGS_REFRESH_JOB_NAME)!;
    expect(qidianJob.cronTime.source).toBe("0 0 6 * * *");
    expect(fanqieJob.cronTime.source).toBe("0 30 0 * * *");
    expect(qidianJob.cronTime.timeZone).toBe("Asia/Shanghai");
    expect(fanqieJob.cronTime.timeZone).toBe("Asia/Shanghai");
    expect((qidianJob as unknown as { waitForCompletion: boolean }).waitForCompletion).toBe(true);
    expect((fanqieJob as unknown as { waitForCompletion: boolean }).waitForCompletion).toBe(true);

    await qidianJob.fireOnTick();
    await fanqieJob.fireOnTick();
    expect(service.refreshAll.mock.calls).toEqual([["qidian"], ["fanqie"]]);

    await scheduler.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("waits for both in-flight refreshes before completing destruction", async () => {
    jest.useFakeTimers();
    const qidian = createDeferred<[]>();
    const fanqie = createDeferred<[]>();
    const { registry, jobs, deleteCronJob } = createRegistry();
    const service = {
      refreshAll: jest.fn((platform: string) =>
        platform === "qidian" ? qidian.promise : fanqie.promise,
      ),
    };
    const scheduler = new RankingsScheduler(
      service as unknown as RankingsService,
      registry,
      createConfig(),
    );
    scheduler.onModuleInit();

    const qidianTick = jobs.get(QIDIAN_RANKINGS_REFRESH_JOB_NAME)!.fireOnTick();
    const fanqieTick = jobs.get(FANQIE_RANKINGS_REFRESH_JOB_NAME)!.fireOnTick();
    let destroyed = false;
    const destroyPromise = scheduler.onModuleDestroy().then(() => {
      destroyed = true;
    });
    await Promise.resolve();

    expect(destroyed).toBe(false);
    expect(deleteCronJob).not.toHaveBeenCalled();

    qidian.resolve([]);
    await qidianTick;
    await jest.runOnlyPendingTimersAsync();
    expect(destroyed).toBe(false);

    fanqie.resolve([]);
    await fanqieTick;
    await jest.runOnlyPendingTimersAsync();
    await destroyPromise;

    expect(deleteCronJob.mock.calls.map(([name]) => name)).toEqual([
      QIDIAN_RANKINGS_REFRESH_JOB_NAME,
      FANQIE_RANKINGS_REFRESH_JOB_NAME,
    ]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("deletes both jobs after an in-flight callback rejects", async () => {
    jest.useFakeTimers();
    const qidian = createDeferred<[]>();
    const fanqie = createDeferred<[]>();
    const consoleError = jest.spyOn(console, "error").mockImplementation();
    const { registry, jobs, deleteCronJob } = createRegistry();
    const service = {
      refreshAll: jest.fn((platform: string) =>
        platform === "qidian" ? qidian.promise : fanqie.promise,
      ),
    };
    const scheduler = new RankingsScheduler(
      service as unknown as RankingsService,
      registry,
      createConfig(),
    );
    scheduler.onModuleInit();
    const qidianTick = jobs.get(QIDIAN_RANKINGS_REFRESH_JOB_NAME)!.fireOnTick();
    const fanqieTick = jobs.get(FANQIE_RANKINGS_REFRESH_JOB_NAME)!.fireOnTick();
    const destroyPromise = scheduler.onModuleDestroy();

    qidian.reject(new Error("qidian failed"));
    fanqie.resolve([]);
    await qidianTick;
    await fanqieTick;
    await jest.runOnlyPendingTimersAsync();
    await destroyPromise;

    expect(consoleError).toHaveBeenCalled();
    expect(deleteCronJob).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("registers nothing when scheduling is disabled", async () => {
    const { registry, addCronJob, deleteCronJob } = createRegistry();
    const service = { refreshAll: jest.fn() };
    const scheduler = new RankingsScheduler(
      service as unknown as RankingsService,
      registry,
      createConfig(false),
    );

    scheduler.onModuleInit();
    await scheduler.onModuleDestroy();

    expect(addCronJob).not.toHaveBeenCalled();
    expect(deleteCronJob).not.toHaveBeenCalled();
    expect(service.refreshAll).not.toHaveBeenCalled();
  });

  it("is idempotent when destroyed repeatedly", async () => {
    jest.useFakeTimers();
    const { registry, deleteCronJob } = createRegistry();
    const service = { refreshAll: jest.fn().mockResolvedValue([]) };
    const scheduler = new RankingsScheduler(
      service as unknown as RankingsService,
      registry,
      createConfig(),
    );
    scheduler.onModuleInit();

    await scheduler.onModuleDestroy();
    await scheduler.onModuleDestroy();

    expect(deleteCronJob).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });
});
