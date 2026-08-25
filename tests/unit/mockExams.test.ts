import { describe, expect, it, vi } from 'vitest';
import type { VercelClient } from '@vercel/postgres';

import {
  getPracticeAttachment,
  getPracticeAttachments,
  listMockExams,
} from '../../src/lib/mockExams';

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
        rows: [{ id: 8, practice_session_id: 2, name: 'wrong.png', mime_type: 'image/png' }],
      });

    const records = await listMockExams({ query } as unknown as VercelClient);

    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[3][0]).not.toContain('data_url');
    expect(records).toMatchObject([
      {
        id: 2,
        section: 'reading',
        parts: [{ part: 6, correct: 14, total: 16 }],
        attachments: [{ id: 8, name: 'wrong.png', mimeType: 'image/png' }],
      },
      { id: 1, section: 'listening', parts: [{ part: 2, correct: 22, total: 25 }] },
    ]);
    expect(records[0].attachments[0]).not.toHaveProperty('dataUrl');
  });

  it('loads full attachment data only for the requested practice record', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{
        id: 8,
        practice_session_id: 2,
        name: 'wrong.png',
        mime_type: 'image/png',
        data_url: 'data:image/png;base64,dGVzdA==',
      }],
    });

    await expect(getPracticeAttachments(
      { query } as unknown as VercelClient,
      2,
    )).resolves.toEqual([{
      id: 8,
      name: 'wrong.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,dGVzdA==',
    }]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('practice_session_id = $1'), [2]);
  });

  it('loads one attachment only when it belongs to the requested record', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{
        id: 8,
        practice_session_id: 2,
        name: 'wrong.png',
        mime_type: 'image/png',
        data_url: 'data:image/png;base64,dGVzdA==',
      }],
    });

    await expect(getPracticeAttachment(
      { query } as unknown as VercelClient,
      2,
      8,
    )).resolves.toMatchObject({ id: 8, mimeType: 'image/png' });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('practice_session_id = $1 AND id = $2'),
      [2, 8],
    );
  });
});
