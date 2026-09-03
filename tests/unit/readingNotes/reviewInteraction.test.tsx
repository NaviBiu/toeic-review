// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReadingReview from '@/components/readingNotes/ReadingReview';
import type { ReadingNote, ReadingQueuePage } from '@/lib/readingNotes/types';

const first: ReadingNote = {
  id: 11,
  categoryId: 1,
  categoryName: '固定搭配',
  contentHtml: '<p>as a result</p>',
  contentText: 'as a result',
  notes: '表示结果关系',
  noteDate: '2026-09-03',
  status: 'active',
  correctStreak: 0,
  correctCount: 0,
  wrongCount: 0,
  nextReviewDate: '2026-09-03',
  lastReviewedDate: null,
};

const second: ReadingNote = {
  ...first,
  id: 12,
  contentHtml: '<p>therefore</p>',
  contentText: 'therefore',
};

let host: HTMLDivElement;
let root: Root;

function page(items: ReadingNote[], totalPending = items.length): ReadingQueuePage {
  return { items, totalPending, hasMore: false };
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

function button(name: string) {
  const match = [...host.querySelectorAll('button')].find((item) => (
    item.textContent?.trim() === name || item.getAttribute('aria-label') === name
  ));
  if (!match) throw new Error(`Button not found: ${name}`);
  return match as HTMLButtonElement;
}

async function render(prefetched: ReadingQueuePage) {
  await act(async () => root.render(<ReadingReview mode="study" prefetched={prefetched} />));
}

async function click(target: HTMLElement) {
  await act(async () => target.click());
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal('crypto', { randomUUID: vi.fn()
    .mockReturnValueOnce('5a8c5b91-c122-4aae-8ee2-09b9cc12d880')
    .mockReturnValueOnce('bb8a0f99-ea40-4eaa-bdec-e0796611b419')
    .mockReturnValue('c88b693f-f049-4e97-9bd4-c78c41cb9968') });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reading review interaction', () => {
  it('starts explicitly, advances immediately, and corrects the previous result', async () => {
    let attempt = 100;
    vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/reading-note-categories') return Promise.resolve(jsonResponse([]));
      if (init?.method === 'POST') {
        const payload = JSON.parse(String(init.body));
        return Promise.resolve(jsonResponse({ attempt: { id: attempt++, decision: payload.decision }, note: first }));
      }
      if (init?.method === 'PATCH') return Promise.resolve(jsonResponse({ attempt: { id: 100, decision: 'known' }, note: first }));
      throw new Error(`Unexpected request: ${url}`);
    }));

    await render(page([first, second]));
    expect(button('开始阅读复盘')).toBeTruthy();
    expect(host.textContent).not.toContain('知道');

    await click(button('开始阅读复盘'));
    expect(host.textContent).toContain('as a result');
    await click(button('不知道'));
    expect(host.textContent).toContain('上一条：不知道');
    expect(host.textContent).toContain('therefore');

    await act(async () => Promise.resolve());
    await click(button('修改上一条结果'));
    expect(host.textContent).toContain('上一条：知道');
  });

  it('returns unknown notes after later notes and keeps the zero state correctable', async () => {
    let attempt = 200;
    vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/reading-note-categories') return Promise.resolve(jsonResponse([]));
      const payload = JSON.parse(String(init?.body));
      if (init?.method === 'PATCH') return Promise.resolve(jsonResponse({ attempt: { id: 202, decision: payload.decision }, note: first }));
      return Promise.resolve(jsonResponse({ attempt: { id: attempt++, decision: payload.decision }, note: first }));
    }));

    await render(page([first, second]));
    await click(button('开始阅读复盘'));
    await click(button('不知道'));
    await act(async () => Promise.resolve());
    await click(button('知道'));
    await act(async () => Promise.resolve());
    expect(host.textContent).toContain('as a result');

    await click(button('知道'));
    await act(async () => Promise.resolve());
    expect(host.textContent).toContain('剩余 0 条');
    expect(button('修改上一条结果')).toBeTruthy();

    await click(button('修改上一条结果'));
    expect(host.textContent).toContain('as a result');
    expect(host.textContent).toContain('上一条：不知道');
  });

  it('restores the exact item and count after a failed decision and offers retry', async () => {
    let rejectWrite!: (reason: Error) => void;
    const pendingWrite = new Promise<Response>((_, reject) => { rejectWrite = reject; });
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/reading-note-categories') return Promise.resolve(jsonResponse([]));
      if (init?.method === 'POST') return pendingWrite;
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await render(page([first, second]));
    await click(button('开始阅读复盘'));
    await click(button('知道'));
    expect(host.textContent).toContain('therefore');

    await act(async () => {
      rejectWrite(new Error('offline'));
      await pendingWrite.catch(() => undefined);
    });
    expect(host.textContent).toContain('as a result');
    expect(host.textContent).toContain('剩余 2 条');
    expect(button('重试保存')).toBeTruthy();
  });

  it('undoes deletion back into the same queue position', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/reading-note-categories') return Promise.resolve(jsonResponse([]));
      if (init?.method === 'DELETE') return Promise.resolve(jsonResponse({ note: { ...first, status: 'deleted' }, undoToken: 'signed-token' }));
      if (init?.method === 'PATCH') return Promise.resolve(jsonResponse(first));
      throw new Error(`Unexpected request: ${url}`);
    }));

    await render(page([first, second]));
    await click(button('开始阅读复盘'));
    await click(button('永久删除'));
    expect(host.textContent).toContain('therefore');
    expect(host.textContent).toContain('已删除「as a result」');

    await click(button('撤销'));
    expect(host.textContent).toContain('as a result');
    vi.useRealTimers();
  });

  it('restores and retries a failed mastered write', async () => {
    let statusAttempt = 0;
    vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/reading-note-categories') return Promise.resolve(jsonResponse([]));
      if (init?.method === 'PATCH') {
        statusAttempt += 1;
        return Promise.resolve(statusAttempt === 1
          ? jsonResponse({ error: 'offline' }, false)
          : jsonResponse({ ...first, status: 'mastered' }));
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    await render(page([first, second]));
    await click(button('开始阅读复盘'));
    await click(button('标记为已掌握'));
    await act(async () => Promise.resolve());
    expect(host.textContent).toContain('as a result');
    expect(button('重试保存')).toBeTruthy();

    await click(button('重试保存'));
    await act(async () => Promise.resolve());
    expect(host.textContent).toContain('therefore');
    expect(statusAttempt).toBe(2);
  });
});
