import {
  assertDatabaseIsolation,
  type DatabaseIdentity,
  type ProbeDatabaseIdentity,
} from "./database-isolation.cjs";

const applicationIdentity: DatabaseIdentity = {
  clusterId: "cluster-a",
  databaseName: "application",
  databaseOid: "10",
};
const testIdentity: DatabaseIdentity = {
  clusterId: "cluster-a",
  databaseName: "test",
  databaseOid: "20",
};

describe("assertDatabaseIsolation", () => {
  it.each([
    [{ testDatabaseUrl: "test-database" }, "DATABASE_URL"],
    [{ applicationDatabaseUrl: "application-database" }, "TEST_DATABASE_URL"],
  ])("rejects when a required URL is missing", async (input, expectedName) => {
    const probeIdentity: jest.MockedFunction<ProbeDatabaseIdentity> = jest.fn();

    await expect(
      assertDatabaseIsolation(input, probeIdentity),
    ).rejects.toThrow(`${expectedName} is required`);
    expect(probeIdentity).not.toHaveBeenCalled();
  });

  it("rejects textually different URLs for the same database identity", async () => {
    const probeIdentity: jest.MockedFunction<ProbeDatabaseIdentity> = jest.fn();
    probeIdentity
      .mockResolvedValueOnce(applicationIdentity)
      .mockResolvedValueOnce({
        ...applicationIdentity,
        databaseName: "renamed-application",
      });

    await expect(
      assertDatabaseIsolation(
        {
          applicationDatabaseUrl: "application-spelling",
          testDatabaseUrl: "test-spelling",
        },
        probeIdentity,
      ),
    ).rejects.toThrow("must identify different PostgreSQL databases");
  });

  it("accepts different verified database identities", async () => {
    const probeIdentity: jest.MockedFunction<ProbeDatabaseIdentity> = jest.fn();
    probeIdentity
      .mockResolvedValueOnce(applicationIdentity)
      .mockResolvedValueOnce(testIdentity);

    await expect(
      assertDatabaseIsolation(
        {
          applicationDatabaseUrl: "application-database",
          testDatabaseUrl: "test-database",
        },
        probeIdentity,
      ),
    ).resolves.toBeUndefined();
  });

  it("fails closed when either identity cannot be confirmed", async () => {
    const probeIdentity: jest.MockedFunction<ProbeDatabaseIdentity> = jest.fn();
    probeIdentity
      .mockResolvedValueOnce(applicationIdentity)
      .mockRejectedValueOnce(new Error("probe failed"));

    await expect(
      assertDatabaseIsolation(
        {
          applicationDatabaseUrl: "application-database",
          testDatabaseUrl: "test-database",
        },
        probeIdentity,
      ),
    ).rejects.toThrow("Unable to verify database isolation");
  });

  it("fails closed when a probe returns an incomplete identity", async () => {
    const probeIdentity: jest.MockedFunction<ProbeDatabaseIdentity> = jest.fn();
    probeIdentity
      .mockResolvedValueOnce({
        ...applicationIdentity,
        clusterId: "",
      })
      .mockResolvedValueOnce(testIdentity);

    await expect(
      assertDatabaseIsolation(
        {
          applicationDatabaseUrl: "application-database",
          testDatabaseUrl: "test-database",
        },
        probeIdentity,
      ),
    ).rejects.toThrow("Unable to verify database isolation");
  });
});
