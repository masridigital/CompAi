import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { FrameworksModule } from '../../frameworks/frameworks.module';
import { OrganizationProvisioningService } from '../../organization/provisioning/organization-provisioning.service';
import { IntegrationPlatformModule } from '../integration-platform.module';
import { ProviderRepository } from '../repositories/provider.repository';
import { HaloAdminController } from './halopsa-admin.controller';
import { HaloAlertService } from './halopsa-alert.service';
import { HaloDigestService } from './halopsa-digest.service';
import { HaloMappingService } from './halopsa-mapping.service';
import { HaloOutboxService } from './halopsa-outbox.service';
import { HaloReconcileService } from './halopsa-reconcile.service';
import { HaloWebhookController } from './halopsa-webhook.controller';
import { HaloWebhookService } from './halopsa-webhook.service';

/** HaloPSA alerting, webhook and client mapping (plan sections 5 and 6). */
@Module({
  imports: [AuthModule, IntegrationPlatformModule, FrameworksModule],
  controllers: [HaloWebhookController, HaloAdminController],
  providers: [
    HaloAlertService,
    HaloOutboxService,
    HaloWebhookService,
    HaloMappingService,
    HaloDigestService,
    HaloReconcileService,
    OrganizationProvisioningService,
    ProviderRepository,
  ],
  exports: [HaloAlertService],
})
export class HaloPsaModule {}
