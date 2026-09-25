import {
  interpretDeclarativeSync,
  type CheckContext,
  type IntegrationManifest,
  type SyncDefinition,
  type SyncEmployee,
} from '@trycompai/integration-platform';

export interface EmployeeSyncSource {
  run: (ctx: CheckContext) => Promise<SyncEmployee[]>;
  isDirectorySource: boolean;
}

/**
 * Resolve how a non-built-in provider produces its employee list:
 * a dynamic integration's `syncDefinition` wins, otherwise a code manifest's
 * `employeeSync`. Returns null when the provider has neither.
 */
export function resolveEmployeeSyncSource({
  manifest,
  syncDefinition,
}: {
  manifest: IntegrationManifest;
  syncDefinition: unknown;
}): EmployeeSyncSource | null {
  if (syncDefinition) {
    const definition = syncDefinition as SyncDefinition;
    const runner = interpretDeclarativeSync({ definition });
    return {
      run: (ctx) => runner.run(ctx),
      // The Prisma JSON value may carry `isDirectorySource`; default false.
      isDirectorySource:
        (definition as { isDirectorySource?: boolean }).isDirectorySource ??
        false,
    };
  }

  if (manifest.employeeSync) {
    return {
      run: manifest.employeeSync.run,
      isDirectorySource: manifest.isDirectorySource ?? false,
    };
  }

  return null;
}

/**
 * Opt-in providers (`employeeSync.listOnlyWhenConnected`) are only offered in
 * the employee-sync picker once the org has an active connection.
 */
export function isListedEmployeeSyncProvider({
  manifest,
  hasActiveConnection,
}: {
  manifest: IntegrationManifest;
  hasActiveConnection: boolean;
}): boolean {
  if (!manifest.employeeSync?.listOnlyWhenConnected) return true;
  return hasActiveConnection;
}
