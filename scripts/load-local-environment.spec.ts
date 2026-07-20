import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadLocalEnvironment } from "./load-local-environment.cjs";

describe("loadLocalEnvironment", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "novel-scope-env-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("loads an existing .env without overwriting an injected variable", async () => {
    const preservedKey = "NOVEL_SCOPE_TEST_PRESERVED";
    const loadedKey = "NOVEL_SCOPE_TEST_LOADED";
    const envFilePath = join(directory, ".env");
    await writeFile(
      envFilePath,
      `${preservedKey}=from-file\n${loadedKey}=from-file\n`,
      "utf8",
    );
    const modulePath = resolve("scripts/load-local-environment.cjs");
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        `const { loadLocalEnvironment } = require(${JSON.stringify(modulePath)}); loadLocalEnvironment(${JSON.stringify(envFilePath)}); process.stdout.write(JSON.stringify({ preserved: process.env.${preservedKey}, loaded: process.env.${loadedKey} }));`,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, [preservedKey]: "injected" },
      },
    );

    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({
      preserved: "injected",
      loaded: "from-file",
    });
  });

  it("does nothing when .env is absent", () => {
    expect(loadLocalEnvironment(join(directory, ".env"))).toBe(false);
  });
});
