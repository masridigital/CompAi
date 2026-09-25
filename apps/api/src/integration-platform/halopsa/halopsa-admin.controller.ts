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
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { HaloOutboxStatus } from '@db';
import { PlatformAdminGuard } from '../../auth/platform-admin.guard';
import { OrganizationProvisioningService } from '../../organization/provisioning/organization-provisioning.service';
import { PlatformAuditLogInterceptor } from '../interceptors/platform-audit-log.interceptor';
import { BindHaloClientDto, CreateOrgFromHaloClientDto } from './dto/halopsa-admin.dto';
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

@ApiExcludeController()
@Controller({ path: 'admin/halopsa', version: '1' })
@UseGuards(PlatformAdminGuard)
@UseInterceptors(PlatformAuditLogInterceptor)
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
  ) {
    return this.mappingService.bind({
      haloClientId,
      organizationId: body.organizationId,
      haloSiteId: body.haloSiteId,
    });
  }

  @Post('clients/:haloClientId/create-org')
  @ApiOperation({ summary: 'Create an organization from a Halo client and bind it' })
  async createOrg(
    @Param('haloClientId', ParseIntPipe) haloClientId: number,
    @Body() body: CreateOrgFromHaloClientDto,
    @Req() req: { userId: string },
  ) {
    const client = await this.mappingService.getHaloClient(haloClientId);
    const { organizationId } = await this.provisioningService.provision({
      name: client.name,
      website: client.website,
      ownerUserId: req.userId,
      frameworkIds: body.templateFrameworkIds,
    });
    return this.mappingService.bind({
      haloClientId,
      organizationId,
      haloSiteId: body.haloSiteId,
      haloClientName: client.name,
    });
  }

  @Post('connections/:id/webhook-token')
  @ApiOperation({ summary: 'Issue a webhook token for a HaloPSA connection' })
  async issueWebhookToken(@Param('id') id: string) {
    const connection = await this.mappingService.getConnection(id);
    return this.webhookService.issueToken({
      connectionId: connection.connectionId,
      organizationId: connection.organizationId,
    });
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
  async retryOutbox(@Param('id') id: string) {
    return this.outboxService.retry({ id });
  }
}
