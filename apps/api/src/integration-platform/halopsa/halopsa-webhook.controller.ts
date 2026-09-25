import { Controller, Headers, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { OrganizationId } from '../../auth/auth-context.decorator';
import { HybridAuthGuard } from '../../auth/hybrid-auth.guard';
import { PermissionGuard } from '../../auth/permission.guard';
import { Public } from '../../auth/public.decorator';
import { RequirePermission } from '../../auth/require-permission.decorator';
import { HaloWebhookService } from './halopsa-webhook.service';

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

  @Post('connections/:id/webhook-token')
  @UseGuards(HybridAuthGuard, PermissionGuard)
  @RequirePermission('integration', 'update')
  @ApiSecurity('apikey')
  @ApiOperation({
    summary: 'Issue a HaloPSA webhook token',
    description:
      'Generates a new webhook token for this HaloPSA connection and returns the plain token and full webhook URL once. Any previous token stops working.',
  })
  async issueWebhookToken(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.webhookService.issueToken({ connectionId: id, organizationId });
  }
}
