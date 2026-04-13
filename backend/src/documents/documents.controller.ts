import {
  Controller, Get, Post, Delete, Param, UseGuards,
  UseInterceptors, UploadedFile, Request, ParseIntPipe,
  BadRequestException, Res, Patch,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { JwtGuard } from '../auth/jwt.guard';
import { DocumentsService } from './documents.service';

const ALLOWED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
];

@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Uploader un document (PDF, DOCX, XLSX, images)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: process.env.UPLOAD_DEST || './uploads',
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname);
          cb(null, `${uuidv4()}${ext}`);
        },
      }),
      limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10) },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Type de fichier non autorisé'), false);
        }
      },
    }),
  )
  uploadFile(@UploadedFile() file: Express.Multer.File, @Request() req) {
    if (!file) throw new BadRequestException('Aucun fichier reçu');
    return this.documentsService.create(file, req.user.id_user);
  }

  @Get()
  @ApiOperation({ summary: 'Lister mes documents' })
  findAll(@Request() req) {
    return this.documentsService.findByUser(req.user.id_user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtenir un document (métadonnées)' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.documentsService.findById(id);
  }

  @Get(':id/view')
  @ApiOperation({ summary: 'Visualiser/télécharger un document (fichier)' })
  async viewFile(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const doc = await this.documentsService.findById(id);
    const absolutePath = path.resolve(doc.path);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ message: 'Fichier introuvable sur le serveur' });
    }
    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${doc.original_name}"`);
    res.sendFile(absolutePath);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Supprimer un document' })
  remove(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.documentsService.remove(id, req.user.id_user);
  }

  @Patch(':id/archive')
  @ApiOperation({ summary: 'Archiver un document dans la GED' })
  archive(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.documentsService.archive(id, req.user.id_user);
  }

  @Patch(':id/unarchive')
  @ApiOperation({ summary: 'Désarchiver un document de la GED' })
  unarchive(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.documentsService.unarchive(id, req.user.id_user);
  }
}
