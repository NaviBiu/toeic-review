// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReviewPage from '@/app/review/page';

const listeningItem = { id: 7, term: 'revenue', meaning: '收入', example: 'Revenue rose.', notes: null };
const readingItem = {
  id: 11, categoryId: 1, categoryName: '固定搭配', contentHtml: '<p>as a result</p>',
  contentText: 'as a result', notes: null, noteDate: '2026-09-03', status: 'active',
  correctStreak: 0, correctCount: 0, wrongCount: 0, nextReviewDate: '2026-09-03', lastReviewedDate: null,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: { cancel: vi.fn(), speak: vi.fn(), getVoices: () => [], addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    lang = '';
    voice = null;
    onend: (() => void) | null = null;
    constructor(public text: string) {}
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('review route composition', () => {
  it('loads both counts together, prefetches reading, and preserves both mounted panels', async () => {
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const value = String(url);
      if (value === '/api/review/queue?') return Promise.resolve({ ok: true, json: async () => [listeningItem] } as Response);
      if (value === '/api/reading-review/count') return Promise.resolve({ ok: true, json: async () => ({ count: 1 }) } as Response);
      if (value === '/api/reading-review/queue?limit=50') return Promise.resolve({ ok: true, json: async () => ({ items: [readingItem], totalPending: 1, hasMore: false }) } as Response);
      if (value === '/api/reading-note-categories') return Promise.resolve({ ok: true, json: async () => [] } as Response);
      if (value === '/api/reading-review/attempts') return Promise.resolve({ ok: true, json: async () => ({ attempt: { id: 90, decision: 'known' }, note: readingItem }) } as Response);
      throw new Error(`Unexpected request: ${value}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(<ReviewPage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.slice(0, 2).map(([url]) => String(url))).toEqual([
      '/api/review/queue?',
      '/api/reading-review/count',
    ]);
    expect(host.textContent).toContain('听力复盘 1');
    expect(host.textContent).toContain('阅读复盘 1');

    const readingTab = [...host.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent?.includes('阅读复盘'));
    if (!readingTab) throw new Error('Reading tab not found');
    await act(async () => (readingTab as HTMLElement).click());
    expect(host.textContent).toContain('开始阅读复盘');
    expect(host.textContent).toContain('revenue');

    const start = [...host.querySelectorAll('button')].find((item) => item.textContent === '开始阅读复盘');
    if (!start) throw new Error('Reading start button not found');
    await act(async () => start.click());
    const known = [...host.querySelectorAll('button')].find((item) => item.textContent === '知道');
    if (!known) throw new Error('Known button not found');
    await act(async () => known.click());
    expect(host.textContent).toContain('阅读复盘 0');
  });
});
