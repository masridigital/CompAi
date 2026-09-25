import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBody,
  ApiExcludeController,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { MSP_TECH_ROLE } from '../roles/msp-tech-role';
import { AdminAuditLogInterceptor } from './admin-audit-log.interceptor';
import { AdminMspStaffService } from './admin-msp-staff.service';
import { AssignMspStaffDto } from './dto/msp-staff.dto';

@ApiExcludeController()
@ApiTags('Admin - MSP Staff')
@Controller({ path: 'admin/organizations', version: '1' })
@UseGuards(PlatformAdminGuard)
@UseInterceptors(AdminAuditLogInterceptor)
@Throttle({ default: { ttl: 60000, limit: 30 } })
export class AdminMspStaffController {
  constructor(private readonly service: AdminMspStaffService) {}

  @Get(':id/msp-staff')
  @ApiOperation({
    summary: 'List MSP staff in an organization (platform admin)',
    description:
      'Returns active members of the organization whose global role is msp_staff or admin.',
  })
  async list(@Param('id') id: string) {
    return this.service.listStaff(id);
  }

  @Post(':id/msp-staff')
  @ApiOperation({
    summary: 'Add or reactivate MSP staff in an organization (platform admin)',
    description:
      'Adds up to 50 users with global role msp_staff or admin as members (default org role msp_tech). No invite email is sent.',
  })
  @ApiBody({ type: AssignMspStaffDto })
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  async add(@Param('id') id: string, @Body() body: AssignMspStaffDto) {
    return this.service.addStaff({
      orgId: id,
      userIds: body.userIds,
      orgRole: body.orgRole ?? MSP_TECH_ROLE,
    });
  }

  @Delete(':id/msp-staff/:userId')
  @ApiOperation({
    summary: 'Deactivate an MSP staff membership (platform admin)',
    description: 'Deactivates the MSP staff member row for this user in the organization.',
  })
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async remove(@Param('id') id: string, @Param('userId') userId: string) {
    return this.service.removeStaff({ orgId: id, userId });
  }
}
