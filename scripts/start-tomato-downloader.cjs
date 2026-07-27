const { spawnSync } = require("node:child_process");
const { mkdirSync, statSync } = require("node:fs");
const { constants } = require("node:os");
const { isAbsolute, resolve } = require("node:path");
const { loadLocalEnvironment } = require("./load-local-environment.cjs");

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const BASE_URL_ERROR =
  "TOMATO_DOWNLOADER_BASE_URL must be a local HTTP URL with an explicit port";

function requiredEnvironmentValue(environment, key) {
  const value = environment[key];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} is required`);
  }

  return value.trim();
}

function deriveTomatoWebAddress(baseUrl) {
  const normalizedBaseUrl = baseUrl.trim();
  let url;
  try {
    url = new URL(normalizedBaseUrl);
  } catch {
    throw new Error(BASE_URL_ERROR);
  }

  const authority = normalizedBaseUrl
    .slice(normalizedBaseUrl.indexOf("//") + 2)
    .split(/[/?#]/, 1)[0];
  const portText = authority?.match(/:(\d+)$/)?.[1];
  const port = portText === undefined ? Number.NaN : Number(portText);

  if (
    url.protocol !== "http:" ||
    !LOCAL_HOSTS.has(url.hostname) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(BASE_URL_ERROR);
  }

  return `${url.hostname}:${port}`;
}

function normalizeExecutablePath(rawPath) {
  if (!isAbsolute(rawPath)) {
    throw new Error(
      "TOMATO_DOWNLOADER_EXECUTABLE_PATH must be an absolute path",
    );
  }

  const executablePath = resolve(rawPath);
  let stats;
  try {
    stats = statSync(executablePath);
  } catch {
    throw new Error(
      `TOMATO_DOWNLOADER_EXECUTABLE_PATH must point to an existing file: ${executablePath}`,
    );
  }

  if (!stats.isFile()) {
    throw new Error(
      `TOMATO_DOWNLOADER_EXECUTABLE_PATH must point to an existing file: ${executablePath}`,
    );
  }

  return executablePath;
}

function prepareDataDirectory(rawPath) {
  if (!isAbsolute(rawPath)) {
    throw new Error("TOMATO_DOWNLOADER_DATA_DIR must be an absolute path");
  }

  const dataDirectory = resolve(rawPath);
  let stats;
  try {
    stats = statSync(dataDirectory);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new Error(
        `TOMATO_DOWNLOADER_DATA_DIR could not be created: ${dataDirectory}`,
      );
    }

    try {
      mkdirSync(dataDirectory, { recursive: true });
      stats = statSync(dataDirectory);
    } catch {
      throw new Error(
        `TOMATO_DOWNLOADER_DATA_DIR could not be created: ${dataDirectory}`,
      );
    }
  }

  if (!stats.isDirectory()) {
    throw new Error(
      `TOMATO_DOWNLOADER_DATA_DIR must point to a directory: ${dataDirectory}`,
    );
  }

  return dataDirectory;
}

function childExitCode(result) {
  if (result.error) {
    throw result.error;
  }

  if (Number.isInteger(result.status)) {
    return result.status;
  }

  if (result.signal) {
    const signalNumber = constants.signals[result.signal];
    if (Number.isInteger(signalNumber)) {
      return 128 + signalNumber;
    }
  }

  throw new Error("Downloader exited without a status or known signal");
}

function runTomatoDownloader(environment, dependencies = {}) {
  const rawExecutablePath = requiredEnvironmentValue(
    environment,
    "TOMATO_DOWNLOADER_EXECUTABLE_PATH",
  );
  const rawDataDirectory = requiredEnvironmentValue(
    environment,
    "TOMATO_DOWNLOADER_DATA_DIR",
  );
  const baseUrl = requiredEnvironmentValue(
    environment,
    "TOMATO_DOWNLOADER_BASE_URL",
  );
  const webAddress = deriveTomatoWebAddress(baseUrl);
  const executablePath = normalizeExecutablePath(rawExecutablePath);
  const dataDirectory = prepareDataDirectory(rawDataDirectory);
  const spawn = dependencies.spawn ?? spawnSync;
  const result = spawn(
    executablePath,
    ["--server", "--data-dir", dataDirectory],
    {
      env: { ...environment, TOMATO_WEB_ADDR: webAddress },
      shell: false,
      stdio: "inherit",
    },
  );

  return childExitCode(result);
}

function main(environment = process.env, dependencies = {}) {
  try {
    return runTomatoDownloader(environment, dependencies);
  } catch (error) {
    const writeError = dependencies.writeError ?? console.error;
    writeError(
      error instanceof Error ? error.message : "Downloader startup failed",
    );
    return 1;
  }
}

if (require.main === module) {
  loadLocalEnvironment();
  process.exitCode = main();
}

module.exports = {
  deriveTomatoWebAddress,
  main,
  runTomatoDownloader,
};
