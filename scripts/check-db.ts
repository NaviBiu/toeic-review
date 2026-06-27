import { config } from 'dotenv';
config({ path: '.env.local' });
import { sql } from '@vercel/postgres';

async function main() {
  const { rows } = await sql`SELECT 1 as ok`;
  console.log('DB connection OK:', rows[0]);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('DB connection FAILED:', err);
    process.exit(1);
  });
