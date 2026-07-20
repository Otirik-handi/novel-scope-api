const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

function loadLocalEnvironment(envFilePath = resolve(process.cwd(), ".env")) {
  if (!existsSync(envFilePath)) {
    return false;
  }

  process.loadEnvFile(envFilePath);
  return true;
}

module.exports = { loadLocalEnvironment };
