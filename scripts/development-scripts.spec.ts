import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface PackageManifest {
  scripts?: Record<string, string>;
}

interface NestCliConfiguration {
  compilerOptions?: {
    plugins?: string[];
  };
}

function readJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(resolve(fileName), "utf8")) as T;
}

describe("development scripts", () => {
  const packageManifest = readJson<PackageManifest>("package.json");
  const nestCliConfiguration =
    readJson<NestCliConfiguration>("nest-cli.json");

  it("compiles the application with the Swagger CLI plugin", () => {
    expect(nestCliConfiguration.compilerOptions?.plugins).toContain(
      "@nestjs/swagger",
    );
    expect(packageManifest.scripts?.["swagger:compile"]).toBe("nest build");
  });

  it("prepares Swagger and the database before starting watch mode", () => {
    expect(packageManifest.scripts?.dev).toBe(
      "bun run swagger:compile && bun run db:migrate:dev && bun run start:dev",
    );
  });
});
