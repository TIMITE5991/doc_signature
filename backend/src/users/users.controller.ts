import {
  Controller, Get, Post, Put, Delete, Param, Body, UseGuards, ParseIntPipe, Request, Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../common/enums';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Lister tous les utilisateurs' })
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Obtenir un utilisateur par ID' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findById(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Créer un utilisateur (email @cgrae.ci requis)' })
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Modifier un utilisateur' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Désactiver un utilisateur' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.remove(id);
  }

  // ── Stamp (cachet) — accessible à tout utilisateur authentifié ──

  @Post('me/stamp')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Enregistrer/mettre à jour son cachet officiel (base64 PNG/JPEG)' })
  async uploadStamp(@Request() req, @Body() body: { stamp_image: string }) {
    await this.usersService.saveStamp(req.user.id_user, body.stamp_image);
    return { message: 'Cachet sauvegardé avec succès' };
  }

  @Get('me/stamp')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Obtenir son cachet officiel (image)' })
  async getMyStamp(@Request() req, @Res() res: Response) {
    const stampPath = await this.usersService.getStampPath(req.user.id_user);
    if (!stampPath) return res.status(404).json({ message: 'Aucun cachet enregistré' });
    const mime = stampPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(require('path').resolve(stampPath));
  }

  @Post('me/signature')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Enregistrer/mettre à jour sa signature prédéfinie (base64 PNG/JPEG)' })
  async uploadSignature(@Request() req, @Body() body: { signature_image: string }) {
    await this.usersService.saveSignature(req.user.id_user, body.signature_image);
    return { message: 'Signature sauvegardée avec succès' };
  }

  @Get('me/signature')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Obtenir sa signature prédéfinie (image)' })
  async getMySignature(@Request() req, @Res() res: Response) {
    const sigPath = await this.usersService.getSignaturePath(req.user.id_user);
    if (!sigPath) return res.status(404).json({ message: 'Aucune signature enregistrée' });
    const mime = sigPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(require('path').resolve(sigPath));
  }
}
