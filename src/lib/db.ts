import { config } from 'dotenv';
import { types } from '@vercel/postgres';

// Outside of `next dev`/`next build`/`next start` (which load .env.local natively),
// nothing populates process.env for standalone scripts or Vitest runs. Loading it here
// means every file that imports sql/createClient from this module — which is mandatory,
// see below — gets env vars for free, instead of every script/test file needing its own
// `config({ path: '.env.local' })` line. A no-op (silently does nothing) when the file
// doesn't exist, e.g. in production where Vercel injects real env vars directly.
config({ path: '.env.local' });

// The underlying `pg` driver parses DATE columns into JS Date objects in the
// server's local timezone by default, which corrupts 'YYYY-MM-DD' values
// (e.g. a date_added of '2026-06-20' becomes '2026-06-19T16:00:00.000Z' on a
// UTC+8 host). Every date column this app touches is a plain calendar date
// with no time/timezone component, so keep it as the raw string Postgres
// returns instead of letting the driver convert it.
types.setTypeParser(types.builtins.DATE, (value: string) => value);

export { sql, createClient } from '@vercel/postgres';
