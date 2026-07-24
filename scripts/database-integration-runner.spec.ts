import { constants } from "node:os";
import { assertDatabaseIsolation } from "./database-isolation.cjs";
import {
  runDatabaseIntegrationTests,
  type ChildProcessResult,
  type RunCli,
} from "./database-integration-runner.cjs";

const success: ChildProcessResult = { status: 0, signal: null };
const environment = {
  DATABASE_URL: "application-database",
  TEST_DATABASE_URL: "test-database",
};

function createRunCli(...results: ChildProcessResult[]): jest.MockedFunction<RunCli> {
  const runCli: jest.MockedFunction<RunCli> = jest.fn();
  for (const result of results) {
    runCli.mockReturnValueOnce(result);
  }
  return runCli;
}

function createVerifyRankingMigration(): jest.Mock<
  Promise<void>,
  [
    {
      testDatabaseUrl?: string;
    },
  ]
> {
  return jest.fn().mockResolvedValue(undefined);
}

describe("runDatabaseIntegrationTests", () => {
  it("does not start migration when a required URL is missing", async () => {
    const runCli = createRunCli();
    const verifyRankingMigration = createVerifyRankingMigration();

    await expect(
      runDatabaseIntegrationTests({
        environment: { TEST_DATABASE_URL: "test-database" },
        verifyIsolation: assertDatabaseIsolation,
        verifyRankingMigration,
        runCli,
      }),
    ).rejects.toThrow("DATABASE_URL is required");
    expect(verifyRankingMigration).not.toHaveBeenCalled();
    expect(runCli).not.toHaveBeenCalled();
  });

  it("does not start migration when both URLs identify the same database", async () => {
    const identity = {
      clusterId: "cluster-a",
      databaseName: "shared",
      databaseOid: "10",
    };
    const runCli = createRunCli();
    const verifyRankingMigration = createVerifyRankingMigration();

    await expect(
      runDatabaseIntegrationTests({
        environment,
        verifyIsolation: (input) => assertDatabaseIsolation(input, async () => identity),
        verifyRankingMigration,
        runCli,
      }),
    ).rejects.toThrow("must identify different PostgreSQL databases");
    expect(verifyRankingMigration).not.toHaveBeenCalled();
    expect(runCli).not.toHaveBeenCalled();
  });

  it("overrides DATABASE_URL only for the migration process", async () => {
    const runCli = createRunCli(success, success);
    const verifyIsolation = jest.fn().mockResolvedValue(undefined);
    const verifyRankingMigration = createVerifyRankingMigration();

    await expect(
      runDatabaseIntegrationTests({
        environment,
        verifyIsolation,
        verifyRankingMigration,
        runCli,
      }),
    ).resolves.toBe(0);
    expect(verifyRankingMigration).toHaveBeenCalledWith({
      testDatabaseUrl: "test-database",
    });
    expect(verifyIsolation.mock.invocationCallOrder[0]).toBeLessThan(
      verifyRankingMigration.mock.invocationCallOrder[0],
    );
    expect(verifyRankingMigration.mock.invocationCallOrder[0]).toBeLessThan(
      runCli.mock.invocationCallOrder[0],
    );
    expect(runCli).toHaveBeenNthCalledWith(
      1,
      "prisma/build/index.js",
      ["migrate", "deploy"],
      expect.objectContaining({
        env: expect.objectContaining({ DATABASE_URL: "test-database" }),
      }),
    );
    expect(runCli.mock.calls[1][2].env).toBe(environment);
    expect(environment.DATABASE_URL).toBe("application-database");
  });

  it("does not start Jest when migration fails", async () => {
    const runCli = createRunCli({ status: 2, signal: null });

    await expect(
      runDatabaseIntegrationTests({
        environment,
        verifyIsolation: jest.fn().mockResolvedValue(undefined),
        verifyRankingMigration: createVerifyRankingMigration(),
        runCli,
      }),
    ).resolves.toBe(2);
    expect(runCli).toHaveBeenCalledTimes(1);
  });

  it("returns the Jest exit code", async () => {
    const runCli = createRunCli(success, { status: 7, signal: null });

    await expect(
      runDatabaseIntegrationTests({
        environment,
        verifyIsolation: jest.fn().mockResolvedValue(undefined),
        verifyRankingMigration: createVerifyRankingMigration(),
        runCli,
      }),
    ).resolves.toBe(7);
  });

  it("propagates child spawn errors", async () => {
    const spawnError = new Error("spawn failed");
    const runCli = createRunCli({
      status: null,
      signal: null,
      error: spawnError,
    });

    await expect(
      runDatabaseIntegrationTests({
        environment,
        verifyIsolation: jest.fn().mockResolvedValue(undefined),
        verifyRankingMigration: createVerifyRankingMigration(),
        runCli,
      }),
    ).rejects.toBe(spawnError);
  });

  it("converts a child signal to its conventional exit code", async () => {
    const runCli = createRunCli({ status: null, signal: "SIGTERM" });

    await expect(
      runDatabaseIntegrationTests({
        environment,
        verifyIsolation: jest.fn().mockResolvedValue(undefined),
        verifyRankingMigration: createVerifyRankingMigration(),
        runCli,
      }),
    ).resolves.toBe(128 + constants.signals.SIGTERM);
    expect(runCli).toHaveBeenCalledTimes(1);
  });
});
