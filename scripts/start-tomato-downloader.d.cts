interface SpawnResult {
  error?: Error;
  status: number | null;
  signal: NodeJS.Signals | null;
}

interface RunnerDependencies {
  spawn?: (
    command: string,
    args: readonly string[],
    options: {
      env: NodeJS.ProcessEnv;
      shell: false;
      stdio: "inherit";
    },
  ) => SpawnResult;
}

interface MainDependencies extends RunnerDependencies {
  writeError?: (message: string) => void;
}

export function deriveTomatoWebAddress(baseUrl: string): string;

export function runTomatoDownloader(
  environment: NodeJS.ProcessEnv,
  dependencies?: RunnerDependencies,
): number;

export function main(
  environment?: NodeJS.ProcessEnv,
  dependencies?: MainDependencies,
): number;
