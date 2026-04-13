import {
  Injectable,
  Inject,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Knex } from 'knex';
import { LoginDto, RegisterDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    @Inject('DATABASE') private db: Knex,
    private jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const [user] = await this.db('t_users').where('email', dto.email).andWhere('is_active', true);
    if (!user) throw new UnauthorizedException('Email ou mot de passe incorrect');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Email ou mot de passe incorrect');

    const payload = {
      sub: user.id_user,
      email: user.email,
      role: user.role,
      first_name: user.first_name,
      last_name: user.last_name,
    };

    const token = this.jwtService.sign(payload);
    const { password: _, ...userWithoutPass } = user;
    return { access_token: token, user: userWithoutPass };
  }

  async register(dto: RegisterDto) {
    if (!dto.email.endsWith('@cgrae.ci')) {
      throw new BadRequestException('Seuls les emails @cgrae.ci sont autorisés');
    }

    const [existing] = await this.db('t_users').where('email', dto.email);
    if (existing) throw new BadRequestException('Cet email est déjà utilisé');

    const hash = await bcrypt.hash(dto.password, 10);
    const [id] = await this.db('t_users').insert({
      email: dto.email,
      password: hash,
      first_name: dto.first_name,
      last_name: dto.last_name,
      role: 'SIGNATORY',
      department: dto.department || null,
      phone: dto.phone || null,
      is_active: true,
      mfa_enabled: false,
    });

    const [user] = await this.db('t_users').where('id_user', id);
    const { password: _, ...userWithoutPass } = user;
    return userWithoutPass;
  }

  async getProfile(id_user: number) {
    const [user] = await this.db('t_users').where('id_user', id_user);
    if (!user) throw new UnauthorizedException();
    const { password: _, ...userWithoutPass } = user;
    return userWithoutPass;
  }
}
