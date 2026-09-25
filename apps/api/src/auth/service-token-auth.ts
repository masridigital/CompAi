import { Logger, UnauthorizedException } from '@nestjs/common';
import { db } from '@db';
import {
  ORG_SIGNATURE_HEADER,
  ORG_TIMESTAMP_HEADER,
  verifyOrgClaim,
} from '@trycompai/utils/service-token';
import {
  isOrgSignatureRequired,
  resolveServiceByToken,
  type ServiceDefinition,
} from './service-token.config';
import { AuthenticatedRequest } from './types';

const logger = new Logger('ServiceTokenAuth');

function headerValue(
  request: AuthenticatedRequest,
  name: string,
): string | undefined {
  const value = request.headers[name];
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * Enforce the HMAC-signed org claim (S1). A present signature is always
 * verified; a missing one is rejected only when
 * SERVICE_TOKEN_REQUIRE_ORG_SIGNATURE=true.
 */
export function assertOrgClaim({
  request,
  definition,
  organizationId,
}: {
  request: AuthenticatedRequest;
  definition: ServiceDefinition;
  organizationId: string;
}): void {
  const signature = headerValue(request, ORG_SIGNATURE_HEADER);
  const timestamp = headerValue(request, ORG_TIMESTAMP_HEADER);
  const hasClaim = Boolean(signature || timestamp);

  if (!hasClaim) {
    if (isOrgSignatureRequired()) {
      throw new UnauthorizedException(
        'Signed organization claim (x-org-signature, x-org-timestamp) is required for service token auth',
      );
    }
    logger.warn(
      `Service "${definition.name}" called without a signed org claim (org ${organizationId})`,
    );
    return;
  }

  const secret = process.env[definition.signingSecretEnvVar];
  if (!secret) {
    logger.error(
      `${definition.signingSecretEnvVar} is not set; cannot verify org claim for "${definition.name}"`,
    );
    throw new UnauthorizedException(
      'Signed organization claim cannot be verified',
    );
  }

  const result = verifyOrgClaim({
    organizationId,
    timestamp,
    signature,
    secret,
  });
  if (!result.ok) {
    throw new UnauthorizedException(
      `Invalid signed organization claim (${result.reason})`,
    );
  }
}

/**
 * Service-token authentication path for HybridAuthGuard. Populates the request
 * context on success and throws UnauthorizedException otherwise.
 */
export async function authenticateServiceToken({
  request,
  token,
}: {
  request: AuthenticatedRequest;
  token: string;
}): Promise<true> {
  const service = resolveServiceByToken(token);
  if (!service) {
    throw new UnauthorizedException('Invalid service token');
  }

  const organizationId = headerValue(request, 'x-organization-id');
  if (!organizationId) {
    throw new UnauthorizedException(
      'x-organization-id header is required for service token auth',
    );
  }

  assertOrgClaim({ request, definition: service.definition, organizationId });

  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!org) {
    throw new UnauthorizedException(
      'Organization not found for the provided x-organization-id',
    );
  }

  request.organizationId = organizationId;
  request.authType = 'service';
  request.isApiKey = false;
  request.isServiceToken = true;
  request.serviceName = service.definition.name;
  request.isPlatformAdmin = false;
  request.userRoles = null;

  // Service tokens can pass x-user-id to act on behalf of a user.
  // Validate that the user exists and belongs to the organization.
  const actingUserId = headerValue(request, 'x-user-id');
  if (actingUserId) {
    const member = await db.member.findFirst({
      // Only active memberships may act — an offboarded/deactivated user must
      // not receive new audit / enteredById attribution. Mirrors the filters
      // ActingUserResolver applies to its creator/owner lookups.
      where: {
        userId: actingUserId,
        organizationId,
        deactivated: false,
        isActive: true,
      },
      select: { id: true, userId: true },
    });
    if (member) {
      request.userId = actingUserId;
      // Set the acting membership too, so Member-FK sinks (audit rows,
      // enteredById, etc.) can attribute to the acting member.
      request.memberId = member.id;
    } else {
      logger.warn(
        `Service token x-user-id "${actingUserId}" is not an active member of org ${organizationId}`,
      );
    }
  }

  logger.log(
    `Service "${service.definition.name}" authenticated for org ${organizationId}`,
  );
  return true;
}
