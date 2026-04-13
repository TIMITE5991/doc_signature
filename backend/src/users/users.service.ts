import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';
import { Knex } from 'knex';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(@Inject('DATABASE') private db: Knex) {}

  async findAll() {
    return this.db('t_users').select(
      'id_user', 'email', 'first_name', 'last_name', 'role',
      'is_active', 'mfa_enabled', 'department', 'phone', 'avatar_url',
      this.db.raw('(stamp_path IS NOT NULL AND stamp_path != \'\') AS has_stamp'),
      this.db.raw('(signature_path IS NOT NULL AND signature_path != \'\') AS has_signature'),
      'created_at', 'updated_at',
    );
  }

  async findById(id: number) {
    const [user] = await this.db('t_users')
      .where('id_user', id)
      .select('id_user', 'email', 'first_name', 'last_name', 'role',
        'is_active', 'mfa_enabled', 'department', 'phone', 'avatar_url',
        this.db.raw('(stamp_path IS NOT NULL AND stamp_path != \'\') AS has_stamp'),
        this.db.raw('(signature_path IS NOT NULL AND signature_path != \'\') AS has_signature'),
        'created_at', 'updated_at',
      );
    if (!user) throw new NotFoundException('Utilisateur non trouvé');
    return user;
  }

  async getStampPath(userId: number): Promise<string | null> {
    const [user] = await this.db('t_users').where('id_user', userId).select('stamp_path');
    if (!user?.stamp_path || !fs.existsSync(user.stamp_path)) return null;
    return user.stamp_path;
  }

  async saveStamp(userId: number, base64Data: string): Promise<void> {
    if (!base64Data.startsWith('data:image/')) {
      throw new BadRequestException('Format image invalide (PNG ou JPEG requis)');
    }
    const isPng = base64Data.startsWith('data:image/png');
    const ext = isPng ? '.png' : '.jpg';
    const raw = base64Data.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
    if (Buffer.byteLength(raw, 'base64') > 2 * 1024 * 1024) {
      throw new BadRequestException('Le cachet ne doit pas dépasser 2 Mo');
    }
    const stampDir = path.resolve(process.env.UPLOAD_DEST || './uploads', 'stamps');
    if (!fs.existsSync(stampDir)) fs.mkdirSync(stampDir, { recursive: true });
    const stampPath = path.join(stampDir, `stamp_${userId}${ext}`);
    fs.writeFileSync(stampPath, Buffer.from(raw, 'base64'));
    await this.db('t_users').where('id_user', userId).update({ stamp_path: stampPath });
  }

  async getSignaturePath(userId: number): Promise<string | null> {
    const [user] = await this.db('t_users').where('id_user', userId).select('signature_path');
    if (!user?.signature_path || !fs.existsSync(user.signature_path)) return null;
    return user.signature_path;
  }

  async saveSignature(userId: number, base64Data: string): Promise<void> {
    if (!base64Data.startsWith('data:image/')) {
      throw new BadRequestException('Format image invalide (PNG ou JPEG requis)');
    }
    const isPng = base64Data.startsWith('data:image/png');
    const ext = isPng ? '.png' : '.jpg';
    const raw = base64Data.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
    if (Buffer.byteLength(raw, 'base64') > 2 * 1024 * 1024) {
      throw new BadRequestException('La signature ne doit pas dépasser 2 Mo');
    }
    const sigDir = path.resolve(process.env.UPLOAD_DEST || './uploads', 'signatures');
    if (!fs.existsSync(sigDir)) fs.mkdirSync(sigDir, { recursive: true });
    const sigPath = path.join(sigDir, `pref_sig_${userId}${ext}`);
    fs.writeFileSync(sigPath, Buffer.from(raw, 'base64'));
    await this.db('t_users').where('id_user', userId).update({ signature_path: sigPath });
  }

  async create(dto: CreateUserDto) {
    if (!dto.email.endsWith('@cgrae.ci')) {
      throw new BadRequestException('Seuls les emails @cgrae.ci sont autorisés');
    }

    const [existing] = await this.db('t_users').where('email', dto.email);
    if (existing) throw new ConflictException('Email déjà utilisé');

    const hash = await bcrypt.hash(dto.password, 10);
    const [id] = await this.db('t_users').insert({
      email: dto.email,
      password: hash,
      first_name: dto.first_name,
      last_name: dto.last_name,
      role: dto.role || 'SIGNATORY',
      department: dto.department || null,
      phone: dto.phone || null,
      is_active: true,
      mfa_enabled: false,
    });
    return this.findById(id);
  }

  async update(id: number, dto: UpdateUserDto) {
    await this.findById(id);
    await this.db('t_users').where('id_user', id).update({ ...dto, updated_at: this.db.fn.now() });
    return this.findById(id);
  }

  async remove(id: number) {
    await this.findById(id);
    await this.db('t_users').where('id_user', id).update({ is_active: false });
    return { message: 'Utilisateur désactivé avec succès' };
  }
}
