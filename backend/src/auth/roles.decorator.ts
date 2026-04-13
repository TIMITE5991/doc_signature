import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../common/enums';
import { ROLES_KEY } from './roles.guard';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
