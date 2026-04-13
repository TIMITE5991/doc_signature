import * as knex from 'knex';

export const databaseProviders = [
  {
    provide: 'DATABASE',
    useFactory: async () => {
      const db = knex.default({
        client: 'mysql2',
        connection: {
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || '3306', 10),
          user: process.env.DB_USER || 'root',
          password: process.env.DB_PASSWORD || '',
          database: process.env.DB_NAME || 'doc_signature',
          charset: 'utf8mb4',
        },
        pool: { min: 2, max: 10 },
        acquireConnectionTimeout: 60000,
      });

      // Test connection
      await db.raw('SELECT 1');
      console.log('✅ Database connected successfully');
      return db;
    },
  },
];
