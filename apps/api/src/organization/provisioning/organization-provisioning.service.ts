import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { db } from '@db';
import { FrameworksService } from '../../frameworks/frameworks.service';
import { inviteOrganizationOwner } from './organization-owner-invite';

export interface ProvisionOrganizationInput {
  name: string;
  website?: string | null;
  /**
   * The acting platform admin. Added as an `admin` member (not owner) so the
   * MSP can set the org up; ownership belongs to the client.
   */
  actingAdminUserId: string;
  /** Client contact invited as `owner` through the normal invitation flow. */
  ownerEmail?: string;
  frameworkIds?: string[];
}

export interface ProvisionOrganizationResult {
  organizationId: string;
  ownerInvitationId: string | null;
}

function normalizeWebsite(website: string | null | undefined): string | null {
  const raw = (website ?? '').trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}

/**
 * Minimal API-side organization creation for admin provisioning (e.g.
 * "Create org from Halo client"). Mirrors the core of the app's
 * createOrganizationMinimal + initializeOrganization: org + admin member for
 * the acting platform admin + onboarding record, then the framework structure via
 * FrameworksService.addFrameworks (the same upsert the app uses).
 * Onboarding questions are left for the owner (invited by email) to complete.
 */
@Injectable()
export class OrganizationProvisioningService {
  private readonly logger = new Logger(OrganizationProvisioningService.name);

  constructor(private readonly frameworksService: FrameworksService) {}

  async provision(input: ProvisionOrganizationInput): Promise<ProvisionOrganizationResult> {
    const name = input.name.trim();
    if (name.length < 2) throw new BadRequestException('Organization name must be at least 2 characters');
    const frameworkIds = [...new Set(input.frameworkIds ?? [])];

    const frameworkNames = frameworkIds.length
      ? (
          await db.frameworkEditorFramework.findMany({
            where: { id: { in: frameworkIds }, visible: true },
            select: { name: true },
          })
        ).map((f) => f.name)
      : [];

    const organization = await db.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name,
          website: normalizeWebsite(input.website),
          onboardingCompleted: false,
          hasAccess: true,
          members: { create: { userId: input.actingAdminUserId, role: 'admin' } },
          ...(frameworkIds.length
            ? {
                context: {
                  createMany: {
                    data: [
                      {
                        question: 'Which compliance frameworks do you need?',
                        answer: frameworkNames.join(', ') || frameworkIds.join(', '),
                        tags: ['onboarding'],
                      },
                      {
                        question: 'frameworkIds',
                        answer: JSON.stringify(frameworkIds),
                        tags: ['onboarding'],
                      },
                    ],
                  },
                },
              }
            : {}),
        },
        select: { id: true },
      });
      await tx.onboarding.create({ data: { organizationId: org.id, triggerJobCompleted: false } });
      return org;
    });

    if (frameworkIds.length > 0) {
      try {
        await this.frameworksService.addFrameworks(organization.id, frameworkIds);
      } catch (error) {
        // Keep the org: frameworks can be added later from the app.
        this.logger.warn(
          `Org ${organization.id} created but frameworks failed to initialize: ${String(error)}`,
        );
      }
    }

    const ownerEmail = input.ownerEmail?.trim();
    const invite = ownerEmail
      ? await inviteOrganizationOwner({
          organizationId: organization.id,
          organizationName: name,
          email: ownerEmail,
          inviterUserId: input.actingAdminUserId,
        })
      : null;

    this.logger.log(`Provisioned organization ${organization.id} (${name})`);
    return { organizationId: organization.id, ownerInvitationId: invite?.invitationId ?? null };
  }
}
