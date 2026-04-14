import {
  IsString, IsNotEmpty, IsOptional, IsEnum, IsArray, ValidateNested,
  IsEmail, IsNumber, IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CircuitType, RecipientRole } from '../../common/enums';

export class RecipientDto {
  @ApiProperty({ example: 'jean.dupont@cgrae.ci' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Jean' })
  @IsString()
  @IsNotEmpty()
  first_name: string;

  @ApiProperty({ example: 'Dupont' })
  @IsString()
  @IsNotEmpty()
  last_name: string;

  @ApiProperty({ enum: RecipientRole, default: RecipientRole.SIGNATORY })
  @IsEnum(RecipientRole)
  role: RecipientRole;

  @ApiProperty({ example: 1, description: 'Ordre pour circuit séquentiel' })
  @IsNumber()
  signing_order: number;

  @ApiProperty({ required: false, description: 'Zone de signature prédéfinie (x_ratio, y_ratio entre 0 et 1, doc_id optionnel)' })
  @IsOptional()
  signature_zone?: { x_ratio: number; y_ratio: number; doc_id?: number };
}

export class CreateEnvelopeDto {
  @ApiProperty({ example: 'Contrat de travail - Jean Dupont' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  subject?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  message?: string;

  @ApiProperty({ enum: CircuitType, default: CircuitType.SEQUENTIAL })
  @IsEnum(CircuitType)
  circuit_type: CircuitType;

  @ApiProperty({ type: [Number], description: 'IDs des documents à joindre' })
  @IsArray()
  @IsNumber({}, { each: true })
  document_ids: number[];

  @ApiProperty({ type: [RecipientDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipientDto)
  recipients: RecipientDto[];

  @ApiProperty({ required: false, example: '2025-12-31' })
  @IsDateString()
  @IsOptional()
  expires_at?: string;
}

export class RejectEnvelopeDto {
  @ApiProperty({ example: 'Clauses contractuelles à revoir' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class ReturnCorrectionDto {
  @ApiProperty({ example: 'Les montants page 3 ne correspondent pas au budget approuvé.' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class DelegateDto {
  @ApiProperty({ example: 'marie.dupont@cgrae.ci' })
  @IsEmail()
  delegate_email: string;

  @ApiProperty({ example: 'Marie' })
  @IsString()
  @IsNotEmpty()
  delegate_first_name: string;

  @ApiProperty({ example: 'Dupont' })
  @IsString()
  @IsNotEmpty()
  delegate_last_name: string;
}

export class ForwardRecipientDto {
  @ApiProperty({ example: 'nouveau.destinataire@cgrae.ci' })
  @IsEmail()
  forward_email: string;

  @ApiProperty({ example: 'Nouveau' })
  @IsString()
  @IsNotEmpty()
  forward_first_name: string;

  @ApiProperty({ example: 'Destinataire' })
  @IsString()
  @IsNotEmpty()
  forward_last_name: string;
}
