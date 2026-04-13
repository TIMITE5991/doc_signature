import { Injectable, Inject, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Knex } from 'knex';
import * as fs from 'fs';

@Injectable()
export class DocumentsService {
  constructor(@Inject('DATABASE') private db: Knex) {}

  async create(file: Express.Multer.File, userId: number) {
    const [id] = await this.db('t_documents').insert({
      name: file.filename,
      original_name: file.originalname,
      path: file.path,
      mime_type: file.mimetype,
      size: file.size,
      version: 1,
      created_by: userId,
    });
    return this.findById(id);
  }

  async findByUser(userId: number) {
    const [user] = await this.db('t_users').where('id_user', userId).select('email');
    if (!user) return [];

    const ownDocs = await this.db('t_documents as d')
      .where('d.created_by', userId)
      .select('d.*', this.db.raw("'OWN' as source_type"), this.db.raw('NULL as source_envelope_id'));

    const receivedDocs = await this.db('t_documents as d')
      .join('t_envelope_documents as ed', 'ed.id_document', 'd.id_document')
      .join('t_recipients as r', 'r.id_envelope', 'ed.id_envelope')
      .where('r.email', user.email)
      .whereIn('r.status', ['SIGNED', 'APPROVED'])
      .select('d.*', this.db.raw("'RECEIVED' as source_type"), 'ed.id_envelope as source_envelope_id');

    const byId = new Map<number, any>();
    for (const doc of [...receivedDocs, ...ownDocs]) {
      const prev = byId.get(doc.id_document);
      if (!prev || doc.source_type === 'OWN') {
        byId.set(doc.id_document, doc);
      }
    }

    const docs = Array.from(byId.values());
    if (!docs.length) return [];

    const archiveRows = await this.db('t_user_document_archives')
      .where('id_user', userId)
      .whereIn('id_document', docs.map((d) => d.id_document))
      .select('id_document', 'is_archived', 'archived_at');

    const archiveMap = new Map<number, any>(archiveRows.map((r) => [r.id_document, r]));

    return docs
      .map((d) => {
        const a = archiveMap.get(d.id_document);
        return {
          ...d,
          is_archived: !!a?.is_archived,
          archived_at: a?.archived_at || null,
        };
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  async findById(id: number) {
    const [doc] = await this.db('t_documents').where('id_document', id);
    if (!doc) throw new NotFoundException('Document non trouvé');
    return doc;
  }

  async remove(id: number, userId: number) {
    const doc = await this.findById(id);
    if (doc.created_by !== userId) {
      throw new ForbiddenException('Vous ne pouvez supprimer que vos propres documents');
    }
    // Supprimer d'abord les liaisons avec les enveloppes
    await this.db('t_envelope_documents').where('id_document', id).delete();
    // Supprimer le fichier physique
    if (fs.existsSync(doc.path)) fs.unlinkSync(doc.path);
    await this.db('t_documents').where('id_document', id).delete();
    return { message: 'Document supprimé' };
  }

  async archive(id: number, userId: number) {
    const canAccess = await this.canArchiveInGed(id, userId);
    if (!canAccess) {
      throw new ForbiddenException('Vous ne pouvez archiver que des documents de votre GED');
    }

    await this.db('t_user_document_archives')
      .insert({
        id_user: userId,
        id_document: id,
        is_archived: true,
        archived_at: this.db.fn.now(),
      })
      .onConflict(['id_user', 'id_document'])
      .merge({
        is_archived: true,
        archived_at: this.db.fn.now(),
      });

    const [row] = await this.db('t_user_document_archives')
      .where({ id_user: userId, id_document: id })
      .select('*');

    return { ...(await this.findById(id)), is_archived: !!row?.is_archived, archived_at: row?.archived_at || null };
  }

  async unarchive(id: number, userId: number) {
    const canAccess = await this.canArchiveInGed(id, userId);
    if (!canAccess) {
      throw new ForbiddenException('Vous ne pouvez désarchiver que des documents de votre GED');
    }

    await this.db('t_user_document_archives')
      .insert({
        id_user: userId,
        id_document: id,
        is_archived: false,
        archived_at: null,
      })
      .onConflict(['id_user', 'id_document'])
      .merge({
        is_archived: false,
        archived_at: null,
      });

    return { ...(await this.findById(id)), is_archived: false, archived_at: null };
  }

  private async canArchiveInGed(documentId: number, userId: number): Promise<boolean> {
    const [doc] = await this.db('t_documents')
      .where('id_document', documentId)
      .select('id_document', 'created_by');
    if (!doc) throw new NotFoundException('Document non trouvé');
    if (doc.created_by === userId) return true;

    const [user] = await this.db('t_users').where('id_user', userId).select('email');
    if (!user) return false;

    const [received] = await this.db('t_envelope_documents as ed')
      .join('t_recipients as r', 'r.id_envelope', 'ed.id_envelope')
      .where('ed.id_document', documentId)
      .where('r.email', user.email)
      .whereIn('r.status', ['SIGNED', 'APPROVED'])
      .select('ed.id_document');

    return !!received;
  }
}
