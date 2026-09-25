import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

// Real PlatformAdminGuard; only its session + user lookups are mocked.
const mockGetSession = jest.fn();
const mockUserFindUnique = jest.fn();
jest.mock('../auth/auth.server', () => ({
  auth: { api: { getSession: (...a: unknown[]) => mockGetSession(...a) } },
}));
jest.mock('@db', () => ({
  db: { user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) } },
  AuditLogEntityType: { organization: 'organization', people: 'people' },
}));
jest.mock('../roles/msp-tech-role', () => ({ MSP_TECH_ROLE: 'msp_tech' }));
// Audit logging is covered by its own specs; pass through here.
jest.mock('./admin-audit-log.interceptor', () => ({
  AdminAuditLogInterceptor: class {
    intercept(_ctx: unknown, next: { handle: () => unknown }) {
      return next.handle();
    }
  },
}));

import { AdminAuditLogInterceptor } from './admin-audit-log.interceptor';
import { AdminMspStaffController } from './admin-msp-staff.controller';
import { AdminMspStaffService } from './admin-msp-staff.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

describe('MSP staff admin endpoints (HTTP)', () => {
  let app: INestApplication;
  const mspService = {
    listStaff: jest.fn().mockResolvedValue({ data: [], count: 0 }),
    addStaff: jest.fn().mockResolvedValue({ data: [], count: 0 }),
    removeStaff: jest.fn().mockResolvedValue({ success: true }),
  };
  const usersService = {
    setGlobalRole: jest.fn().mockResolvedValue({ id: 'u1', role: 'msp_staff' }),
    listMspStaffUsers: jest.fn().mockResolvedValue({ data: [], count: 0 }),
  };

  const asRole = (role: string | null) => {
    mockGetSession.mockResolvedValue({ user: { id: 'usr_caller' } });
    mockUserFindUnique.mockResolvedValue({ id: 'usr_caller', email: 'c@x.com', role, twoFactorEnabled: true });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminMspStaffController, AdminUsersController],
      providers: [
        { provide: AdminMspStaffService, useValue: mspService },
        { provide: AdminUsersService, useValue: usersService },
      ],
    })
      .overrideInterceptor(AdminAuditLogInterceptor)
      .useValue({ intercept: (_ctx: unknown, next: { handle: () => unknown }) => next.handle() })
      .compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('lets a platform admin add staff with the default msp_tech role', async () => {
    asRole('admin');
    await request(app.getHttpServer())
      .post('/v1/admin/organizations/org_1/msp-staff')
      .set('Cookie', 'session=abc')
      .send({ userIds: ['u1', 'u2'] })
      .expect(201);
    expect(mspService.addStaff).toHaveBeenCalledWith({
      orgId: 'org_1',
      userIds: ['u1', 'u2'],
      orgRole: 'msp_tech',
    });
  });

  it.each(['msp_staff', 'user', null])('blocks global role %s with 403', async (role) => {
    asRole(role);
    await request(app.getHttpServer())
      .post('/v1/admin/organizations/org_1/msp-staff')
      .set('Cookie', 'session=abc')
      .send({ userIds: ['u1'] })
      .expect(403);
    await request(app.getHttpServer())
      .patch('/v1/admin/users/u1/role')
      .set('Cookie', 'session=abc')
      .send({ role: 'msp_staff' })
      .expect(403);
    expect(mspService.addStaff).not.toHaveBeenCalled();
    expect(usersService.setGlobalRole).not.toHaveBeenCalled();
  });

  it('401s without a session', async () => {
    await request(app.getHttpServer())
      .get('/v1/admin/organizations/org_1/msp-staff')
      .expect(401);
  });

  it('validates the add body', async () => {
    asRole('admin');
    const server = app.getHttpServer();
    const post = (body: unknown) =>
      request(server)
        .post('/v1/admin/organizations/org_1/msp-staff')
        .set('Cookie', 'session=abc')
        .send(body as object);

    await post({ userIds: [] }).expect(400);
    await post({ userIds: Array.from({ length: 51 }, (_, i) => `u${i}`) }).expect(400);
    await post({ userIds: ['u1', 'u1'] }).expect(400);
    await post({ userIds: ['u1'], orgRole: 'bad role!' }).expect(400);
    await post({ userIds: ['u1'], extra: true }).expect(400);
    expect(mspService.addStaff).not.toHaveBeenCalled();
  });

  it('lists and removes staff for admins', async () => {
    asRole('admin');
    const server = app.getHttpServer();
    await request(server)
      .get('/v1/admin/organizations/org_1/msp-staff')
      .set('Cookie', 'session=abc')
      .expect(200);
    await request(server)
      .delete('/v1/admin/organizations/org_1/msp-staff/u1')
      .set('Cookie', 'session=abc')
      .expect(200);
    expect(mspService.listStaff).toHaveBeenCalledWith('org_1');
    expect(mspService.removeStaff).toHaveBeenCalledWith({ orgId: 'org_1', userId: 'u1' });
  });

  it("never accepts 'admin' in PATCH /admin/users/:userId/role", async () => {
    asRole('admin');
    await request(app.getHttpServer())
      .patch('/v1/admin/users/u1/role')
      .set('Cookie', 'session=abc')
      .send({ role: 'admin' })
      .expect(400);
    expect(usersService.setGlobalRole).not.toHaveBeenCalled();
  });

  it('sets msp_staff via PATCH /admin/users/:userId/role', async () => {
    asRole('admin');
    await request(app.getHttpServer())
      .patch('/v1/admin/users/u1/role')
      .set('Cookie', 'session=abc')
      .send({ role: 'msp_staff' })
      .expect(200);
    expect(usersService.setGlobalRole).toHaveBeenCalledWith({
      userId: 'u1',
      role: 'msp_staff',
      adminUserId: 'usr_caller',
    });
  });
});
