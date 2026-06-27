import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient, type VercelClient } from '@vercel/postgres';

export async function withTestClient(fn: (client: VercelClient) => Promise<void>) {
  const client = createClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    let savepointCounter = 0;

    // Wrap client.query to auto-rollback failed queries to savepoint
    const originalQuery = client.query.bind(client);
    (client as any).query = async function(
      text: string,
      values?: any[],
    ) {
      const spName = `sp_${++savepointCounter}`;
      await originalQuery(`SAVEPOINT ${spName}`);
      try {
        return await originalQuery(text, values);
      } catch (err) {
        await originalQuery(`ROLLBACK TO SAVEPOINT ${spName}`);
        throw err;
      }
    };

    await fn(client);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}
