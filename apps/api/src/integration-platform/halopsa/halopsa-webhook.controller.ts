import { Controller, Headers, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../auth/public.decorator';
import { HaloWebhookService } from './halopsa-webhook.service';

/**
 * Webhook tokens are issued only by platform admins
 * (POST /v1/admin/halopsa/connections/:id/webhook-token): the webhook is the
 * MSP's Halo integration, so a client org must not be able to rotate it.
 */
@Controller({ path: 'integrations/halopsa', version: '1' })
@ApiTags('Integrations')
export class HaloWebhookController {
  constructor(private readonly webhookService: HaloWebhookService) {}

  /**
   * HaloPSA Standard Webhook target. Auth: `Authorization: Bearer
   * <HALOPSA_WEBHOOK_SECRET>` plus the unguessable per-connection token in
   * the path. The body is read raw from `req.body` (shape not confirmed).
   */
  @Post('webhooks/:connectionToken')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @ApiExcludeEndpoint()
  async receive(
    @Param('connectionToken') connectionToken: string,
    @Headers('authorization') authorization: string | undefined,
    @Req() req: Request,
  ) {
    const outcome = await this.webhookService.handle({
      token: connectionToken,
      authorization,
      body: req.body as unknown,
    });
    return { received: true, outcome };
  }
}
