import { runNodeCli } from "./run-node-cli.cjs";

describe("runNodeCli", () => {
  it("runs a project-local JavaScript CLI with the current Node executable", () => {
    const result = runNodeCli("jest/bin/jest", ["--version"], {
      env: process.env,
      encoding: "utf8",
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+\s*$/);
  });

  it("discovers the database integration test on Windows and POSIX", () => {
    const result = runNodeCli(
      "jest/bin/jest",
      ["--config", "jest.database.config.js", "--listTests"],
      { env: process.env, encoding: "utf8" },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("database.integration.e2e-spec.ts");
  });
});
