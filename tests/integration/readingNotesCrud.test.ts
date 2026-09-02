import { describe, expect, it } from 'vitest';
import {
  createReadingCategory,
  deleteReadingCategory,
  mergeReadingCategory,
} from '@/lib/readingNotes/categories';
import {
  createReadingNote,
  restoreReadingNoteSnapshot,
  setReadingNoteStatus,
  softDeleteReadingNote,
} from '@/lib/readingNotes/notes';
import { withTestClient } from './setup';

function withNestedTransactions(client: Parameters<Parameters<typeof withTestClient>[0]>[0]) {
  let sequence = 0;
  const savepoints: string[] = [];
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== 'query') return Reflect.get(target, property, receiver);
      return async (text: string, values?: unknown[]) => {
        if (text === 'BEGIN') {
          const name = `reading_operation_${++sequence}`;
          savepoints.push(name);
          return client.query(`SAVEPOINT ${name}`);
        }
        if (text === 'COMMIT') {
          const name = savepoints.pop();
          if (!name) throw new Error('Missing reading operation savepoint');
          return client.query(`RELEASE SAVEPOINT ${name}`);
        }
        if (text === 'ROLLBACK') {
          const name = savepoints.pop();
          if (!name) throw new Error('Missing reading operation savepoint');
          await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
          return client.query(`RELEASE SAVEPOINT ${name}`);
        }
        return client.query(text, values);
      };
    },
  });
}

describe('reading note CRUD', () => {
  it('scopes duplicate content to an active category', async () => {
    await withTestClient(async (client) => {
      const repositoryClient = withNestedTransactions(client);
      const first = await createReadingCategory(repositoryClient, `Scoped A ${Date.now()}`);
      const second = await createReadingCategory(repositoryClient, `Scoped B ${Date.now()}`);
      const input = {
        contentHtml: '<p>Subject   to approval</p>',
        notes: null,
        noteDate: '2026-09-01',
        today: '2026-09-02',
      };

      await expect(createReadingNote(repositoryClient, { ...input, categoryId: first.id }))
        .resolves.toMatchObject({ categoryId: first.id });
      await expect(createReadingNote(repositoryClient, {
        ...input,
        categoryId: second.id,
        contentHtml: '<p>subject to approval</p>',
      })).resolves.toMatchObject({ categoryId: second.id });
      await expect(createReadingNote(repositoryClient, {
        ...input,
        categoryId: first.id,
        contentHtml: '<p>subject to approval</p>',
      })).rejects.toMatchObject({ kind: 'conflict' });
    });
  }, 60_000);

  it('moves every note before marking a merged category deleted', async () => {
    await withTestClient(async (client) => {
      const repositoryClient = withNestedTransactions(client);
      const source = await createReadingCategory(repositoryClient, `Merge source ${Date.now()}`);
      const target = await createReadingCategory(repositoryClient, `Merge target ${Date.now()}`);
      const note = await createReadingNote(repositoryClient, {
        categoryId: source.id,
        contentHtml: '<p>Merge me</p>',
        notes: null,
        noteDate: '2026-09-02',
        today: '2026-09-02',
      });

      await mergeReadingCategory(repositoryClient, source.id, target.id);
      const { rows } = await client.query(
        `SELECT note.category_id, category.status
         FROM reading_notes note
         JOIN reading_note_categories category ON category.id = $2
         WHERE note.id = $1`,
        [note.id, source.id],
      );
      expect(rows[0]).toEqual({ category_id: target.id, status: 'deleted' });
    });
  }, 60_000);

  it('moves notes to uncategorized without deleting them', async () => {
    await withTestClient(async (client) => {
      const repositoryClient = withNestedTransactions(client);
      const source = await createReadingCategory(repositoryClient, `Delete source ${Date.now()}`);
      const note = await createReadingNote(repositoryClient, {
        categoryId: source.id,
        contentHtml: '<p>Keep me</p>',
        notes: null,
        noteDate: '2026-09-02',
        today: '2026-09-02',
      });

      await deleteReadingCategory(repositoryClient, source.id, 'uncategorized');
      const { rows } = await client.query(
        `SELECT note.status, category.is_default
         FROM reading_notes note
         JOIN reading_note_categories category ON category.id = note.category_id
         WHERE note.id = $1`,
        [note.id],
      );
      expect(rows[0]).toEqual({ status: 'active', is_default: true });
    });
  }, 60_000);

  it('restores the exact pre-delete SRS state', async () => {
    await withTestClient(async (client) => {
      const repositoryClient = withNestedTransactions(client);
      const category = await createReadingCategory(repositoryClient, `Restore ${Date.now()}`);
      const created = await createReadingNote(repositoryClient, {
        categoryId: category.id,
        contentHtml: '<p>Restore me</p>',
        notes: null,
        noteDate: '2026-09-02',
        today: '2026-09-02',
      });
      const mastered = await setReadingNoteStatus(repositoryClient, created.id, 'mastered', '2026-09-02');
      const deleted = await softDeleteReadingNote(repositoryClient, mastered.id);
      const restored = await restoreReadingNoteSnapshot(repositoryClient, mastered.id, deleted.snapshot);

      expect(deleted.note.status).toBe('deleted');
      expect(restored).toMatchObject({
        status: 'mastered',
        correctStreak: mastered.correctStreak,
        correctCount: mastered.correctCount,
        wrongCount: mastered.wrongCount,
        nextReviewDate: mastered.nextReviewDate,
        lastReviewedDate: mastered.lastReviewedDate,
      });

      const active = await setReadingNoteStatus(repositoryClient, mastered.id, 'active', '2026-09-02');
      expect(active.nextReviewDate).toBe('2026-09-02');
    });
  }, 60_000);
});
