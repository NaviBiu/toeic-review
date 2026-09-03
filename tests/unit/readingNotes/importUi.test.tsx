// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReadingImport from '@/components/readingNotes/ReadingImport';

const preview = {
  token: 'signed-preview',
  recognizedCount: 1,
  duplicateCount: 0,
  unrecognizedCount: 1,
  existingCategories: [],
  proposedCategories: ['固定搭配'],
  candidates: [{
    sourceIndex: 0,
    categoryName: '固定搭配',
    contentHtml: '<p>as a result</p>',
    contentText: 'as a result',
    notes: null,
    noteDate: '2026-09-03',
    confidence: 'high',
    issue: null,
  }],
  exceptions: [],
  aiFallbackAvailable: true,
};

let host: HTMLDivElement;
let root: Root;

function setFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('reading import UI', () => {
  it.each(['notes.pdf', 'notes.doc', 'notes.txt'])('rejects %s before fetch', async (name) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => root.render(<ReadingImport />));
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('File input not found');

    await act(async () => setFile(input, new File(['x'], name)));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain('阅读笔记批量导入仅支持 Word(.docx) 文件');
  });

  it('uploads docx once and waits for an explicit click before AI fallback', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => preview } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...preview, unrecognizedCount: 0 }) } as Response);
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => root.render(<ReadingImport />));
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('File input not found');

    await act(async () => setFile(input, new File(['PK fixture'], 'notes.docx')));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/reading-notes/import');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(fetchMock.mock.calls[0][1]?.body).toBeInstanceOf(FormData);

    const aiButton = [...host.querySelectorAll('button')].find((button) => (
      button.textContent === '使用 AI 重新解析（调用 DeepSeek 1 次）'
    ));
    if (!aiButton) throw new Error('AI fallback button not found');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => aiButton.click());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/reading-notes/import/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'signed-preview' }),
    });
  });
});
