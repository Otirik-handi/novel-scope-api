import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  deriveTomatoWebAddress,
  main,
  runTomatoDownloader,
} from "./start-tomato-downloader.cjs";

describe("start-tomato-downloader", () => {
  let directory: string;
  let executablePath: string;
  let dataDirectory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "novel-scope-downloader-"));
    executablePath = join(directory, "Tomato Downloader.exe");
    dataDirectory = join(directory, "Downloader Data");
    await writeFile(executablePath, "", "utf8");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function validEnvironment(): NodeJS.ProcessEnv {
    return {
      TOMATO_DOWNLOADER_EXECUTABLE_PATH: executablePath,
      TOMATO_DOWNLOADER_DATA_DIR: dataDirectory,
      TOMATO_DOWNLOADER_BASE_URL: "http://127.0.0.1:18423",
    };
  }

  it("starts the configured executable in the foreground", async () => {
    const environment = {
      ...validEnvironment(),
      TOMATO_WEB_ADDR: "127.0.0.1:9999",
      NOVEL_SCOPE_TEST_MARKER: "preserved",
    };
    const spawn = jest.fn(() => ({ status: 7, signal: null }));

    const exitCode = runTomatoDownloader(environment, { spawn });

    expect(exitCode).toBe(7);
    expect(spawn).toHaveBeenCalledWith(
      executablePath,
      ["--server", "--data-dir", dataDirectory],
      {
        env: {
          ...environment,
          TOMATO_WEB_ADDR: "127.0.0.1:18423",
        },
        shell: false,
        stdio: "inherit",
      },
    );
    expect(environment.TOMATO_WEB_ADDR).toBe("127.0.0.1:9999");
    expect((await stat(dataDirectory)).isDirectory()).toBe(true);
  });

  it("reuses an existing data directory", async () => {
    await mkdir(dataDirectory);
    const spawn = jest.fn(() => ({ status: 0, signal: null }));

    expect(runTomatoDownloader(validEnvironment(), { spawn })).toBe(0);
    expect((await stat(dataDirectory)).isDirectory()).toBe(true);
  });

  it.each([
    ["http://localhost:18423", "localhost:18423"],
    ["http://[::1]:18423", "[::1]:18423"],
    ["http://127.0.0.1:80", "127.0.0.1:80"],
  ])("derives a local web address from %s", (baseUrl, expected) => {
    expect(deriveTomatoWebAddress(baseUrl)).toBe(expected);
  });

  it.each([
    "not-a-url",
    "https://127.0.0.1:18423",
    "http://0.0.0.0:18423",
    "http://example.com:18423",
    "http://127.0.0.1",
    "http://user@127.0.0.1:18423",
    "http://password:secret@127.0.0.1:18423",
    "http://127.0.0.1:18423/api",
    "http://127.0.0.1:18423?token=value",
    "http://127.0.0.1:18423#fragment",
  ])("rejects unsafe Downloader base URL %s", (baseUrl) => {
    expect(() => deriveTomatoWebAddress(baseUrl)).toThrow(
      "TOMATO_DOWNLOADER_BASE_URL must be a local HTTP URL with an explicit port",
    );
  });

  it.each([
    "TOMATO_DOWNLOADER_EXECUTABLE_PATH",
    "TOMATO_DOWNLOADER_DATA_DIR",
    "TOMATO_DOWNLOADER_BASE_URL",
  ])("rejects missing %s", (key) => {
    const environment = validEnvironment();
    delete environment[key];

    expect(() => runTomatoDownloader(environment)).toThrow(
      `${key} is required`,
    );
  });

  it.each([
    "TOMATO_DOWNLOADER_EXECUTABLE_PATH",
    "TOMATO_DOWNLOADER_DATA_DIR",
    "TOMATO_DOWNLOADER_BASE_URL",
  ])("rejects blank %s", (key) => {
    const environment = validEnvironment();
    environment[key] = "   ";

    expect(() => runTomatoDownloader(environment)).toThrow(
      `${key} is required`,
    );
  });

  it("rejects a relative executable path", () => {
    expect(() =>
      runTomatoDownloader({
        ...validEnvironment(),
        TOMATO_DOWNLOADER_EXECUTABLE_PATH: ".\\TomatoDownloader.exe",
      }),
    ).toThrow("TOMATO_DOWNLOADER_EXECUTABLE_PATH must be an absolute path");
  });

  it("rejects a missing executable file", () => {
    const missingPath = join(directory, "missing.exe");

    expect(() =>
      runTomatoDownloader({
        ...validEnvironment(),
        TOMATO_DOWNLOADER_EXECUTABLE_PATH: missingPath,
      }),
    ).toThrow(
      `TOMATO_DOWNLOADER_EXECUTABLE_PATH must point to an existing file: ${missingPath}`,
    );
  });

  it("rejects an executable path that points to a directory", () => {
    expect(() =>
      runTomatoDownloader({
        ...validEnvironment(),
        TOMATO_DOWNLOADER_EXECUTABLE_PATH: directory,
      }),
    ).toThrow(
      `TOMATO_DOWNLOADER_EXECUTABLE_PATH must point to an existing file: ${directory}`,
    );
  });

  it("rejects a relative data directory", () => {
    expect(() =>
      runTomatoDownloader({
        ...validEnvironment(),
        TOMATO_DOWNLOADER_DATA_DIR: ".\\tomato-data",
      }),
    ).toThrow("TOMATO_DOWNLOADER_DATA_DIR must be an absolute path");
  });

  it("rejects a data directory path that points to a file", async () => {
    await writeFile(dataDirectory, "not a directory", "utf8");

    expect(() => runTomatoDownloader(validEnvironment())).toThrow(
      `TOMATO_DOWNLOADER_DATA_DIR must point to a directory: ${dataDirectory}`,
    );
  });

  it("propagates a child spawn error", () => {
    const spawnError = new Error("spawn failed");
    const spawn = jest.fn(() => ({
      error: spawnError,
      status: null,
      signal: null,
    }));

    expect(() => runTomatoDownloader(validEnvironment(), { spawn })).toThrow(
      spawnError,
    );
  });

  it("maps a child signal to a conventional exit code", () => {
    const spawn = jest.fn(() => ({ status: null, signal: "SIGTERM" as const }));

    expect(runTomatoDownloader(validEnvironment(), { spawn })).toBe(
      128 + constants.signals.SIGTERM,
    );
  });

  it("rejects a child result without a status or known signal", () => {
    const spawn = jest.fn(() => ({ status: null, signal: null }));

    expect(() => runTomatoDownloader(validEnvironment(), { spawn })).toThrow(
      "Downloader exited without a status or known signal",
    );
  });

  it("returns a safe CLI error without serializing the environment", () => {
    const writeError = jest.fn();
    const environment = {
      ...validEnvironment(),
      TOMATO_DOWNLOADER_EXECUTABLE_PATH: join(directory, "missing.exe"),
      TOMATO_DOWNLOADER_PASSWORD: "do-not-print-this",
    };

    expect(main(environment, { writeError })).toBe(1);
    expect(writeError).toHaveBeenCalledTimes(1);
    expect(writeError.mock.calls[0]?.[0]).toContain(
      "TOMATO_DOWNLOADER_EXECUTABLE_PATH",
    );
    expect(writeError.mock.calls[0]?.[0]).not.toContain("do-not-print-this");
  });

  it("exposes the Downloader startup npm command", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve("package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts["start:downloader"]).toBe(
      "node scripts/start-tomato-downloader.cjs",
    );
  });

  it("documents the required Downloader startup environment", async () => {
    const example = await readFile(resolve(".env.example"), "utf8");

    expect(example).toContain(
      "TOMATO_DOWNLOADER_EXECUTABLE_PATH=C:/Tools/TomatoNovelDownloader-Win64-v2.4.13.exe",
    );
    expect(example).toContain(
      "TOMATO_DOWNLOADER_DATA_DIR=C:/NovelScope/tomato-downloader",
    );
  });
});
