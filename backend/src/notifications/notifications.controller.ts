import { Controller, Get, Put, Param, UseGuards, Request, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtGuard } from '../auth/jwt.guard';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Mes notifications' })
  findAll(@Request() req) {
    return this.notificationsService.findByUser(req.user.id_user);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Nombre de notifications non lues' })
  countUnread(@Request() req) {
    return this.notificationsService.countUnread(req.user.id_user);
  }

  @Put(':id/read')
  @ApiOperation({ summary: 'Marquer une notification comme lue' })
  markRead(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.notificationsService.markRead(id, req.user.id_user);
  }

  @Put('read-all')
  @ApiOperation({ summary: 'Marquer toutes les notifications comme lues' })
  markAllRead(@Request() req) {
    return this.notificationsService.markAllRead(req.user.id_user);
  }
}
