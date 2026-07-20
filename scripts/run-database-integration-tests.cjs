const { spawnSync } = require("node:child_process");

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const applicationDatabaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl) {
  console.error(
    "Refusing database integration tests: TEST_DATABASE_URL is required.",
  );
  process.exit(1);
}

if (applicationDatabaseUrl && testDatabaseUrl === applicationDatabaseUrl) {
  console.error(
    "Refusing database integration tests: TEST_DATABASE_URL must differ from DATABASE_URL.",
  );
  process.exit(1);
}

const migrationEnvironment = {
  ...process.env,
  DATABASE_URL: testDatabaseUrl,
};

function run(args, environment) {
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(executable, args, {
    env: environment,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(["prisma", "migrate", "deploy"], migrationEnvironment);
run(
  ["jest", "--config", "jest.database.config.js", "--runInBand"],
  process.env,
);
