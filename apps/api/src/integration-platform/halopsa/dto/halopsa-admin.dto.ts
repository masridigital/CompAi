import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class BindHaloClientDto {
  @ApiProperty({ description: 'Organization to bind the Halo client to', example: 'org_abc123' })
  @IsString()
  @MinLength(1)
  organizationId!: string;

  @ApiPropertyOptional({ description: 'Halo site ID for tickets', example: 57 })
  @IsOptional()
  @IsInt()
  @IsPositive()
  haloSiteId?: number;
}

export class CreateOrgFromHaloClientDto {
  @ApiPropertyOptional({
    description: 'Framework editor framework IDs to initialize',
    type: 'array',
    items: { type: 'string' },
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  templateFrameworkIds?: string[];

  @ApiPropertyOptional({ description: 'Halo site ID for tickets', example: 57 })
  @IsOptional()
  @IsInt()
  @IsPositive()
  haloSiteId?: number;

  @ApiPropertyOptional({
    description:
      'Client contact to invite as the organization owner (normal invitation email). The acting platform admin is added as admin, not owner.',
    example: 'owner@client.com',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  ownerEmail?: string;
}
