import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@vercel/postgres';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

async function migrate() {
  const client = createClient();
  await client.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    );
    const dir = join(process.cwd(), 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const { rows } = await client.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
      if (rows.length > 0) {
        console.log(`Skipping ${file} (already applied)`);
        continue;
      }
      const text = readFileSync(join(dir, file), 'utf-8');
      await client.query(text);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      console.log(`Applied ${file}`);
    }
  } finally {
    await client.end();
  }
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
