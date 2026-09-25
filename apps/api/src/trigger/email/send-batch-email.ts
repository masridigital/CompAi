import { logger, queue, schemaTask } from '@trigger.dev/sdk';
import { z } from 'zod';
import {
  deliverEmail,
  getEmailTransport,
  resolveFromAddress,
  resolveReplyTo,
  resolveTestRecipient,
} from '@trycompai/email';
import { buildListUnsubscribeHeaders } from './list-unsubscribe';

/** Neither Cloudflare nor our Resend wrapper batch; we fan out single sends. */
export const BATCH_SEND_CONCURRENCY = 10;

const batchEmailQueue = queue({
  name: 'send-batch-email',
  concurrencyLimit: 5,
});

const batchEmailItemSchema = z.object({
  to: z.string(),
  subject: z.string(),
  html: z.string(),
  from: z.string().optional(),
  cc: z.union([z.string(), z.array(z.string())]).optional(),
});

async function runWithConcurrency<T>(params: {
  items: T[];
  limit: number;
  worker: (item: T, index: number) => Promise<void>;
}): Promise<void> {
  let next = 0;
  const runners = Array.from(
    { length: Math.min(params.limit, params.items.length) },
    async () => {
      while (next < params.items.length) {
        const index = next++;
        await params.worker(params.items[index], index);
      }
    },
  );
  await Promise.all(runners);
}

export const sendBatchEmailTask = schemaTask({
  id: 'send-batch-email',
  queue: batchEmailQueue,
  retry: {
    maxAttempts: 3,
  },
  schema: z.object({
    emails: z.array(batchEmailItemSchema).min(1),
  }),
  run: async (params) => {
    const transport = getEmailTransport();
    const fromDefault =
      resolveFromAddress({ channel: 'system' }) ??
      resolveFromAddress({ channel: 'default' });

    if (!fromDefault) {
      throw new Error('Missing FROM address in environment variables');
    }

    const toTest = resolveTestRecipient();
    const replyTo = resolveReplyTo({});

    let totalSent = 0;
    let totalFailed = 0;

    await runWithConcurrency({
      items: params.emails,
      limit: BATCH_SEND_CONCURRENCY,
      worker: async (email, index) => {
        try {
          await deliverEmail({
            transport,
            message: {
              from: email.from ?? fromDefault,
              to: toTest ?? email.to,
              cc: email.cc,
              replyTo,
              subject: email.subject,
              html: email.html,
              headers: buildListUnsubscribeHeaders(email.to),
            },
          });
          totalSent += 1;
        } catch (error) {
          totalFailed += 1;
          logger.warn('Batch email failed for recipient', {
            index,
            to: email.to,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    });

    logger.info('Batch email task complete', {
      provider: transport.provider,
      totalSent,
      totalFailed,
    });
    return { totalSent, totalFailed };
  },
});
