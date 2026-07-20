const { Client } = require("pg");

const DATABASE_OPERATION_TIMEOUT_MS = 5_000;

const DATABASE_IDENTITY_QUERY = `
  SELECT
    system_identifier::text AS "clusterId",
    current_database() AS "databaseName",
    (
      SELECT oid::text
      FROM pg_database
      WHERE datname = current_database()
    ) AS "databaseOid"
  FROM pg_control_system()
`;

async function probeDatabaseIdentity(databaseUrl) {
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: DATABASE_OPERATION_TIMEOUT_MS,
    query_timeout: DATABASE_OPERATION_TIMEOUT_MS,
  });

  try {
    await client.connect();
    const result = await client.query(DATABASE_IDENTITY_QUERY);
    const identity = result.rows[0];

    if (
      !identity?.clusterId ||
      !identity.databaseName ||
      !identity.databaseOid
    ) {
      throw new Error("Database identity query returned incomplete data");
    }

    return identity;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function assertDatabaseIsolation(
  input,
  probeIdentity = probeDatabaseIdentity,
) {
  const applicationDatabaseUrl = input.applicationDatabaseUrl?.trim();
  const testDatabaseUrl = input.testDatabaseUrl?.trim();

  if (!applicationDatabaseUrl) {
    throw new Error("DATABASE_URL is required for database integration tests");
  }

  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for database integration tests");
  }

  let applicationIdentity;
  let testIdentity;

  try {
    applicationIdentity = await probeIdentity(applicationDatabaseUrl);
    testIdentity = await probeIdentity(testDatabaseUrl);
  } catch {
    throw new Error("Unable to verify database isolation");
  }

  if (
    !applicationIdentity?.clusterId ||
    !applicationIdentity.databaseName ||
    !applicationIdentity.databaseOid ||
    !testIdentity?.clusterId ||
    !testIdentity.databaseName ||
    !testIdentity.databaseOid
  ) {
    throw new Error("Unable to verify database isolation");
  }

  if (
    applicationIdentity.clusterId === testIdentity.clusterId &&
    applicationIdentity.databaseOid === testIdentity.databaseOid
  ) {
    throw new Error(
      "DATABASE_URL and TEST_DATABASE_URL must identify different PostgreSQL databases",
    );
  }
}

module.exports = {
  DATABASE_OPERATION_TIMEOUT_MS,
  assertDatabaseIsolation,
  probeDatabaseIdentity,
};
