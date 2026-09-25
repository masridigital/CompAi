import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { db, Prisma } from '@db';
import { createHaloClient, isHaloConfigured, ticketClosedAt } from '@trycompai/integration-platform';
import { asRecord } from './halopsa-connection';
import { handleHaloTicketClosed } from './halopsa-closed-handler';
import { getHaloKv } from './halopsa-kv';
import { parseHaloWebhookBody } from './halopsa-webhook-payload';
import {
  apiBaseUrl,
  HALO_WEBHOOK_REPLAY_TTL_SECONDS,
  HALO_WEBHOOK_TOKEN_HASH_KEY,
  HALOPSA_PROVIDER_SLUG,
} from './halopsa.constants';

export type WebhookOutcome =
  | 'duplicate'
  | 'ignored_no_ticket_id'
  | 'unknown_ticket'
  | 'not_closed'
  | 'already_closed'
  | 'closed'
  | 'closed_no_comment';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time bearer check. Both sides are hashed first so lengths always match. */
export function bearerMatches({
  header,
  secret,
}: {
  header: string | undefined;
  secret: string;
}): boolean {
  const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? '');
  if (!match) return false;
  const provided = createHash('sha256').update(match[1].trim()).digest();
  const expected = createHash('sha256').update(secret).digest();
  return timingSafeEqual(provided, expected);
}

@Injectable()
export class HaloWebhookService {
  private readonly logger = new Logger(HaloWebhookService.name);

  verifyBearer(header: string | undefined): void {
    const secret = process.env.HALOPSA_WEBHOOK_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException('HaloPSA webhooks are not configured');
    }
    if (!bearerMatches({ header, secret })) {
      throw new UnauthorizedException('Invalid webhook credentials');
    }
  }

  async findConnectionByToken(token: string) {
    if (!TOKEN_PATTERN.test(token)) throw new NotFoundException();
    const connection = await db.integrationConnection.findFirst({
      where: {
        status: 'active',
        provider: { slug: HALOPSA_PROVIDER_SLUG },
        metadata: { path: [HALO_WEBHOOK_TOKEN_HASH_KEY], equals: sha256Hex(token) },
      },
      select: { id: true, organizationId: true },
    });
    if (!connection) throw new NotFoundException();
    return connection;
  }

  /** false when this exact body was already processed in the last 24 h. */
  async rememberBody(body: unknown): Promise<boolean> {
    const kv = getHaloKv();
    if (!kv) {
      this.logger.warn('Upstash KV not configured: HaloPSA webhook replay protection skipped');
      return true;
    }
    const key = `halopsa:webhook:${sha256Hex(JSON.stringify(body ?? null))}`;
    try {
      const result = await kv.set(key, 1, { nx: true, ex: HALO_WEBHOOK_REPLAY_TTL_SECONDS });
      return result !== null;
    } catch (error) {
      this.logger.warn(`KV unavailable, replay protection skipped: ${String(error)}`);
      return true;
    }
  }

  async handle({
    token,
    authorization,
    body,
  }: {
    token: string;
    authorization: string | undefined;
    body: unknown;
  }): Promise<WebhookOutcome> {
    this.verifyBearer(authorization);
    const connection = await this.findConnectionByToken(token);
    if (!(await this.rememberBody(body))) return 'duplicate';

    const parsed = parseHaloWebhookBody(body);
    if (parsed.ticketId === null) return 'ignored_no_ticket_id';

    const link = await db.haloTicketLink.findFirst({
      where: { organizationId: connection.organizationId, haloTicketId: parsed.ticketId },
    });
    if (!link) return 'unknown_ticket';

    let { closed, resolution } = parsed;
    if (closed === null && isHaloConfigured()) {
      // Payload did not say: ask Halo.
      const ticket = await createHaloClient().getTicket(parsed.ticketId);
      closed = ticket.hasbeenclosed === true || ticketClosedAt(ticket) !== null;
      resolution = resolution ?? ticket.closure_note ?? ticket.resolution ?? null;
    }
    if (!closed) return 'not_closed';

    return handleHaloTicketClosed({
      link,
      ticketId: parsed.ticketId,
      resolution,
      agentName: parsed.agentName,
    });
  }

  /** Issue a new webhook token for a halopsa connection. The plain token is returned once. */
  async issueToken({ connectionId, organizationId }: { connectionId: string; organizationId: string }) {
    const connection = await db.integrationConnection.findFirst({
      where: { id: connectionId, organizationId, provider: { slug: HALOPSA_PROVIDER_SLUG } },
      select: { id: true, metadata: true },
    });
    if (!connection) throw new NotFoundException(`HaloPSA connection ${connectionId} not found`);

    const token = randomBytes(32).toString('base64url');
    const metadata: Prisma.InputJsonObject = {
      ...(asRecord(connection.metadata) as Prisma.InputJsonObject),
      [HALO_WEBHOOK_TOKEN_HASH_KEY]: sha256Hex(token),
      halopsaWebhookTokenIssuedAt: new Date().toISOString(),
    };
    await db.integrationConnection.update({ where: { id: connection.id }, data: { metadata } });

    return {
      token,
      url: `${apiBaseUrl()}/v1/integrations/halopsa/webhooks/${token}`,
    };
  }
}
