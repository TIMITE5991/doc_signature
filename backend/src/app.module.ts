import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DocumentsModule } from './documents/documents.module';
import { TemplatesModule } from './templates/templates.module';
import { EnvelopesModule } from './envelopes/envelopes.module';
import { AuditModule } from './audit/audit.module';
import { NotificationsModule } from './notifications/notifications.module';
import { EmailModule } from './email/email.module';

@Module({
  imports: [
    DatabaseModule,
    EmailModule,
    AuthModule,
    UsersModule,
    DocumentsModule,
    TemplatesModule,
    EnvelopesModule,
    AuditModule,
    NotificationsModule,
  ],
})
export class AppModule {}
