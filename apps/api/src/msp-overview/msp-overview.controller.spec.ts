jest.mock('@trycompai/auth', () =>
  jest.requireActual('./msp-auth.test-fixture'),
);
jest.mock('@db', () => ({ db: {}, Prisma: { join: jest.fn() } }));
jest.mock('../auth/auth.server', () => ({ auth: { api: {} } }));
jest.mock('../integration-platform/services/check-results.service', () => ({
  CheckResultsService: class {},
}));
jest.mock('../client-posture/client-posture-query.service', () => ({
  ClientPostureQueryService: class {},
}));

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { SKIP_ORG_CHECK_KEY } from '../auth/skip-org-check.decorator';
import type { MspChecksQuery } from './msp-checks.query';
import type { MspFindingsQuery } from './msp-findings.query';
import type { MspHaloTicketsQuery } from './msp-halo.query';
import { MspOverviewController } from './msp-overview.controller';
import type { MspOverviewService } from './msp-overview.service';
import type { MspRequest, MspScope } from './msp-scope';
import type { MspScopeService } from './msp-scope.service';
import { MspStaffGuard } from './msp-staff.guard';
import type { MspTasksQuery } from './msp-tasks.query';

const scope: MspScope = {
  isPlatformAdmin: false,
  orgs: [],
  permissionsByOrg: new Map(),
};

function build() {
  const resolve = jest.fn().mockResolvedValue(scope);
  const list = jest.fn().mockResolvedValue({ data: [], nextCursor: null });
  const controller = new MspOverviewController(
    { resolve } as unknown as MspScopeService,
    { getOverview: jest.fn() } as unknown as MspOverviewService,
    { list } as unknown as MspTasksQuery,
    { list: jest.fn() } as unknown as MspFindingsQuery,
    { listFailing: jest.fn() } as unknown as MspChecksQuery,
    { list: jest.fn() } as unknown as MspHaloTicketsQuery,
  );
  return { controller, resolve, list };
}

function request(overrides: Partial<MspRequest>): MspRequest {
  return { userId: 'usr_1', mspRole: 'msp_staff', ...overrides } as MspRequest;
}

describe('MspOverviewController', () => {
  it('is guarded by HybridAuthGuard + MspStaffGuard and skips the org check', () => {
    const guards: unknown[] = Reflect.getMetadata(
      GUARDS_METADATA,
      MspOverviewController,
    );
    expect(guards).toEqual([HybridAuthGuard, MspStaffGuard]);
    expect(Reflect.getMetadata(SKIP_ORG_CHECK_KEY, MspOverviewController)).toBe(
      true,
    );
  });

  it('resolves the scope from the authenticated user and passes parsed queries', async () => {
    const { controller, resolve, list } = build();
    await controller.tasks(request({}), { view: 'due-soon', limit: '10' });
    expect(resolve).toHaveBeenCalledWith({
      userId: 'usr_1',
      role: 'msp_staff',
    });
    expect(list).toHaveBeenCalledWith({
      scope,
      query: { view: 'due-soon', limit: 10, cursor: undefined },
    });
  });

  it('rejects invalid query params before touching the database', async () => {
    const { controller, resolve } = build();
    await expect(controller.tasks(request({}), { limit: '0' })).rejects.toThrow(
      BadRequestException,
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it('refuses a request the staff guard did not tag', async () => {
    const { controller } = build();
    await expect(
      controller.overview(request({ mspRole: undefined })),
    ).rejects.toThrow(ForbiddenException);
  });
});
