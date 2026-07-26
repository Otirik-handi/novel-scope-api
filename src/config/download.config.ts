import { registerAs } from "@nestjs/config";
import { validateDownloadEnvironment } from "./env.validation";

export default registerAs("download", () => {
  const environment = validateDownloadEnvironment(process.env);

  return {
    baseUrl: environment.TOMATO_DOWNLOADER_BASE_URL,
    password: environment.TOMATO_DOWNLOADER_PASSWORD,
    artifactDirectory: environment.DOWNLOAD_ARTIFACT_DIR,
    requestTimeoutMs: environment.TOMATO_DOWNLOADER_REQUEST_TIMEOUT_MS,
    pollIntervalMs: environment.TOMATO_DOWNLOAD_POLL_INTERVAL_MS,
    taskTimeoutMs: environment.TOMATO_DOWNLOAD_TASK_TIMEOUT_MS,
  };
});
