import type { VercelClient } from '@vercel/postgres';
import { describe, expect, it } from 'vitest';
import { createClient } from '@/lib/db';
import { createReadingCategory } from '@/lib/readingNotes/categories';
import {
  buildReadingImportPreview,
  confirmReadingImport,
} from '@/lib/readingNotes/importConfirm';
import { createReadingNote } from '@/lib/readingNotes/notes';
import type { ReadingImportCandidate } from '@/lib/readingNotes/types';

async function withImportClient(fn: (client: VercelClient) => Promise<void>) {
  const client = createClient();
  await client.connect();
  await client.query('BEGIN');
  try {
    await fn(client);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

function withNestedTransactions(client: VercelClient, failBulkInsert = false) {
  let sequence = 0;
  const savepoints: string[] = [];
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== 'query') return Reflect.get(target, property, receiver);
      return async (text: string, values?: unknown[]) => {
        if (text === 'BEGIN') {
          const name = `reading_import_operation_${++sequence}`;
          savepoints.push(name);
          return client.query(`SAVEPOINT ${name}`);
        }
        if (text === 'COMMIT') {
          const name = savepoints.pop();
          if (!name) throw new Error('Missing import savepoint');
          return client.query(`RELEASE SAVEPOINT ${name}`);
        }
        if (text === 'ROLLBACK') {
          const name = savepoints.pop();
          if (!name) throw new Error('Missing import savepoint');
          await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
          return client.query(`RELEASE SAVEPOINT ${name}`);
        }
        if (failBulkInsert && text.includes('INSERT INTO reading_notes')) {
          throw new Error('forced note insert failure');
        }
        return client.query(text, values);
      };
    },
  });
}

function candidate(sourceIndex: number, categoryName: string, content: string): ReadingImportCandidate {
  return {
    sourceIndex,
    categoryName,
    contentHtml: `<p>${content}</p>`,
    contentText: content.toLocaleLowerCase('en-US'),
    notes: null,
    noteDate: '2026-09-03',
    confidence: 'high',
    issue: null,
  };
}

describe('reading note import transaction', () => {
  it('previews without writes and atomically creates categories and nonduplicates', async () => {
    await withImportClient(async (client) => {
      const repository = withNestedTransactions(client);
      const suffix = `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
      const existingName = `Existing ${suffix}`;
      const proposedName = `Proposed ${suffix}`;
      const existing = await createReadingCategory(repository, existingName);
      await createReadingNote(repository, {
        categoryId: existing.id,
        contentHtml: '<p>duplicate content</p>',
        notes: null,
        noteDate: '2026-09-03',
        today: '2026-09-03',
      });
      const candidates = [
        candidate(0, existingName, 'duplicate content'),
        candidate(1, existingName, 'new existing-category content'),
        candidate(2, proposedName, 'duplicate content'),
      ];

      const preview = await buildReadingImportPreview(repository, candidates, 'integration-secret');
      const before = await client.query(
        'SELECT COUNT(*)::int AS count FROM reading_note_categories WHERE name = $1',
        [proposedName],
      );
      expect(before.rows[0].count).toBe(0);
      expect(preview).toMatchObject({ recognizedCount: 2, duplicateCount: 1 });

      const result = await confirmReadingImport(repository, {
        candidates,
        acceptedSourceIndexes: [0, 1, 2],
        today: '2026-09-03',
      });
      expect(result).toEqual({ requested: 3, inserted: 2, duplicates: 1, categoriesCreated: 1 });
      const after = await client.query(
        `SELECT COUNT(note.id)::int AS count
         FROM reading_notes note
         JOIN reading_note_categories category ON category.id = note.category_id
         WHERE category.name = $1`,
        [proposedName],
      );
      expect(after.rows[0].count).toBe(1);
    });
  }, 60_000);

  it('rolls back a newly created category when note insertion fails', async () => {
    await withImportClient(async (client) => {
      const repository = withNestedTransactions(client, true);
      const categoryName = `Rollback ${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
      await expect(confirmReadingImport(repository, {
        candidates: [candidate(0, categoryName, 'rollback content')],
        acceptedSourceIndexes: [0],
        today: '2026-09-03',
      })).rejects.toThrow('forced note insert failure');

      const { rows } = await client.query(
        'SELECT COUNT(*)::int AS count FROM reading_note_categories WHERE name = $1',
        [categoryName],
      );
      expect(rows[0].count).toBe(0);
    });
  }, 60_000);
});
