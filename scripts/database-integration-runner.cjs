const { constants } = require("node:os");

function childExitCode(result) {
  if (result.error) {
    throw result.error;
  }

  if (result.status !== null) {
    return result.status;
  }

  if (result.signal) {
    const signalNumber = constants.signals[result.signal];

    if (typeof signalNumber === "number") {
      return 128 + signalNumber;
    }
  }

  throw new Error("Child process ended without an exit status or known signal");
}

async function runDatabaseIntegrationTests(dependencies) {
  const { environment, verifyIsolation, runCli } = dependencies;

  await verifyIsolation({
    applicationDatabaseUrl: environment.DATABASE_URL,
    testDatabaseUrl: environment.TEST_DATABASE_URL,
  });

  const migrationResult = runCli(
    "prisma/build/index.js",
    ["migrate", "deploy"],
    {
      env: {
        ...environment,
        DATABASE_URL: environment.TEST_DATABASE_URL.trim(),
      },
      stdio: "inherit",
    },
  );
  const migrationExitCode = childExitCode(migrationResult);

  if (migrationExitCode !== 0) {
    return migrationExitCode;
  }

  return childExitCode(
    runCli(
      "jest/bin/jest",
      ["--config", "jest.database.config.js", "--runInBand"],
      { env: environment, stdio: "inherit" },
    ),
  );
}

module.exports = { runDatabaseIntegrationTests };
