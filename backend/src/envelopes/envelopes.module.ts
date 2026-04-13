import { Module } from '@nestjs/common';
import { EnvelopesService } from './envelopes.service';
import { EnvelopesController } from './envelopes.controller';
import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [DatabaseModule, EmailModule, NotificationsModule],
  providers: [EnvelopesService],
  controllers: [EnvelopesController],
  exports: [EnvelopesService],
})
export class EnvelopesModule {}
