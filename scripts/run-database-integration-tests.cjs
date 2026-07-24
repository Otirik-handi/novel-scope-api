const { assertDatabaseIsolation } = require("./database-isolation.cjs");
const { loadLocalEnvironment } = require("./load-local-environment.cjs");
const { runDatabaseIntegrationTests } = require("./database-integration-runner.cjs");
const { runNodeCli } = require("./run-node-cli.cjs");
const { verifyRankingMigration } = require("./verify-ranking-migration.cjs");

loadLocalEnvironment();

runDatabaseIntegrationTests({
  environment: process.env,
  verifyIsolation: assertDatabaseIsolation,
  verifyRankingMigration,
  runCli: runNodeCli,
})
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Database test failed");
    process.exitCode = 1;
  });
