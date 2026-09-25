import { logger, queue, schemaTask, wait } from '@trigger.dev/sdk';
import { z } from 'zod';
import {
  deliverEmail,
  resolveFromAddress,
  resolveTestRecipient,
  resolveReplyTo,
} from '@trycompai/email';
import {
  buildListUnsubscribeHeaders,
  scheduledAtToDelay,
} from './list-unsubscribe';

const emailQueue = queue({
  name: 'send-email',
  concurrencyLimit: 10,
});

export const emailChannelSchema = z.enum([
  'marketing',
  'system',
  'trustPortal',
  'default',
]);
export type EmailChannel = z.infer<typeof emailChannelSchema>;

export const sendEmailTask = schemaTask({
  id: 'send-email',
  queue: emailQueue,
  retry: {
    maxAttempts: 3,
  },
  schema: z.object({
    to: z.string(),
    subject: z.string(),
    html: z.string(),
    channel: emailChannelSchema.optional(),
    from: z.string().optional(),
    cc: z.union([z.string(), z.array(z.string())]).optional(),
    /**
     * Future delivery time. Callers should also pass it as the Trigger.dev
     * `delay` option; the task waits until this time as a fallback.
     */
    scheduledAt: z.string().optional(),
    attachments: z
      .array(
        z.object({
          filename: z.string(),
          content: z.string(),
          contentType: z.string().optional(),
        }),
      )
      .optional(),
  }),
  run: async (params) => {
    const waitUntil = scheduledAtToDelay(params.scheduledAt);
    if (waitUntil) {
      logger.info('Waiting until scheduled send time', {
        scheduledAt: params.scheduledAt,
      });
      await wait.until({ date: waitUntil });
    }

    const fromAddress =
      params.from ??
      resolveFromAddress({ channel: params.channel }) ??
      resolveFromAddress({ channel: 'system' }) ??
      resolveFromAddress({ channel: 'default' });
    const toAddress = resolveTestRecipient() ?? params.to;

    if (!fromAddress) {
      throw new Error('Missing FROM address in environment variables');
    }

    const marketing = params.channel === 'marketing';

    try {
      const result = await deliverEmail({
        marketing,
        message: {
          from: fromAddress,
          to: toAddress,
          cc: params.cc,
          replyTo: resolveReplyTo({ marketing }),
          subject: params.subject,
          html: params.html,
          headers: buildListUnsubscribeHeaders(params.to),
          attachments: params.attachments,
        },
      });

      logger.info('Email sent', {
        to: params.to,
        id: result.id,
        provider: result.provider,
      });

      // Throttle: hold the concurrency slot for 1s to space out sends
      await new Promise((r) => setTimeout(r, 1000));

      return { id: result.id };
    } catch (error) {
      logger.error('Email sending failed', {
        to: params.to,
        subject: params.subject,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});
