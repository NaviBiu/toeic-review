import { describe, expect, it, vi } from 'vitest';
import type { VercelClient } from '@vercel/postgres';

import { listMockExams, resolvePracticeAttachmentInputs } from '../../src/lib/mockExams';

describe('listMockExams', () => {
  it('loads all record details with four queries instead of querying per record', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [
          { id: 2, practice_date: '2026-08-11', section: 'reading', type: 'part_drill', title: 'P6', notes: null },
          { id: 1, practice_date: '2026-08-10', section: 'listening', type: 'part_drill', title: 'P2', notes: null },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { practice_session_id: 1, part: 2, correct: 22, total: 25 },
          { practice_session_id: 2, part: 6, correct: 14, total: 16 },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { id: 9, practice_session_id: 1, name: 'wrong.png', mime_type: 'image/png' },
        ],
      });

    const records = await listMockExams({ query } as unknown as VercelClient);

    expect(query).toHaveBeenCalledTimes(4);
    expect(records).toMatchObject([
      { id: 2, section: 'reading', parts: [{ part: 6, correct: 14, total: 16 }] },
      {
        id: 1,
        section: 'listening',
        parts: [{ part: 2, correct: 22, total: 25 }],
        attachments: [{ id: 9, name: 'wrong.png', mimeType: 'image/png', dataUrl: '/api/mock-exams/attachments/9' }],
      },
    ]);
    expect(String(query.mock.calls[3][0])).not.toContain('data_url');
  });

  it('resolves lightweight attachment URLs only when attachments are edited', async () => {
    const storedDataUrl = 'data:image/png;base64,aGVsbG8=';
    const query = vi.fn().mockResolvedValue({
      rows: [{ id: 9, name: 'wrong.png', mime_type: 'image/png', data_url: storedDataUrl }],
    });

    const resolved = await resolvePracticeAttachmentInputs(
      { query } as unknown as VercelClient,
      1,
      [
        { name: 'wrong.png', mimeType: 'image/png', dataUrl: '/api/mock-exams/attachments/9' },
        { name: 'new.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,bmV3' },
      ],
    );

    expect(resolved).toEqual([
      { name: 'wrong.png', mimeType: 'image/png', dataUrl: storedDataUrl },
      { name: 'new.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,bmV3' },
    ]);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
