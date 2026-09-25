import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { HaloOutboxStatus } from '@db';
import { PlatformAdminGuard } from '../../auth/platform-admin.guard';
import { OrganizationProvisioningService } from '../../organization/provisioning/organization-provisioning.service';
import { BindHaloClientDto, CreateOrgFromHaloClientDto } from './dto/halopsa-admin.dto';
import { writeHaloAdminAudit } from './halopsa-admin-audit';
import { HaloMappingService } from './halopsa-mapping.service';
import { HaloOutboxService } from './halopsa-outbox.service';
import { HaloWebhookService } from './halopsa-webhook.service';

const OUTBOX_STATUSES: HaloOutboxStatus[] = ['pending', 'processing', 'done', 'dead'];

function parseStatus(value: string | undefined): HaloOutboxStatus | undefined {
  if (!value) return undefined;
  const status = OUTBOX_STATUSES.find((s) => s === value);
  if (!status) throw new BadRequestException(`status must be one of ${OUTBOX_STATUSES.join(', ')}`);
  return status;
}

interface AdminRequest {
  userId: string;
}

/**
 * Platform-admin HaloPSA management. Mutations write explicit audit rows
 * under the affected organization (writeHaloAdminAudit) instead of the
 * generic PlatformAuditLogInterceptor, which labels them as credential saves.
 */
@ApiExcludeController()
@ApiTags('Admin - HaloPSA')
@Controller({ path: 'admin/halopsa', version: '1' })
@UseGuards(PlatformAdminGuard)
@Throttle({ default: { ttl: 60000, limit: 30 } })
export class HaloAdminController {
  constructor(
    private readonly mappingService: HaloMappingService,
    private readonly outboxService: HaloOutboxService,
    private readonly webhookService: HaloWebhookService,
    private readonly provisioningService: OrganizationProvisioningService,
  ) {}

  @Get('clients')
  @ApiOperation({ summary: 'List active Halo clients with mapping status and suggestions' })
  async listClients() {
    return this.mappingService.listClients();
  }

  @Get('connections')
  @ApiOperation({ summary: 'List HaloPSA connections across organizations' })
  async listConnections() {
    return { data: await this.mappingService.listConnections() };
  }

  @Post('clients/:haloClientId/bind')
  @ApiOperation({ summary: 'Bind a Halo client to an existing organization' })
  async bind(
    @Param('haloClientId', ParseIntPipe) haloClientId: number,
    @Body() body: BindHaloClientDto,
    @Req() req: AdminRequest,
  ) {
    const result = await this.mappingService.bind({
      haloClientId,
      organizationId: body.organizationId,
      haloSiteId: body.haloSiteId,
      actorUserId: req.userId,
    });
    await writeHaloAdminAudit({
      userId: req.userId,
      organizationId: result.organizationId,
      action: 'bind_client',
      entityId: result.connectionId,
      details: { haloClientId, haloSiteId: result.haloSiteId },
    });
    return result;
  }

  @Post('clients/:haloClientId/create-org')
  @ApiOperation({ summary: 'Create an organization from a Halo client and bind it' })
  async createOrg(
    @Param('haloClientId', ParseIntPipe) haloClientId: number,
    @Body() body: CreateOrgFromHaloClientDto,
    @Req() req: AdminRequest,
  ) {
    const client = await this.mappingService.getHaloClient(haloClientId);
    const { organizationId, ownerInvitationId } = await this.provisioningService.provision({
      name: client.name,
      website: client.website,
      actingAdminUserId: req.userId,
      ownerEmail: body.ownerEmail,
      frameworkIds: body.templateFrameworkIds,
    });
    await writeHaloAdminAudit({
      userId: req.userId,
      organizationId,
      action: 'create_org_from_client',
      entityId: organizationId,
      details: { haloClientId, ownerInvited: ownerInvitationId !== null },
    });
    const result = await this.mappingService.bind({
      haloClientId,
      organizationId,
      haloSiteId: body.haloSiteId,
      haloClientName: client.name,
      actorUserId: req.userId,
    });
    await writeHaloAdminAudit({
      userId: req.userId,
      organizationId,
      action: 'bind_client',
      entityId: result.connectionId,
      details: { haloClientId, haloSiteId: result.haloSiteId },
    });
    return { ...result, ownerInvitationId };
  }

  @Post('connections/:id/webhook-token')
  @ApiOperation({ summary: 'Issue a webhook token for a HaloPSA connection' })
  async issueWebhookToken(@Param('id') id: string, @Req() req: AdminRequest) {
    const connection = await this.mappingService.getConnection(id);
    const issued = await this.webhookService.issueToken({
      connectionId: connection.connectionId,
      organizationId: connection.organizationId,
    });
    await writeHaloAdminAudit({
      userId: req.userId,
      organizationId: connection.organizationId,
      action: 'issue_webhook_token',
      entityId: connection.connectionId,
    });
    return issued;
  }

  @Get('outbox')
  @ApiOperation({ summary: 'List HaloPSA outbox events' })
  async listOutbox(@Query('status') status?: string, @Query('limit') limit?: string) {
    const events = await this.outboxService.list({
      status: parseStatus(status),
      limit: limit ? Number(limit) || 100 : 100,
    });
    return { data: events, count: events.length };
  }

  @Post('outbox/:id/retry')
  @ApiOperation({ summary: 'Retry a dead HaloPSA outbox event' })
  async retryOutbox(@Param('id') id: string, @Req() req: AdminRequest) {
    const { organizationId, ...result } = await this.outboxService.retry({ id });
    await writeHaloAdminAudit({
      userId: req.userId,
      organizationId,
      action: 'retry_outbox_event',
      entityId: id,
    });
    return result;
  }
}
