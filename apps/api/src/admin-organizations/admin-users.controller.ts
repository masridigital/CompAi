import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBody,
  ApiExcludeController,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AdminAuditLogInterceptor } from './admin-audit-log.interceptor';
import { AdminUsersService } from './admin-users.service';
import { UpdateUserGlobalRoleDto } from './dto/msp-staff.dto';

@ApiExcludeController()
@ApiTags('Admin - Users')
@Controller({ path: 'admin/users', version: '1' })
@UseGuards(PlatformAdminGuard)
@UseInterceptors(AdminAuditLogInterceptor)
@Throttle({ default: { ttl: 60000, limit: 30 } })
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get('msp-staff')
  @ApiOperation({
    summary: 'List users assignable as MSP staff (platform admin)',
    description: 'Returns up to 50 users whose global role is msp_staff or admin.',
  })
  @ApiQuery({ name: 'search', required: false })
  async listMspStaff(@Query('search') search?: string) {
    return this.service.listMspStaffUsers({ search });
  }

  @Patch(':userId/role')
  @ApiOperation({
    summary: "Set a user's global role to user or msp_staff (platform admin)",
    description: "Changes User.role between 'user' and 'msp_staff'. Cannot set or remove 'admin'.",
  })
  @ApiBody({ type: UpdateUserGlobalRoleDto })
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  async setRole(
    @Param('userId') userId: string,
    @Req() req: { userId: string },
    @Body() body: UpdateUserGlobalRoleDto,
  ) {
    return this.service.setGlobalRole({
      userId,
      role: body.role,
      adminUserId: req.userId,
    });
  }
}
