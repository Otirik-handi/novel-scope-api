import { registerAs } from "@nestjs/config";
import { validateEnvironment } from "./env.validation";

export default registerAs("database", () => {
  const environment = validateEnvironment(process.env);

  return {
    url: environment.DATABASE_URL,
  };
});
