import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Sequelize } from 'sequelize';
import { SequelizeStorage, Umzug } from 'umzug';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const sequelize = new Sequelize(databaseUrl, { dialect: 'postgres', logging: false });
  const migrationsDirectory = join(process.cwd(), 'migrations');
  const migrator = new Umzug({
    context: sequelize,
    logger: console,
    storage: new SequelizeStorage({
      sequelize,
      tableName: 'schema_migration',
      columnName: 'name',
      timestamps: false,
    }),
    migrations: {
      glob: ['*.sql', { cwd: migrationsDirectory }],
      resolve: ({ name, path, context }) => ({
        name,
        up: async () => {
          if (!path) throw new Error(`Migration path is missing for ${name}`);
          const sql = await readFile(path, 'utf8');
          // The schema definition runs inside Sequelize's transaction boundary.
          await context.transaction((transaction) => context.query(sql, { transaction }));
        },
        down: async () => { throw new Error(`Down migration is not supported for ${name}`); },
      }),
    },
  });

  try {
    await migrator.up();
  } finally {
    await sequelize.close();
  }
}

void main();
