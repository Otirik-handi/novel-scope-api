import { Client } from "pg";
import {
  DATABASE_OPERATION_TIMEOUT_MS,
  probeDatabaseIdentity,
} from "./database-isolation.cjs";

jest.mock("pg", () => ({ Client: jest.fn() }));

describe("probeDatabaseIdentity", () => {
  it("sets finite connection and query timeouts on the PostgreSQL client", async () => {
    const connect = jest.fn().mockResolvedValue(undefined);
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          clusterId: "cluster-a",
          databaseName: "test",
          databaseOid: "20",
        },
      ],
    });
    const end = jest.fn().mockResolvedValue(undefined);
    const mockedClient = jest.mocked(Client);
    mockedClient.mockImplementation(
      () => ({ connect, query, end }) as never,
    );

    await expect(probeDatabaseIdentity("test-database")).resolves.toEqual({
      clusterId: "cluster-a",
      databaseName: "test",
      databaseOid: "20",
    });
    expect(DATABASE_OPERATION_TIMEOUT_MS).toBe(5_000);
    expect(mockedClient).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeoutMillis: 5_000,
        query_timeout: 5_000,
      }),
    );
  });
});
