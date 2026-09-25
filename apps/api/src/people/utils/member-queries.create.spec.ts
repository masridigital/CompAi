const mockUpsert = jest.fn();
const mockCreate = jest.fn();
const mockTransaction = jest.fn();
jest.mock('@db', () => ({
  db: {
    member: {
      upsert: (...args: unknown[]) => mockUpsert(...args),
      create: (...args: unknown[]) => mockCreate(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

import { MemberQueries } from './member-queries';

describe('MemberQueries create paths (unique userId+organizationId)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpsert.mockImplementation((args: { where: unknown }) => ({
      upsertFor: args.where,
    }));
    mockTransaction.mockImplementation((ops: unknown[]) => Promise.resolve(ops));
  });

  it('createMember upserts on the compound key and reactivates on conflict', async () => {
    await MemberQueries.createMember('org_1', {
      userId: 'usr_1',
      role: 'employee',
    });

    expect(mockCreate).not.toHaveBeenCalled();
    const args = mockUpsert.mock.calls[0][0];
    expect(args.where).toEqual({
      userId_organizationId: { userId: 'usr_1', organizationId: 'org_1' },
    });
    expect(args.create).toMatchObject({
      organizationId: 'org_1',
      userId: 'usr_1',
      role: 'employee',
      department: 'none',
      isActive: true,
    });
    expect(args.update).toMatchObject({
      role: 'employee',
      isActive: true,
      deactivated: false,
      offboardDate: null,
    });
  });

  it('bulkCreateMembers upserts every member inside one transaction', async () => {
    const result = await MemberQueries.bulkCreateMembers('org_1', [
      { userId: 'usr_1', role: 'employee' },
      { userId: 'usr_2', role: 'admin', department: 'it' },
    ]);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(mockUpsert.mock.calls[1][0].create).toMatchObject({
      userId: 'usr_2',
      role: 'admin',
      department: 'it',
    });
    expect(result).toHaveLength(2);
  });
});
