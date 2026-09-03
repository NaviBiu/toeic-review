import { describe, expect, it, vi } from 'vitest';
import {
  buildReadingImportPreview,
  confirmReadingImport,
  verifyReadingImportToken,
} from '@/lib/readingNotes/importConfirm';
import { hashReadingText } from '@/lib/readingNotes/richContent.server';
import type { ReadingImportCandidate } from '@/lib/readingNotes/types';

function candidate(
  sourceIndex: number,
  categoryName: string,
  content: string,
  confidence: 'high' | 'low' = 'high',
): ReadingImportCandidate {
  return {
    sourceIndex,
    categoryName,
    contentHtml: `<p>${content}</p>`,
    contentText: content.toLocaleLowerCase('en-US'),
    notes: null,
    noteDate: '2026-09-03',
    confidence,
    issue: confidence === 'low' ? '无法识别结构' : null,
  };
}

describe('reading import preview', () => {
  it('separates recognized, duplicate, and capped exception candidates without writes', async () => {
    const candidates = [
      candidate(0, '固定搭配', 'existing phrase'),
      candidate(1, '固定搭配', 'new phrase'),
      candidate(2, '高频商务词汇', 'invoice'),
      candidate(3, '高频商务词汇', 'shipment'),
      ...Array.from({ length: 6 }, (_, index) => (
        candidate(index + 4, '固定搭配', `unclear ${index}`, 'low')
      )),
    ];
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{ id: 3, name: '固定搭配', normalized_name: '固定搭配' }],
      })
      .mockResolvedValueOnce({
        rows: [{ normalized_name: '固定搭配', content_hash: hashReadingText('existing phrase') }],
      });

    const preview = await buildReadingImportPreview(
      { query } as never,
      candidates,
      'preview-secret',
      1_000,
    );

    expect(preview).toMatchObject({
      recognizedCount: 3,
      duplicateCount: 1,
      unrecognizedCount: 6,
      existingCategories: ['固定搭配'],
      proposedCategories: ['高频商务词汇'],
      aiFallbackAvailable: true,
    });
    expect(preview.exceptions).toHaveLength(5);
    expect(preview.candidates.map((item) => item.sourceIndex)).toEqual([1, 2, 3]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql))).toBe(true);

    const payload = verifyReadingImportToken(preview.token, 'preview-secret', 1_001);
    expect(payload.candidates).toHaveLength(10);
  });

  it('does not treat identical content in another category as a duplicate', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{ id: 3, name: '固定搭配', normalized_name: '固定搭配' }],
      })
      .mockResolvedValueOnce({
        rows: [{ normalized_name: '固定搭配', content_hash: hashReadingText('same content') }],
      });
    const preview = await buildReadingImportPreview(
      { query } as never,
      [candidate(0, '商务词汇', 'same content')],
      'preview-secret',
    );

    expect(preview.duplicateCount).toBe(0);
    expect(preview.recognizedCount).toBe(1);
    expect(preview.proposedCategories).toEqual(['商务词汇']);
  });

  it('rolls back category creation when the bulk note insert fails', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FOR UPDATE')) return { rows: [] };
      if (sql.includes('INSERT INTO reading_note_categories')) return { rows: [{ id: 8 }] };
      if (sql.includes('SELECT id, normalized_name')) {
        return { rows: [{ id: 8, normalized_name: '高频商务词汇' }] };
      }
      if (sql.includes('SELECT category_id, content_hash')) return { rows: [] };
      if (sql.includes('INSERT INTO reading_notes')) throw new Error('forced bulk insert failure');
      return { rows: [] };
    });

    await expect(confirmReadingImport({ query } as never, {
      candidates: [candidate(0, '高频商务词汇', 'invoice')],
      acceptedSourceIndexes: [0],
      today: '2026-09-03',
    })).rejects.toThrow('forced bulk insert failure');

    expect(query.mock.calls[0][0]).toBe('BEGIN');
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
});
