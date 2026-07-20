import type { SchedulerRegistry } from "@nestjs/schedule";
import type { ConfigType } from "@nestjs/config";
import type { CronJob } from "cron";
import appConfig from "../config/app.config";
import type { RankingsService } from "./rankings.service";
import {
  RANKINGS_REFRESH_JOB_NAME,
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
  let registeredJob: CronJob | undefined;
  const addCronJob = jest.fn((_name: string, job: CronJob) => {
    registeredJob = job;
  });
  const getCronJob = jest.fn(() => {
    if (registeredJob === undefined) {
      throw new Error("Cron job not found");
    }

    return registeredJob;
  });
  const deleteCronJob = jest.fn(() => {
    if (registeredJob === undefined) {
      throw new Error("Cron job not found");
    }

    registeredJob.stop();
    registeredJob = undefined;
  });

  return {
    registry: {
      addCronJob,
      getCronJob,
      deleteCronJob,
    } as unknown as SchedulerRegistry,
    addCronJob,
    getCronJob,
    deleteCronJob,
    registeredJob: () => registeredJob,
  };
}

function createConfig(rankingRefreshEnabled = true) {
  return {
    port: 3000,
    bookDetailTtlHours: 3,
    rankingRefreshEnabled,
    rankingRefreshCron: "0 0 6 * * *",
    rankingRefreshTimeZone: "Asia/Shanghai",
  } as ConfigType<typeof appConfig>;
}

describe("RankingsScheduler", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("registers the configured daily job for Asia/Shanghai and refreshes qidian", async () => {
    jest.useFakeTimers();
    const { registry, addCronJob, deleteCronJob } = createRegistry();
    const service = {
      refreshAll: jest.fn().mockResolvedValue([]),
    } as unknown as RankingsService;
    const scheduler = new RankingsScheduler(service, registry, createConfig());

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

    await scheduler.onModuleDestroy();
    expect(deleteCronJob).toHaveBeenCalledWith(RANKINGS_REFRESH_JOB_NAME);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("waits for an in-flight refresh before deleting the cron job", async () => {
    jest.useFakeTimers();
    const deferred = createDeferred<[]>();
    const { registry, deleteCronJob, registeredJob } = createRegistry();
    const service = {
      refreshAll: jest.fn(() => deferred.promise),
    } as unknown as RankingsService;
    const scheduler = new RankingsScheduler(service, registry, createConfig());
    scheduler.onModuleInit();
    const job = registeredJob();

    if (job === undefined) {
      throw new Error("Expected scheduler to register a cron job");
    }

    const tickPromise = job.fireOnTick();
    let destroySettled = false;
    const destroyPromise = Promise.resolve(scheduler.onModuleDestroy()).then(
      () => {
        destroySettled = true;
      },
    );
    await Promise.resolve();
    const settledBeforeRefresh = destroySettled;
    const deletedBeforeRefresh = deleteCronJob.mock.calls.length;

    deferred.resolve([]);
    await tickPromise;
    await jest.runOnlyPendingTimersAsync();
    await destroyPromise;

    expect(settledBeforeRefresh).toBe(false);
    expect(deletedBeforeRefresh).toBe(0);
    expect(deleteCronJob).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("stops and deletes the cron job after an in-flight refresh rejects", async () => {
    jest.useFakeTimers();
    const deferred = createDeferred<[]>();
    const refreshError = new Error("refresh failed");
    const consoleError = jest.spyOn(console, "error").mockImplementation();
    const { registry, deleteCronJob, registeredJob } = createRegistry();
    const service = {
      refreshAll: jest.fn(() => deferred.promise),
    } as unknown as RankingsService;
    const scheduler = new RankingsScheduler(service, registry, createConfig());
    scheduler.onModuleInit();
    const job = registeredJob();

    if (job === undefined) {
      throw new Error("Expected scheduler to register a cron job");
    }

    const tickPromise = job.fireOnTick();
    const destroyPromise = Promise.resolve(scheduler.onModuleDestroy());
    await Promise.resolve();
    deferred.reject(refreshError);
    await tickPromise;
    await jest.runOnlyPendingTimersAsync();
    await destroyPromise;
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledWith(
      "[Cron] error in callback",
      refreshError,
    );
    expect(deleteCronJob).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("does not register a cron job when scheduling is disabled", async () => {
    const { registry, addCronJob, deleteCronJob } = createRegistry();
    const service = {
      refreshAll: jest.fn(),
    } as unknown as RankingsService;
    const scheduler = new RankingsScheduler(
      service,
      registry,
      createConfig(false),
    );

    scheduler.onModuleInit();
    await scheduler.onModuleDestroy();
    await scheduler.onModuleDestroy();

    expect(addCronJob).not.toHaveBeenCalled();
    expect(deleteCronJob).not.toHaveBeenCalled();
    expect(service.refreshAll).not.toHaveBeenCalled();
  });

  it("can be destroyed repeatedly after deleting the registered job", async () => {
    jest.useFakeTimers();
    const { registry, deleteCronJob } = createRegistry();
    const service = {
      refreshAll: jest.fn(),
    } as unknown as RankingsService;
    const scheduler = new RankingsScheduler(service, registry, createConfig());
    scheduler.onModuleInit();

    await scheduler.onModuleDestroy();
    await scheduler.onModuleDestroy();

    expect(deleteCronJob).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
