import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'admin@cgrae.ci' })
  @IsEmail({}, { message: "L'email est invalide" })
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'Admin1234!' })
  @IsString()
  @MinLength(6)
  @IsNotEmpty()
  password: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'jean.dupont@cgrae.ci' })
  @IsEmail({}, { message: "L'email doit être de domaine @cgrae.ci" })
  @IsNotEmpty()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @IsNotEmpty()
  password: string;

  @ApiProperty({ example: 'Jean' })
  @IsString()
  @IsNotEmpty()
  first_name: string;

  @ApiProperty({ example: 'Dupont' })
  @IsString()
  @IsNotEmpty()
  last_name: string;

  @ApiProperty({ example: 'DSI', required: false })
  department?: string;

  @ApiProperty({ required: false })
  phone?: string;
}
