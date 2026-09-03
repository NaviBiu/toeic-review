import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createClient } from '@/lib/db';
import { createReadingCategory } from '@/lib/readingNotes/categories';
import { createReadingNote } from '@/lib/readingNotes/notes';
import {
  correctReadingAttempt,
  getReadingQueuePage,
  recordReadingAttempt,
} from '@/lib/readingNotes/review';
import { withTestClient } from './setup';

function withNestedTransactions(client: Parameters<Parameters<typeof withTestClient>[0]>[0]) {
  let sequence = 0;
  const savepoints: string[] = [];
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== 'query') return Reflect.get(target, property, receiver);
      return async (text: string, values?: unknown[]) => {
        if (text === 'BEGIN') {
          const name = `reading_review_operation_${++sequence}`;
          savepoints.push(name);
          return client.query(`SAVEPOINT ${name}`);
        }
        if (text === 'COMMIT') {
          const name = savepoints.pop();
          if (!name) throw new Error('Missing reading review savepoint');
          return client.query(`RELEASE SAVEPOINT ${name}`);
        }
        if (text === 'ROLLBACK') {
          const name = savepoints.pop();
          if (!name) throw new Error('Missing reading review savepoint');
          await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
          return client.query(`RELEASE SAVEPOINT ${name}`);
        }
        return client.query(text, values);
      };
    },
  });
}

describe('reading note review transactions', () => {
  it('keeps creation idempotent, corrects from before-state, and rejects stale corrections', async () => {
    await withTestClient(async (client) => {
      const repositoryClient = withNestedTransactions(client);
      const today = '2026-09-03';
      const category = await createReadingCategory(repositoryClient, `Review ${Date.now()}`);
      const note = await createReadingNote(repositoryClient, {
        categoryId: category.id,
        contentHtml: '<p>Review transaction note</p>',
        notes: null,
        noteDate: today,
        today,
      });
      const firstInput = {
        requestId: '5d861510-8769-4945-8796-f9ec0fb1b3dd',
        noteId: note.id,
        decision: 'unknown' as const,
        today,
      };

      const first = await recordReadingAttempt(repositoryClient, firstInput);
      expect(first.note).toMatchObject({
        wrongCount: 1,
        correctStreak: 0,
        nextReviewDate: today,
      });

      const retry = await recordReadingAttempt(repositoryClient, firstInput);
      expect(retry.attempt.id).toBe(first.attempt.id);
      expect(retry.note).toMatchObject({ wrongCount: 1, correctCount: 0 });

      const corrected = await correctReadingAttempt(repositoryClient, {
        attemptId: first.attempt.id,
        decision: 'known',
        today,
      });
      expect(corrected.attempt.id).toBe(first.attempt.id);
      expect(corrected.note).toMatchObject({
        correctCount: 1,
        wrongCount: 0,
        correctStreak: 1,
        nextReviewDate: '2026-09-04',
      });

      await recordReadingAttempt(repositoryClient, {
        requestId: '15f17f68-033d-411c-a471-35ce025f1ef9',
        noteId: note.id,
        decision: 'unknown',
        today,
      });
      await expect(correctReadingAttempt(repositoryClient, {
        attemptId: first.attempt.id,
        decision: 'unknown',
        today,
      })).rejects.toMatchObject({
        kind: 'conflict',
        message: '只能修改该知识点最近一次复盘结果',
      });
    });
  }, 60_000);

  it('increments a note once when the same UUID arrives concurrently', async () => {
    const suffix = `${Date.now()}_${Math.round(Math.random() * 1_000_000)}`;
    const setup = createClient();
    const firstClient = createClient();
    const secondClient = createClient();
    let categoryId: number | null = null;
    let noteId: number | null = null;
    try {
      await setup.connect();
      const category = await createReadingCategory(setup, `Concurrent review ${suffix}`);
      categoryId = category.id;
      const note = await createReadingNote(setup, {
        categoryId,
        contentHtml: '<p>Concurrent review note</p>',
        notes: null,
        noteDate: '2026-09-03',
        today: '2026-09-03',
      });
      noteId = note.id;
      await Promise.all([firstClient.connect(), secondClient.connect()]);

      const input = {
        requestId: randomUUID(),
        noteId,
        decision: 'unknown' as const,
        today: '2026-09-03',
      };
      const results = await Promise.all([
        recordReadingAttempt(firstClient, input),
        recordReadingAttempt(secondClient, input),
      ]);
      const { rows } = await setup.query(
        `SELECT note.wrong_count, COUNT(attempt.id)::int AS attempt_count
         FROM reading_notes note
         LEFT JOIN reading_note_review_attempts attempt ON attempt.note_id = note.id
         WHERE note.id = $1
         GROUP BY note.id`,
        [noteId],
      );

      expect(results[0].attempt.id).toBe(results[1].attempt.id);
      expect(rows[0]).toEqual({ wrong_count: 1, attempt_count: 1 });
    } finally {
      await Promise.allSettled([firstClient.end(), secondClient.end()]);
      if (noteId !== null) {
        await setup.query('DELETE FROM reading_note_review_attempts WHERE note_id = $1', [noteId]);
        await setup.query('DELETE FROM reading_notes WHERE id = $1', [noteId]);
      }
      if (categoryId !== null) {
        await setup.query('DELETE FROM reading_note_categories WHERE id = $1', [categoryId]);
      }
      await setup.end();
    }
  }, 60_000);

  it('returns later due notes on repeated queue calls without a daily cap', async () => {
    await withTestClient(async (client) => {
      const repositoryClient = withNestedTransactions(client);
      const today = '2026-09-03';
      const category = await createReadingCategory(repositoryClient, `Queue ${Date.now()}`);
      const notes = [];
      for (let index = 0; index < 3; index += 1) {
        notes.push(await createReadingNote(repositoryClient, {
          categoryId: category.id,
          contentHtml: `<p>Queue note ${index}</p>`,
          notes: null,
          noteDate: today,
          today,
        }));
      }

      const firstPage = await getReadingQueuePage(repositoryClient, today, {
        categoryId: category.id,
        limit: 2,
      });
      expect(firstPage).toMatchObject({ totalPending: 3, hasMore: true });
      for (const [index, item] of firstPage.items.entries()) {
        await recordReadingAttempt(repositoryClient, {
          requestId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          noteId: item.id,
          decision: 'known',
          today,
        });
      }

      const secondPage = await getReadingQueuePage(repositoryClient, today, {
        categoryId: category.id,
        limit: 2,
      });
      expect(secondPage).toMatchObject({ totalPending: 1, hasMore: false });
      expect(secondPage.items).toHaveLength(1);
      expect(notes.map((item) => item.id)).toContain(secondPage.items[0].id);
    });
  }, 60_000);
});
