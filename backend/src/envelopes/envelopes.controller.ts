import {
  Controller, Get, Post, Param, Body, UseGuards, Request,
  ParseIntPipe, Ip, Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { EnvelopesService } from './envelopes.service';
import {
  CreateEnvelopeDto,
  UpdateEnvelopeDocumentsDto,
  RejectEnvelopeDto,
  DelegateDto,
  ReturnCorrectionDto,
  ForwardRecipientDto,
  ReactivateEnvelopeDto,
} from './dto/envelope.dto';
import { JwtGuard } from '../auth/jwt.guard';

@ApiTags('Envelopes')
@Controller('envelopes')
export class EnvelopesController {
  constructor(private envelopesService: EnvelopesService) {}

  @Get()
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lister mes enveloppes' })
  findAll(@Request() req) {
    return this.envelopesService.findAll(req.user.id_user, req.user.role);
  }

  @Get(':id')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Détail d\'une enveloppe' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.envelopesService.findById(id);
  }

  @Post()
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Créer une enveloppe (brouillon)' })
  create(@Body() dto: CreateEnvelopeDto, @Request() req) {
    return this.envelopesService.create(dto, req.user.id_user);
  }

  @Post('create-and-send')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Créer et envoyer une enveloppe en une seule requête' })
  createAndSend(@Body() dto: CreateEnvelopeDto, @Request() req) {
    return this.envelopesService.createAndSend(dto, req.user.id_user);
  }

  @Post(':id/send')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Envoyer l\'enveloppe aux signataires' })
  send(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.envelopesService.send(id, req.user.id_user);
  }

  @Post(':id/cancel')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Annuler une enveloppe' })
  cancel(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.envelopesService.cancel(id, req.user.id_user);
  }

  @Post(':id/documents')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remplacer les documents associés à une enveloppe' })
  updateDocuments(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEnvelopeDocumentsDto,
    @Request() req,
  ) {
    return this.envelopesService.replaceDocuments(
      id,
      req.user.id_user,
      dto.document_ids,
      dto.attachment_ids,
      dto.recipient_zones,
    );
  }

  @Post(':id/forward')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Renvoyer le circuit vers un nouveau destinataire (créateur)' })
  forwardByCreator(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ForwardRecipientDto,
    @Request() req,
  ) {
    return this.envelopesService.forwardByCreator(id, req.user.id_user, dto);
  }

  @Post(':id/close')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Clôturer le circuit par le créateur et archiver dans la GED' })
  closeByCreator(
    @Param('id', ParseIntPipe) id: number,
    @Request() req,
  ) {
    return this.envelopesService.closeByCreator(id, req.user.id_user);
  }

  @Post(':id/reactivate')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remettre une enveloppe expirée dans le circuit avec une nouvelle date limite' })
  reactivateByCreator(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReactivateEnvelopeDto,
    @Request() req,
  ) {
    return this.envelopesService.reactivateByCreator(id, req.user.id_user, dto.expires_at);
  }

  // Public routes (no JWT - accessed via token link)
  @Get('sign/:token')
  @ApiOperation({ summary: '(Public) Obtenir l\'enveloppe via lien de signature' })
  getPublic(@Param('token') token: string) {
    return this.envelopesService.getPublicEnvelope(token);
  }

  @Post('sign/:token/confirm')
  @ApiOperation({ summary: '(Public) Signer le document' })
  sign(
    @Param('token') token: string,
    @Ip() ip: string,
    @Body() body: {
      signature_image?: string;
      use_saved_signature?: boolean;
      comment?: string;
      signature_position?: { doc_id: number; x_ratio: number; y_ratio: number; page_number?: number };
      use_stamp?: boolean;
      stamp_image?: string;
      stamp_position?: { doc_id: number; x_ratio: number; y_ratio: number; page_number?: number };
    },
  ) {
    return this.envelopesService.sign(
      token,
      ip,
      body?.signature_image,
      body?.use_saved_signature,
      body?.comment,
      body?.signature_position,
      body?.use_stamp,
      body?.stamp_image,
      body?.stamp_position,
    );
  }

  @Get('sign/:token/stamp')
  @ApiOperation({ summary: '(Public) Obtenir le cachet du signataire' })
  async getPublicStamp(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    await this.envelopesService.servePublicStamp(token, res);
  }

  @Get('sign/:token/signature')
  @ApiOperation({ summary: '(Public) Obtenir la signature prédéfinie du signataire' })
  async getPublicSignature(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    await this.envelopesService.servePublicSignature(token, res);
  }

  @Get('sign/:token/document/:docId')
  @ApiOperation({ summary: '(Public) Visualiser un document via lien de signature' })
  async getDocument(
    @Param('token') token: string,
    @Param('docId', ParseIntPipe) docId: number,
    @Res() res: Response,
  ) {
    await this.envelopesService.servePublicDocument(token, docId, res);
  }

  @Post('sign/:token/reject')
  @ApiOperation({ summary: '(Public) Rejeter le document' })
  reject(
    @Param('token') token: string,
    @Body() dto: RejectEnvelopeDto,
    @Ip() ip: string,
  ) {
    return this.envelopesService.reject(token, dto, ip);
  }

  @Post('sign/:token/delegate')
  @ApiOperation({ summary: '(Public) Déléguer la signature' })
  delegate(@Param('token') token: string, @Body() dto: DelegateDto) {
    return this.envelopesService.delegate(token, dto);
  }

  @Post('sign/:token/return')
  @ApiOperation({ summary: '(Public) Retourner le document pour corrections' })
  returnForCorrection(
    @Param('token') token: string,
    @Body() dto: ReturnCorrectionDto,
    @Ip() ip: string,
  ) {
    return this.envelopesService.returnForCorrection(token, dto.reason, ip);
  }

  @Post('sign/:token/forward')
  @ApiOperation({ summary: '(Public) Renvoyer à un autre destinataire après signature' })
  forwardAfterSign(
    @Param('token') token: string,
    @Body() dto: ForwardRecipientDto,
    @Ip() ip: string,
  ) {
    return this.envelopesService.forwardAfterSign(token, dto, ip);
  }
}
