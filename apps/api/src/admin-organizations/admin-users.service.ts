import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { db } from '@db';
import { SETTABLE_GLOBAL_ROLES, type SettableGlobalRole } from './dto/msp-staff.dto';
import { MSP_ASSIGNABLE_USER_ROLES } from './msp-staff-plan';

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  /**
   * Users assignable as MSP staff (global role msp_staff or admin), optionally
   * filtered by name/email. Capped at 50 rows.
   */
  async listMspStaffUsers({ search }: { search?: string }) {
    const term = search?.trim();
    const data = await db.user.findMany({
      where: {
        role: { in: [...MSP_ASSIGNABLE_USER_ROLES] },
        ...(term
          ? {
              OR: [
                { email: { contains: term, mode: 'insensitive' } },
                { name: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: { id: true, email: true, name: true, role: true },
      orderBy: { email: 'asc' },
      take: 50,
    });
    return { data, count: data.length };
  }

  /**
   * Set a user's global role to 'user' or 'msp_staff'. Never grants or removes
   * platform admin: 'admin' is rejected as a target, and users who are
   * currently 'admin' cannot be changed through this endpoint.
   */
  async setGlobalRole({
    userId,
    role,
    adminUserId,
  }: {
    userId: string;
    role: SettableGlobalRole;
    adminUserId: string;
  }) {
    if (!SETTABLE_GLOBAL_ROLES.includes(role)) {
      throw new BadRequestException(
        `role must be one of: ${SETTABLE_GLOBAL_ROLES.join(', ')}`,
      );
    }
    if (userId === adminUserId) {
      throw new BadRequestException('You cannot change your own role');
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    if (user.role === 'admin') {
      throw new BadRequestException(
        'Platform admin roles cannot be changed with this endpoint',
      );
    }

    const updated = await db.user.update({
      where: { id: userId },
      data: { role },
      select: { id: true, email: true, name: true, role: true },
    });
    // No org in scope, so AdminAuditLogInterceptor skips this route; log it.
    this.logger.log(
      `Admin ${adminUserId} changed global role of ${userId}: ${user.role ?? 'null'} -> ${role}`,
    );
    return updated;
  }
}
