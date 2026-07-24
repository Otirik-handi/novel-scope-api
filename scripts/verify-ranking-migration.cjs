const { randomUUID } = require("node:crypto");
const { readFile } = require("node:fs/promises");
const { join } = require("node:path");
const { Client } = require("pg");

const MIGRATION_DIRECTORIES = [
  "20260720000000_init",
  "20260720180000_preserve_ranking_history",
  "20260724000000_add_rank_type_key_and_fanqie",
];
const SCHEMA_NAME_PATTERN = /^[a-z0-9_]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATABASE_OPERATION_TIMEOUT_MS = 5_000;

function requireCondition(condition, message) {
  if (!condition) {
    throw new Error(`Ranking migration verification failed: ${message}`);
  }
}

function quoteSchemaName(schemaName) {
  requireCondition(SCHEMA_NAME_PATTERN.test(schemaName), "generated schema name is invalid");
  return `"${schemaName}"`;
}

async function readMigrationSql(directory) {
  return readFile(
    join(__dirname, "..", "prisma", "migrations", directory, "migration.sql"),
    "utf8",
  );
}

async function verifyRankingMigration({ testDatabaseUrl }) {
  const connectionString = testDatabaseUrl?.trim();
  requireCondition(
    Boolean(connectionString),
    "TEST_DATABASE_URL is required after isolation verification",
  );

  const schemaName = `fanqie_migration_${randomUUID().replaceAll("-", "")}`;
  const quotedSchemaName = quoteSchemaName(schemaName);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: DATABASE_OPERATION_TIMEOUT_MS,
    query_timeout: DATABASE_OPERATION_TIMEOUT_MS,
  });
  let connected = false;
  let schemaCreated = false;

  try {
    const migrations = await Promise.all(MIGRATION_DIRECTORIES.map(readMigrationSql));
    await client.connect();
    connected = true;
    await client.query(`CREATE SCHEMA ${quotedSchemaName}`);
    schemaCreated = true;
    await client.query(`SET search_path TO ${quotedSchemaName}`);

    await client.query(migrations[0]);
    await client.query(migrations[1]);

    const bookId = randomUUID();
    const snapshotId = randomUUID();
    const itemId = randomUUID();
    await client.query(
      `
        INSERT INTO "Book" (
          "id", "platform", "externalBookId", "createdAt", "updatedAt"
        ) VALUES ($1, 'qidian', 'migration-verification-book', NOW(), NOW())
      `,
      [bookId],
    );
    await client.query(
      `
        INSERT INTO "RankingSnapshot" (
          "id", "platform", "rankType", "sourceUrl", "fetchedAt"
        ) VALUES (
          $1, 'qidian', 'yuepiao',
          'https://www.qidian.com/rank/yuepiao/', NOW()
        )
      `,
      [snapshotId],
    );
    await client.query(
      `
        INSERT INTO "RankingItem" (
          "id", "snapshotId", "bookId", "rank", "externalBookId",
          "title", "author", "sourceUrl", "metrics"
        ) VALUES (
          $1, $2, $3, 1, 'migration-verification-book',
          '迁移验证作品', '迁移验证作者',
          'https://www.qidian.com/book/migration-verification-book/',
          '{}'::jsonb
        )
      `,
      [itemId, snapshotId, bookId],
    );

    const before = await client.query(`
      SELECT
        (SELECT COUNT(*)::integer FROM "Book") AS "bookCount",
        (SELECT COUNT(*)::integer FROM "RankingSnapshot") AS "snapshotCount",
        (SELECT COUNT(*)::integer FROM "RankingItem") AS "itemCount"
    `);

    await client.query(migrations[2]);

    const after = await client.query(
      `
        SELECT
          b."id"::text AS "bookId",
          s."id"::text AS "snapshotId",
          i."id"::text AS "itemId",
          s."rankTypeKey",
          s."rankType",
          (SELECT COUNT(*)::integer FROM "Book") AS "bookCount",
          (SELECT COUNT(*)::integer FROM "RankingSnapshot") AS "snapshotCount",
          (SELECT COUNT(*)::integer FROM "RankingItem") AS "itemCount"
        FROM "Book" b
        JOIN "RankingItem" i ON i."bookId" = b."id"
        JOIN "RankingSnapshot" s ON s."id" = i."snapshotId"
        WHERE b."id" = $1 AND s."id" = $2 AND i."id" = $3
      `,
      [bookId, snapshotId, itemId],
    );
    requireCondition(after.rowCount === 1, "seeded relationships were not preserved");

    const beforeCounts = before.rows[0];
    const migrated = after.rows[0];
    requireCondition(UUID_PATTERN.test(migrated.bookId), "Book UUID changed format");
    requireCondition(migrated.bookId === bookId, "Book UUID changed");
    requireCondition(migrated.snapshotId === snapshotId, "snapshot UUID changed");
    requireCondition(migrated.itemId === itemId, "ranking item UUID changed");
    requireCondition(
      migrated.bookCount === beforeCounts.bookCount &&
        migrated.snapshotCount === beforeCounts.snapshotCount &&
        migrated.itemCount === beforeCounts.itemCount,
      "row counts changed during migration",
    );
    requireCondition(migrated.rankTypeKey === "yuepiao", "rankTypeKey was not backfilled");
    requireCondition(migrated.rankType === "月票榜", "rankType display name was not localized");

    const column = await client.query(
      `
        SELECT is_nullable AS "isNullable"
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = 'RankingSnapshot'
          AND column_name = 'rankTypeKey'
      `,
      [schemaName],
    );
    requireCondition(column.rows[0]?.isNullable === "NO", "rankTypeKey is not NOT NULL");

    const indexes = await client.query(`SELECT indexname FROM pg_indexes WHERE schemaname = $1`, [
      schemaName,
    ]);
    const indexNames = new Set(indexes.rows.map((row) => row.indexname));
    requireCondition(
      !indexNames.has("RankingSnapshot_platform_rankType_fetchedAt_idx"),
      "legacy ranking index still exists",
    );
    requireCondition(
      indexNames.has("RankingSnapshot_platform_rankTypeKey_fetchedAt_idx"),
      "rankTypeKey ranking index is missing",
    );

    console.log("Ranking migration upgrade verification passed");
  } finally {
    if (connected) {
      if (schemaCreated) {
        await client.query("RESET search_path").catch(() => undefined);
        await client.query(`DROP SCHEMA ${quotedSchemaName} CASCADE`).catch(() => undefined);
      }
      await client.end().catch(() => undefined);
    }
  }
}

module.exports = { verifyRankingMigration };
