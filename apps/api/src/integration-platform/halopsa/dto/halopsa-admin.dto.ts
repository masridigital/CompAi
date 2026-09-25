import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

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
}
