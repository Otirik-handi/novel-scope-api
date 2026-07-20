export interface ChildProcessResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

export type RunCli = (
  moduleId: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; stdio: "inherit" },
) => ChildProcessResult;

export interface DatabaseIntegrationRunnerDependencies {
  environment: NodeJS.ProcessEnv;
  verifyIsolation: (input: {
    applicationDatabaseUrl?: string;
    testDatabaseUrl?: string;
  }) => Promise<void>;
  runCli: RunCli;
}

export function runDatabaseIntegrationTests(
  dependencies: DatabaseIntegrationRunnerDependencies,
): Promise<number>;
