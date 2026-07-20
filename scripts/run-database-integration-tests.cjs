const { assertDatabaseIsolation } = require("./database-isolation.cjs");
const {
  runDatabaseIntegrationTests,
} = require("./database-integration-runner.cjs");
const { runNodeCli } = require("./run-node-cli.cjs");

runDatabaseIntegrationTests({
  environment: process.env,
  verifyIsolation: assertDatabaseIsolation,
  runCli: runNodeCli,
})
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Database test failed",
    );
    process.exitCode = 1;
  });
