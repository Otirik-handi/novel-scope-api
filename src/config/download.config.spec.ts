import downloadConfig from "./download.config";
import { validateDownloadEnvironment } from "./env.validation";

const required = {
  TOMATO_DOWNLOADER_BASE_URL: "http://127.0.0.1:18423",
  DOWNLOAD_ARTIFACT_DIR: "C:/NovelScope/downloads",
};

describe("download configuration", () => {
  it("normalizes required settings and applies defaults", () => {
    expect(validateDownloadEnvironment(required)).toEqual({
      TOMATO_DOWNLOADER_BASE_URL: "http://127.0.0.1:18423",
      TOMATO_DOWNLOADER_PASSWORD: null,
      DOWNLOAD_ARTIFACT_DIR: "C:\\NovelScope\\downloads",
      TOMATO_DOWNLOADER_REQUEST_TIMEOUT_MS: 10_000,
      TOMATO_DOWNLOAD_POLL_INTERVAL_MS: 1_000,
      TOMATO_DOWNLOAD_TASK_TIMEOUT_MS: 7_200_000,
    });
  });

  it.each(["TOMATO_DOWNLOADER_BASE_URL", "DOWNLOAD_ARTIFACT_DIR"] as const)(
    "requires %s",
    (key) => {
      const environment = { ...required };
      delete environment[key];
      expect(() => validateDownloadEnvironment(environment)).toThrow(
        `${key} is required`,
      );
    },
  );

  it.each([
    "ftp://127.0.0.1:18423",
    "http://user:secret@127.0.0.1:18423",
    "not-a-url",
  ])("rejects an unsafe Downloader URL: %s", (value) => {
    expect(() =>
      validateDownloadEnvironment({
        ...required,
        TOMATO_DOWNLOADER_BASE_URL: value,
      }),
    ).toThrow("TOMATO_DOWNLOADER_BASE_URL must be a safe HTTP URL");
  });

  it("requires an absolute artifact directory", () => {
    expect(() =>
      validateDownloadEnvironment({
        ...required,
        DOWNLOAD_ARTIFACT_DIR: "./downloads",
      }),
    ).toThrow("DOWNLOAD_ARTIFACT_DIR must be an absolute path");
  });

  it.each([
    "TOMATO_DOWNLOADER_REQUEST_TIMEOUT_MS",
    "TOMATO_DOWNLOAD_POLL_INTERVAL_MS",
    "TOMATO_DOWNLOAD_TASK_TIMEOUT_MS",
  ] as const)("rejects an invalid %s", (key) => {
    expect(() =>
      validateDownloadEnvironment({ ...required, [key]: "0" }),
    ).toThrow(`${key} must be a positive integer`);
  });

  it("loads the named configuration", () => {
    const original = { ...process.env };
    Object.assign(process.env, required, {
      TOMATO_DOWNLOADER_PASSWORD: " secret ",
    });

    try {
      expect(downloadConfig()).toEqual({
        baseUrl: "http://127.0.0.1:18423",
        password: "secret",
        artifactDirectory: "C:\\NovelScope\\downloads",
        requestTimeoutMs: 10_000,
        pollIntervalMs: 1_000,
        taskTimeoutMs: 7_200_000,
      });
    } finally {
      process.env = original;
    }
  });
});
