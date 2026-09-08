// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Header from '@/components/Header';
import ListeningReview from '@/components/review/ListeningReview';
import ReadingReview from '@/components/readingNotes/ReadingReview';
import { WORK_MODE_STORAGE_KEY } from '@/lib/disguiseMode';
import type { ReadingNote } from '@/lib/readingNotes/types';

const note: ReadingNote = {
  id: 31,
  categoryId: 4,
  categoryName: '连接词',
  contentHtml: '<p>因此，应选择表示结果关系的连接词。</p>',
  contentText: '因此，应选择表示结果关系的连接词。',
  notes: null,
  noteDate: '2026-09-03',
  status: 'active',
  correctStreak: 0,
  correctCount: 0,
  wrongCount: 0,
  nextReviewDate: '2026-09-03',
  lastReviewedDate: null,
};

const listeningItem = {
  id: 7,
  term: 'revenue',
  meaning: '收入',
  example: 'Revenue increased during the quarter.',
  notes: 'Business performance vocabulary',
  part: 3,
  scenarioMajor: '一般商务',
  scenarioMinor: '会议',
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem(WORK_MODE_STORAGE_KEY, '1');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/reading-note-categories') {
      return Promise.resolve({ ok: true, json: async () => [] } as Response);
    }
    const payload = JSON.parse(String(init?.body));
    return Promise.resolve({ ok: true, json: async () => ({ attempt: { id: 91, decision: payload.decision }, note }) } as Response);
  }));
  vi.stubGlobal('crypto', { randomUUID: () => '5a8c5b91-c122-4aae-8ee2-09b9cc12d880' });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reading review work mode', () => {
  it('keeps the document shell English while preserving the original knowledge point', async () => {
    await act(async () => root.render(<><Header /><ReadingReview mode="work" prefetched={{ items: [note], totalPending: 1, hasMore: false }} /></>));
    await act(async () => Promise.resolve());

    expect(host.textContent).toContain('Study mode');
    expect(host.textContent).toContain('Open another document');
    expect(host.textContent).toContain('Daily Review Requirements');
    expect(host.textContent).toContain('Reading review');
    expect(host.querySelector('.work-review-document')?.classList).toContain('work-skin-requirements');
    expect(host.querySelector('.work-review-document > section')?.classList).toContain('work-review-document-sheet');

    const begin = [...host.querySelectorAll('button')].find((item) => item.textContent === 'Begin review');
    if (!begin) throw new Error('Begin review button not found');
    await act(async () => begin.click());

    expect(host.textContent).toContain('因此，应选择表示结果关系的连接词。');
    expect(host.textContent).toContain('Known');
    expect(host.textContent).toContain('Needs follow-up');
    expect(host.textContent).not.toMatch(/Audio|answer|Part\s*[1-7]|警告/iu);

    const known = [...host.querySelectorAll('button')].find((item) => item.textContent === 'Known');
    if (!known) throw new Error('Known button not found');
    await act(async () => known.click());
    expect(host.textContent).toContain('Previous: known');
  });

  it('uses the shared document sheet structure for listening review', async () => {
    await act(async () => root.render(<ListeningReview mode="work" prefetched={[listeningItem]} active />));
    await act(async () => Promise.resolve());

    const shell = host.querySelector('section[aria-label="Listening review"]');
    expect(shell?.classList).toContain('work-skin-requirements');
    expect(shell?.querySelector(':scope > section')?.classList).toContain('work-review-document-sheet');
  });
});
