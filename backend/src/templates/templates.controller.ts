import {
  Controller, Get, Post, Put, Delete, Param, Body, UseGuards, Request, ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';
import { JwtGuard } from '../auth/jwt.guard';

@ApiTags('Templates')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('templates')
export class TemplatesController {
  constructor(private templatesService: TemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'Lister tous les modèles' })
  findAll() {
    return this.templatesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtenir un modèle' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.templatesService.findById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Créer un modèle' })
  create(@Body() dto: CreateTemplateDto, @Request() req) {
    return this.templatesService.create(dto, req.user.id_user);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Modifier un modèle' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTemplateDto) {
    return this.templatesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Archiver un modèle' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.templatesService.remove(id);
  }
}
