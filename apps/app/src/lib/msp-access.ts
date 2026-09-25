/**
 * Whether a global User.role may open the MSP master pane (`/msp`).
 *
 * Mirrors the API's MspStaffGuard: `admin` must be the exact value (same rule
 * as platform admin everywhere else); `msp_staff` may appear in a
 * comma-separated list. The API enforces this independently — this only
 * decides what the app shows.
 */
export function isMspStaffRole(role: string | null | undefined): boolean {
  if (!role) return false;
  if (role === 'admin') return true;
  return role
    .split(',')
    .map((r) => r.trim())
    .includes('msp_staff');
}

export const MSP_PANE_PATH = '/msp';
