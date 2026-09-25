import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { db } from '@db';
import { assertStaffMfa, requestPath } from '../auth/mfa-policy';
import { parseMspRole, type MspRequest } from './msp-scope';

/**
 * Runs after HybridAuthGuard. Allows only real user sessions (no API keys,
 * service tokens or MCP OAuth tokens) whose global User.role is `admin` or
 * `msp_staff`, re-reads the role from the database, and re-applies the staff
 * MFA rule (HybridAuthGuard already enforces it; this is defence in depth).
 */
@Injectable()
export class MspStaffGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<MspRequest>();

    if (
      request.authType !== 'session' ||
      request.isApiKey ||
      request.isServiceToken ||
      request.isMcpOAuth ||
      !request.userId
    ) {
      throw new ForbiddenException('The MSP overview requires a staff session');
    }

    const user = await db.user.findUnique({
      where: { id: request.userId },
      select: { role: true, twoFactorEnabled: true },
    });
    const role = parseMspRole(user?.role);
    if (!user || !role) {
      throw new ForbiddenException(
        'Access denied: MSP staff or platform admin role required',
      );
    }

    assertStaffMfa({
      role: user.role,
      twoFactorEnabled: user.twoFactorEnabled,
      path: requestPath(request),
    });

    request.mspRole = role;
    return true;
  }
}
