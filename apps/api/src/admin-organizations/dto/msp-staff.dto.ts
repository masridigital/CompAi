import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export const MAX_MSP_STAFF_PER_REQUEST = 50;

export class AssignMspStaffDto {
  @ApiProperty({
    description: 'User IDs to add (global role msp_staff or admin)',
    type: 'array',
    items: { type: 'string' },
    example: ['usr_abc123'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_MSP_STAFF_PER_REQUEST)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  userIds!: string[];

  @ApiPropertyOptional({
    description: 'Org role for the members (default msp_tech)',
    example: 'msp_tech',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'orgRole may only contain letters, numbers, _ and -',
  })
  orgRole?: string;
}

export const SETTABLE_GLOBAL_ROLES = ['user', 'msp_staff'] as const;
export type SettableGlobalRole = (typeof SETTABLE_GLOBAL_ROLES)[number];

export class UpdateUserGlobalRoleDto {
  @ApiProperty({
    description: "Global user role. 'admin' cannot be set here.",
    enum: SETTABLE_GLOBAL_ROLES,
    example: 'msp_staff',
  })
  @IsString()
  @IsIn([...SETTABLE_GLOBAL_ROLES], {
    message: `role must be one of: ${SETTABLE_GLOBAL_ROLES.join(', ')}`,
  })
  role!: SettableGlobalRole;
}
