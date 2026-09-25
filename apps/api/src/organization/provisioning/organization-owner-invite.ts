import { Logger } from '@nestjs/common';
import { db } from '@db';
import { triggerEmail } from '../../email/trigger-email';
import { InviteEmail } from '../../email/templates/invite-member';

const logger = new Logger('OrganizationOwnerInvite');
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Invite the client's owner to a newly provisioned org through the normal
 * invitation flow (Invitation row + invite email + /invite/:id accept page),
 * the same one AdminOrganizationsService.inviteMember uses, with role owner.
 * The email is best effort: the invitation stays valid if sending fails.
 */
export async function inviteOrganizationOwner({
  organizationId,
  organizationName,
  email,
  inviterUserId,
}: {
  organizationId: string;
  organizationName: string;
  email: string;
  inviterUserId: string;
}): Promise<{ invitationId: string }> {
  const normalizedEmail = email.toLowerCase().trim();

  await db.invitation.updateMany({
    where: { email: normalizedEmail, organizationId, status: 'pending' },
    data: { status: 'canceled' },
  });
  const invitation = await db.invitation.create({
    data: {
      email: normalizedEmail,
      organizationId,
      role: 'owner',
      status: 'pending',
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      inviterId: inviterUserId,
    },
    select: { id: true },
  });

  try {
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? 'https://app.trycomp.ai';
    await triggerEmail({
      to: normalizedEmail,
      subject: `You've been invited to join ${organizationName} on Comp AI`,
      react: InviteEmail({
        organizationName,
        inviteLink: `${appUrl}/invite/${invitation.id}`,
        email: normalizedEmail,
      }),
    });
  } catch (error) {
    logger.error(
      `Failed to send owner invite for org ${organizationId}`,
      error instanceof Error ? error.message : 'Unknown error',
    );
  }

  return { invitationId: invitation.id };
}
