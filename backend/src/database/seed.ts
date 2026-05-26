import * as bcrypt from 'bcrypt';
import * as knex from 'knex';
import * as dotenv from 'dotenv';

dotenv.config();

async function seed() {
  const db = knex.default({
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'doc_signature',
    },
  });

  const upsertUser = async (payload: {
    email: string;
    password: string;
    first_name: string;
    last_name: string;
    role: string;
    department: string;
    phone: string;
    is_active: boolean;
    mfa_enabled: boolean;
  }) => {
    await db('t_users')
      .insert(payload)
      .onConflict('email')
      .merge({
        password: payload.password,
        first_name: payload.first_name,
        last_name: payload.last_name,
        role: payload.role,
        department: payload.department,
        phone: payload.phone,
        is_active: payload.is_active,
        mfa_enabled: payload.mfa_enabled,
      });
  };

  // Super Admin
  await upsertUser({
    email: 'admin@cgrae.ci',
    password: await bcrypt.hash('Admin1234!', 10),
    first_name: 'Super',
    last_name: 'Admin',
    role: 'SUPER_ADMIN',
    department: 'DSI',
    phone: '+225 0000000000',
    is_active: true,
    mfa_enabled: false,
  });

  // Admin
  await upsertUser({
    email: 'it.admin@cgrae.ci',
    password: await bcrypt.hash('Admin1234!', 10),
    first_name: 'Responsable',
    last_name: 'IT',
    role: 'ADMIN',
    department: 'DSI',
    phone: '+225 0101010101',
    is_active: true,
    mfa_enabled: false,
  });

  // Signatory
  await upsertUser({
    email: 'dg@cgrae.ci',
    password: await bcrypt.hash('User1234!', 10),
    first_name: 'Directeur',
    last_name: 'Général',
    role: 'SIGNATORY',
    department: 'Direction Générale',
    phone: '+225 0202020202',
    is_active: true,
    mfa_enabled: false,
  });

  // Approver
  await upsertUser({
    email: 'juridique@cgrae.ci',
    password: await bcrypt.hash('User1234!', 10),
    first_name: 'Responsable',
    last_name: 'Juridique',
    role: 'APPROVER',
    department: 'Direction Juridique',
    phone: '+225 0303030303',
    is_active: true,
    mfa_enabled: false,
  });

  console.log('✅ Seed data inserted successfully');
  await db.destroy();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
