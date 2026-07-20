import { registerAs } from "@nestjs/config";
import { validateEnvironment } from "./env.validation";

export default registerAs("crawler", () => {
  const environment = validateEnvironment(process.env);

  return {
    qidianUserAgent: environment.QIDIAN_USER_AGENT,
    requestTimeoutMs: environment.QIDIAN_REQUEST_TIMEOUT_MS,
  };
});
