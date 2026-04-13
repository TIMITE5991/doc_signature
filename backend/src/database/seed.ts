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

  const hash = await bcrypt.hash('Admin1234!', 10);

  // Super Admin
  await db('t_users').insert({
    email: 'admin@cgrae.ci',
    password: hash,
    first_name: 'Super',
    last_name: 'Admin',
    role: 'SUPER_ADMIN',
    department: 'DSI',
    phone: '+225 0000000000',
    is_active: true,
    mfa_enabled: false,
  }).onConflict('email').ignore();

  // Admin
  await db('t_users').insert({
    email: 'it.admin@cgrae.ci',
    password: await bcrypt.hash('Admin1234!', 10),
    first_name: 'Responsable',
    last_name: 'IT',
    role: 'ADMIN',
    department: 'DSI',
    phone: '+225 0101010101',
    is_active: true,
    mfa_enabled: false,
  }).onConflict('email').ignore();

  // Signatory
  await db('t_users').insert({
    email: 'dg@cgrae.ci',
    password: await bcrypt.hash('User1234!', 10),
    first_name: 'Directeur',
    last_name: 'Général',
    role: 'SIGNATORY',
    department: 'Direction Générale',
    phone: '+225 0202020202',
    is_active: true,
    mfa_enabled: false,
  }).onConflict('email').ignore();

  // Approver
  await db('t_users').insert({
    email: 'juridique@cgrae.ci',
    password: await bcrypt.hash('User1234!', 10),
    first_name: 'Responsable',
    last_name: 'Juridique',
    role: 'APPROVER',
    department: 'Direction Juridique',
    phone: '+225 0303030303',
    is_active: true,
    mfa_enabled: false,
  }).onConflict('email').ignore();

  console.log('✅ Seed data inserted successfully');
  await db.destroy();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
