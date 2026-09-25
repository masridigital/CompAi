import type {
  CheckContext,
  IntegrationManifest,
  SyncEmployee,
} from '@trycompai/integration-platform';
import { halopsaManifest } from '@trycompai/integration-platform';
import {
  isListedEmployeeSyncProvider,
  resolveEmployeeSyncSource,
} from './employee-sync-source';

const mockInterpretDeclarativeSync = jest.fn();

jest.mock('@trycompai/integration-platform', () => {
  const actual = jest.requireActual<
    typeof import('@trycompai/integration-platform')
  >('@trycompai/integration-platform');
  return {
    ...actual,
    interpretDeclarativeSync: (...args: unknown[]) =>
      mockInterpretDeclarativeSync(...args),
  };
});

const baseManifest: IntegrationManifest = {
  id: 'entra-id',
  name: 'Entra',
  description: '',
  category: 'Identity & Access',
  logoUrl: '',
  auth: { type: 'custom', config: {} },
  capabilities: ['sync'],
  isActive: true,
};

const ctx = {} as CheckContext;
const employees: SyncEmployee[] = [{ email: 'a@acme.test', status: 'active' }];

describe('resolveEmployeeSyncSource', () => {
  beforeEach(() => jest.clearAllMocks());

  it('prefers a dynamic syncDefinition and reads its isDirectorySource', async () => {
    mockInterpretDeclarativeSync.mockReturnValue({
      run: jest.fn().mockResolvedValue(employees),
    });

    const source = resolveEmployeeSyncSource({
      manifest: baseManifest,
      syncDefinition: { steps: [], isDirectorySource: true },
    });

    expect(source?.isDirectorySource).toBe(true);
    await expect(source?.run(ctx)).resolves.toEqual(employees);
  });

  it('defaults a dynamic definition to non-directory', () => {
    mockInterpretDeclarativeSync.mockReturnValue({ run: jest.fn() });
    const source = resolveEmployeeSyncSource({
      manifest: baseManifest,
      syncDefinition: { steps: [] },
    });
    expect(source?.isDirectorySource).toBe(false);
  });

  it('falls back to the code manifest employeeSync (HaloPSA)', () => {
    const source = resolveEmployeeSyncSource({
      manifest: halopsaManifest,
      syncDefinition: null,
    });

    expect(mockInterpretDeclarativeSync).not.toHaveBeenCalled();
    expect(source?.run).toBe(halopsaManifest.employeeSync?.run);
    expect(source?.isDirectorySource).toBe(true);
  });

  it('returns null when the provider has no sync source', () => {
    expect(
      resolveEmployeeSyncSource({
        manifest: baseManifest,
        syncDefinition: undefined,
      }),
    ).toBeNull();
  });
});

describe('isListedEmployeeSyncProvider', () => {
  it('always lists regular sync providers', () => {
    expect(
      isListedEmployeeSyncProvider({
        manifest: baseManifest,
        hasActiveConnection: false,
      }),
    ).toBe(true);
  });

  it('lists halopsa only with an active connection', () => {
    expect(
      isListedEmployeeSyncProvider({
        manifest: halopsaManifest,
        hasActiveConnection: false,
      }),
    ).toBe(false);
    expect(
      isListedEmployeeSyncProvider({
        manifest: halopsaManifest,
        hasActiveConnection: true,
      }),
    ).toBe(true);
  });
});
