import { registerAs } from "@nestjs/config";
import { validateCrawlerEnvironment } from "./env.validation";

export default registerAs("crawler", () => {
  const environment = validateCrawlerEnvironment(process.env);

  return {
    qidianUserAgent: environment.QIDIAN_USER_AGENT,
    qidianRequestTimeoutMs: environment.QIDIAN_REQUEST_TIMEOUT_MS,
    fanqieRequestTimeoutMs: environment.FANQIE_REQUEST_TIMEOUT_MS,
  };
});
