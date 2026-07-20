import { registerAs } from "@nestjs/config";
import { validateDatabaseEnvironment } from "./env.validation";

export default registerAs("database", () => {
  const environment = validateDatabaseEnvironment(process.env);

  return {
    url: environment.DATABASE_URL,
  };
});
