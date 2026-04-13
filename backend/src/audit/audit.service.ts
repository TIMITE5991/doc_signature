import { Injectable, Inject } from '@nestjs/common';
import { Knex } from 'knex';

@Injectable()
export class AuditService {
  constructor(@Inject('DATABASE') private db: Knex) {}

  async findByEnvelope(envelopeId: number) {
    return this.db('t_audit_logs')
      .where('id_envelope', envelopeId)
      .orderBy('created_at', 'asc');
  }

  async findAll(page = 1, limit = 50) {
    const offset = (page - 1) * limit;
    const [{ total }] = await this.db('t_audit_logs').count('id_audit as total');
    const data = await this.db('t_audit_logs').orderBy('created_at', 'desc').limit(limit).offset(offset);
    return { data, total: Number(total), page, limit };
  }
}
