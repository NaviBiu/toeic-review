import { describe, it, expect, vi, afterEach } from 'vitest';
import { sql } from '../../src/lib/db';

vi.mock('@/lib/importParser', () => ({
  parseImportDocument: vi.fn(async () => [{
    term: 'workshop', meaning: '研讨会', example: 'ex', notes: null, part: 2,
    dateAdded: '2026-06-23', scenarioMajor: '一般商务', scenarioMinor: '会议',
    scenarioWasSanitized: false, meaningWasAiGenerated: false, exampleWasAiGenerated: false,
  }]),
}));

// Keep the real validateUpload (extension/size guard) but fake the actual binary
// parsing, since a real .pdf/.docx can't be embedded inline in this test file.
vi.mock('@/lib/fileExtract', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/fileExtract')>('../../src/lib/fileExtract');
  return {
    ...actual,
    extractText: vi.fn(async (filename: string, buffer: Buffer) => {
      actual.validateUpload(filename, buffer.byteLength);
      return 'fake raw text';
    }),
  };
});

const { POST: importRoute } = await import('../../src/app/api/knowledge-points/import/route');
const { POST: confirmRoute } = await import('../../src/app/api/knowledge-points/import/confirm/route');
const { NextRequest } = await import('next/server');

let createdIds: number[] = [];
afterEach(async () => {
  if (createdIds.length) {
    await sql.query('DELETE FROM knowledge_points WHERE id = ANY($1)', [createdIds]);
    createdIds = [];
  }
});

describe('POST /api/knowledge-points/import', () => {
  it('rejects an unsupported file extension before the parser ever runs', async () => {
    const form = new FormData();
    form.append('file', new File(['hello'], 'notes.txt'));
    const req = new NextRequest(new Request('http://localhost/api/knowledge-points/import', { method: 'POST', body: form }));
    const res = await importRoute(req);
    expect(res.status).toBe(400);
  });

  it('returns candidates annotated with an insert_new decision when nothing matches yet', async () => {
    const form = new FormData();
    form.append('file', new File(['Part2 短问答\n时间:2026.06.23\n1. workshop 研讨会'], 'notes.docx'));
    const req = new NextRequest(new Request('http://localhost/api/knowledge-points/import', { method: 'POST', body: form }));
    const res = await importRoute(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.candidates[0].decision).toEqual({ action: 'insert_new' });
    expect(body.candidates[0].existingId).toBeNull();
  });
});

describe('POST /api/knowledge-points/import/confirm', () => {
  it('writes successful items and reports a per-item error without rolling back the others', async () => {
    const req = new NextRequest(new Request('http://localhost/api/knowledge-points/import/confirm', {
      method: 'POST',
      body: JSON.stringify({
        items: [
          { term: 'a', meaning: 'm', example: 'e', notes: null, part: 1, dateAdded: '2026-06-26', scenarioMajor: '未分类', scenarioMinor: '未分类', decision: { action: 'insert_new' }, existingId: null },
          { term: 'b', meaning: 'm', example: 'e', notes: null, part: 1, dateAdded: '2026-06-26', scenarioMajor: '未分类', scenarioMinor: '未分类', decision: { action: 'wrong_again', reviveFromMastered: false, textConflict: false }, existingId: null },
        ],
      }),
    }));
    const res = await confirmRoute(req);
    const body = await res.json();
    expect(body.results[0].action).toBe('inserted');
    createdIds.push(body.results[0].id);
    expect(body.results[1].action).toBe('error'); // existingId null + wrong_again is invalid input, should error not throw
  });
});
