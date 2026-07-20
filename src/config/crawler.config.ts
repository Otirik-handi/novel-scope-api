import { registerAs } from "@nestjs/config";

export default registerAs("crawler", () => ({
  qidianUserAgent: process.env.QIDIAN_USER_AGENT as string,
  requestTimeoutMs: Number(process.env.QIDIAN_REQUEST_TIMEOUT_MS),
}));
