import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Knex } from 'knex';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';

@Injectable()
export class TemplatesService {
  constructor(@Inject('DATABASE') private db: Knex) {}

  async findAll() {
    return this.db('t_templates as t')
      .join('t_users as u', 't.created_by', 'u.id_user')
      .where('t.is_active', true)
      .select(
        't.*',
        this.db.raw("CONCAT(u.first_name, ' ', u.last_name) as creator_name"),
      )
      .orderBy('t.created_at', 'desc');
  }

  async findById(id: number) {
    const [tpl] = await this.db('t_templates').where('id_template', id).andWhere('is_active', true);
    if (!tpl) throw new NotFoundException('Modèle non trouvé');
    return tpl;
  }

  async create(dto: CreateTemplateDto, userId: number) {
    const [id] = await this.db('t_templates').insert({
      name: dto.name,
      description: dto.description || null,
      fields: dto.fields ? JSON.stringify(dto.fields) : null,
      created_by: userId,
      is_active: true,
    });
    return this.findById(id);
  }

  async update(id: number, dto: UpdateTemplateDto) {
    await this.findById(id);
    const payload: any = { updated_at: this.db.fn.now() };
    if (dto.name !== undefined) payload.name = dto.name;
    if (dto.description !== undefined) payload.description = dto.description;
    if (dto.fields !== undefined) payload.fields = JSON.stringify(dto.fields);
    await this.db('t_templates').where('id_template', id).update(payload);
    return this.findById(id);
  }

  async remove(id: number) {
    await this.findById(id);
    await this.db('t_templates').where('id_template', id).update({ is_active: false });
    return { message: 'Modèle archivé' };
  }
}
