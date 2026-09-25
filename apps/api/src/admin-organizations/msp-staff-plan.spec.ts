import {
  isMspAssignableUserRole,
  mergeRole,
  planMembershipChanges,
} from './msp-staff-plan';

describe('msp-staff-plan', () => {
  describe('isMspAssignableUserRole', () => {
    it('accepts msp_staff and admin only', () => {
      expect(isMspAssignableUserRole('msp_staff')).toBe(true);
      expect(isMspAssignableUserRole('admin')).toBe(true);
      expect(isMspAssignableUserRole('user')).toBe(false);
      expect(isMspAssignableUserRole(null)).toBe(false);
      expect(isMspAssignableUserRole(undefined)).toBe(false);
    });
  });

  describe('mergeRole', () => {
    it('adds the org role once', () => {
      expect(mergeRole({ existing: 'employee', orgRole: 'msp_tech' })).toBe(
        'employee,msp_tech',
      );
      expect(mergeRole({ existing: ' msp_tech , auditor', orgRole: 'msp_tech' })).toBe(
        'msp_tech,auditor',
      );
    });
  });

  describe('planMembershipChanges', () => {
    it('creates, reactivates, adds roles and leaves members unchanged', () => {
      const plan = planMembershipChanges({
        userIds: ['u_new', 'u_deact', 'u_inactive', 'u_emp', 'u_same', 'u_new'],
        orgRole: 'msp_tech',
        existing: [
          { userId: 'u_deact', role: 'owner', deactivated: true, isActive: false },
          { userId: 'u_inactive', role: 'employee', deactivated: false, isActive: false },
          { userId: 'u_emp', role: 'employee', deactivated: false, isActive: true },
          { userId: 'u_same', role: 'msp_tech', deactivated: false, isActive: true },
        ],
      });

      expect(plan).toEqual([
        { userId: 'u_new', action: 'create', role: 'msp_tech' },
        // old roles (even owner) are dropped on reactivation
        { userId: 'u_deact', action: 'reactivate', role: 'msp_tech' },
        { userId: 'u_inactive', action: 'reactivate', role: 'msp_tech' },
        { userId: 'u_emp', action: 'add-role', role: 'employee,msp_tech' },
        { userId: 'u_same', action: 'unchanged', role: 'msp_tech' },
      ]);
    });

    it('returns an empty plan for no users', () => {
      expect(planMembershipChanges({ userIds: [], orgRole: 'x', existing: [] })).toEqual([]);
    });
  });
});
