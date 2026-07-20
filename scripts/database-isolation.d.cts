export interface DatabaseIdentity {
  clusterId: string;
  databaseName: string;
  databaseOid: string;
}

export type ProbeDatabaseIdentity = (
  databaseUrl: string,
) => Promise<DatabaseIdentity>;

export interface DatabaseIsolationInput {
  applicationDatabaseUrl?: string;
  testDatabaseUrl?: string;
}

export const DATABASE_OPERATION_TIMEOUT_MS: number;

export function probeDatabaseIdentity(
  databaseUrl: string,
): Promise<DatabaseIdentity>;

export function assertDatabaseIsolation(
  input: DatabaseIsolationInput,
  probeIdentity?: ProbeDatabaseIdentity,
): Promise<void>;
