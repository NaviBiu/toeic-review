// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ListeningMastered from '@/components/mastered/ListeningMastered';
import ReadingMastered from '@/components/readingNotes/ReadingMastered';
import type { ReadingNote } from '@/lib/readingNotes/types';

const note: ReadingNote = {
  id: 41, categoryId: 2, categoryName: '固定搭配', contentHtml: '<p>be responsible for</p>',
  contentText: 'be responsible for', notes: '后接名词或动名词', noteDate: '2026-09-03',
  status: 'mastered', correctStreak: 3, correctCount: 4, wrongCount: 1,
  nextReviewDate: null, lastReviewedDate: '2026-09-03',
};

let host: HTMLDivElement;
let root: Root;

function response(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

function button(name: string) {
  const match = [...host.querySelectorAll('button')].find((item) => (
    item.textContent?.trim() === name || item.getAttribute('aria-label') === name
  ));
  if (!match) throw new Error(`Button not found: ${name}`);
  return match as HTMLButtonElement;
}

async function render(onCountChange?: (count: number) => void) {
  await act(async () => root.render(<ReadingMastered initialPage={{ items: [note], total: 1, page: 1, pageSize: 20 }} onCountChange={onCountChange} />));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reading mastered management', () => {
  it('confirms restore, removes immediately, and returns the note to today', async () => {
    let resolveWrite!: (value: Response) => void;
    const write = new Promise<Response>((resolve) => { resolveWrite = resolve; });
    const fetchMock = vi.fn(() => write);
    vi.stubGlobal('fetch', fetchMock);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const onCountChange = vi.fn();
    await render(onCountChange);

    await act(async () => button('移回错题库').click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain('be responsible for');

    await act(async () => button('移回错题库').click());
    expect(confirm).toHaveBeenLastCalledWith('确定要把「be responsible for」移回错题库吗?它会重新进入今天的复盘队列,连续答对次数会清零。');
    expect(host.textContent).not.toContain('be responsible for');
    expect(onCountChange).toHaveBeenLastCalledWith(0);
    expect(fetchMock).toHaveBeenCalledWith('/api/reading-notes/41', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });

    await act(async () => {
      resolveWrite(response({ ...note, status: 'active' }));
      await write;
    });
  });

  it('deletes without confirmation and restores the exact mastered item through undo', async () => {
    vi.useFakeTimers();
    const confirm = vi.spyOn(window, 'confirm');
    const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => Promise.resolve(
      init?.method === 'DELETE'
        ? response({ note: { ...note, status: 'deleted' }, undoToken: 'signed-token' })
        : response(note),
    ));
    vi.stubGlobal('fetch', fetchMock);
    const onCountChange = vi.fn();
    await render(onCountChange);

    await act(async () => button('永久删除').click());
    expect(confirm).not.toHaveBeenCalled();
    expect(host.querySelector('.reading-rich-content')).toBeNull();
    expect(host.textContent).toContain('已删除「be responsible for」');
    expect(onCountChange).toHaveBeenLastCalledWith(0);

    await act(async () => button('撤销').click());
    expect(fetchMock).toHaveBeenLastCalledWith('/api/reading-notes/41', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'restore', undoToken: 'signed-token' }),
    });
    expect(host.textContent).toContain('be responsible for');
    expect(onCountChange).toHaveBeenLastCalledWith(1);
  });

  it('keeps the listening mastered count in sync after a restore', async () => {
    const onCountChange = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response({ status: 'active' }))));

    await act(async () => root.render(
      <ListeningMastered
        initialItems={[{ id: 7, term: 'revenue', meaning: '收入', part: 3, scenarioMajor: '一般商务', scenarioMinor: '会议' }]}
        onCountChange={onCountChange}
      />,
    ));
    await act(async () => button('移回错题库').click());

    expect(onCountChange).toHaveBeenLastCalledWith(0);
    expect(host.textContent).not.toContain('revenue');
  });
});
