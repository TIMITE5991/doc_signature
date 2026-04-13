import { Injectable, Inject } from '@nestjs/common';
import { Knex } from 'knex';

@Injectable()
export class NotificationsService {
  constructor(@Inject('DATABASE') private db: Knex) {}

  async findByUser(userId: number) {
    return this.db('t_notifications')
      .where('id_user', userId)
      .orderBy('created_at', 'desc')
      .limit(50);
  }

  async markRead(id: number, userId: number) {
    await this.db('t_notifications').where('id_notification', id).andWhere('id_user', userId).update({ is_read: true });
    return { message: 'Notification lue' };
  }

  async markAllRead(userId: number) {
    await this.db('t_notifications').where('id_user', userId).update({ is_read: true });
    return { message: 'Toutes les notifications lues' };
  }

  async countUnread(userId: number): Promise<number> {
    const [{ count }] = await this.db('t_notifications').where('id_user', userId).andWhere('is_read', false).count('id_notification as count');
    return Number(count);
  }

  async create(userId: number, message: string, envelopeId?: number): Promise<void> {
    await this.db('t_notifications').insert({
      id_user: userId,
      id_envelope: envelopeId || null,
      type: 'NOTIFICATION',
      title: message.substring(0, 80),
      message,
      is_read: false,
    });
  }
}
