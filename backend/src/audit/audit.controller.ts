import { Controller, Get, Param, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../common/enums';

@ApiTags('Audit')
@ApiBearerAuth()
@UseGuards(JwtGuard, RolesGuard)
@Controller('audit')
export class AuditController {
  constructor(private auditService: AuditService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Piste d\'audit globale' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(@Query('page') page = 1, @Query('limit') limit = 50) {
    return this.auditService.findAll(+page, +limit);
  }

  @Get('envelope/:id')
  @ApiOperation({ summary: 'Piste d\'audit d\'une enveloppe' })
  findByEnvelope(@Param('id', ParseIntPipe) id: number) {
    return this.auditService.findByEnvelope(id);
  }
}
