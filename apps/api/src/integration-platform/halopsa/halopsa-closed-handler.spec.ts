const mockDb = {
  haloTicketLink: { updateMany: jest.fn() },
  task: { findFirst: jest.fn() },
  member: { findFirst: jest.fn() },
  comment: { create: jest.fn() },
};

jest.mock('@db', () => ({ db: mockDb }));

import { buildClosedComment, handleHaloTicketClosed } from './halopsa-closed-handler';

const NOW = new Date('2026-09-25T12:00:00.000Z');
const link = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'htl_1',
    organizationId: 'org_1',
    connectionId: 'icn_1',
    entityType: 'check',
    entityId: 'tsk_1',
    dedupKey: 'integration_check_failed:mfa',
    refToken: 'CAI-AAAAAAAA',
    haloTicketId: 12,
    state: 'open',
    resolvedAt: null,
    lastEventAt: NOW,
    createdAt: NOW,
    ...overrides,
  }) as never;

describe('handleHaloTicketClosed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.haloTicketLink.updateMany.mockResolvedValue({ count: 1 });
    mockDb.task.findFirst.mockResolvedValue({ assignee: { id: 'mem_assignee', deactivated: false } });
    mockDb.member.findFirst.mockResolvedValue({ id: 'mem_owner' });
  });

  it('marks the link closed_externally and comments on the task as the assignee', async () => {
    await expect(
      handleHaloTicketClosed({ link: link(), ticketId: 12, resolution: 'Patched', agentName: 'Sam', now: NOW }),
    ).resolves.toBe('closed');
    expect(mockDb.haloTicketLink.updateMany).toHaveBeenCalledWith({
      where: { id: 'htl_1', state: { not: 'closed_externally' } },
      data: { state: 'closed_externally', resolvedAt: NOW, lastEventAt: NOW },
    });
    expect(mockDb.comment.create).toHaveBeenCalledWith({
      data: {
        content: '[HaloPSA] Halo ticket #12 closed by Sam: Patched',
        entityId: 'tsk_1',
        entityType: 'task',
        organizationId: 'org_1',
        authorId: 'mem_assignee',
      },
    });
  });

  it('never marks the task done (only reads it)', async () => {
    const taskUpdate = jest.fn();
    Object.assign(mockDb.task, { update: taskUpdate, updateMany: taskUpdate });
    await expect(handleHaloTicketClosed({ link: link(), ticketId: 12, now: NOW })).resolves.toBe('closed');
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  it('falls back to an owner when the task has no assignee', async () => {
    mockDb.task.findFirst.mockResolvedValue({ assignee: null });
    await handleHaloTicketClosed({ link: link(), ticketId: 12, now: NOW });
    expect(mockDb.comment.create.mock.calls[0][0].data.authorId).toBe('mem_owner');
  });

  it('comments on findings', async () => {
    await handleHaloTicketClosed({ link: link({ entityType: 'finding', entityId: 'fnd_1' }), ticketId: 12, now: NOW });
    expect(mockDb.comment.create.mock.calls[0][0].data).toMatchObject({ entityType: 'finding', entityId: 'fnd_1' });
  });

  it('is idempotent', async () => {
    mockDb.haloTicketLink.updateMany.mockResolvedValue({ count: 0 });
    await expect(handleHaloTicketClosed({ link: link(), ticketId: 12, now: NOW })).resolves.toBe('already_closed');
    expect(mockDb.comment.create).not.toHaveBeenCalled();
  });

  it('does not comment for devices', async () => {
    await expect(
      handleHaloTicketClosed({ link: link({ entityType: 'device', entityId: 'dev_1' }), ticketId: 12, now: NOW }),
    ).resolves.toBe('closed_no_comment');
    expect(mockDb.comment.create).not.toHaveBeenCalled();
  });
});

describe('buildClosedComment', () => {
  it('strips HTML, redacts and defaults the resolution', () => {
    expect(buildClosedComment({ ticketId: 3, resolution: '<p>Rotated token=abcdef</p>' })).toBe(
      '[HaloPSA] Halo ticket #3 closed: Rotated token=[redacted]',
    );
    expect(buildClosedComment({ ticketId: 3 })).toBe('[HaloPSA] Halo ticket #3 closed: no resolution note');
  });
});
