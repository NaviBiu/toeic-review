// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ListeningReview from '@/components/review/ListeningReview';

const item = {
  id: 7,
  term: 'as a result',
  meaning: '因此',
  example: 'As a result, sales increased.',
  notes: '结果关系',
};

let host: HTMLDivElement;
let root: Root;

function button(name: string) {
  const match = [...host.querySelectorAll('button')].find((candidate) => (
    candidate.textContent?.trim() === name || candidate.getAttribute('aria-label') === name
  ));
  if (!match) throw new Error(`Button not found: ${name}`);
  return match as HTMLButtonElement;
}

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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('listening review extraction', () => {
  it('preserves reveal, correction, persistence, and item actions', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) } as Response));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => root.render(<ListeningReview mode="study" prefetched={[item]} active />));

    expect(host.textContent).toContain('记得');
    expect(host.querySelector('.blur-md')).toBeTruthy();
    await act(async () => button('记得').click());
    expect(host.textContent).toContain('因此');
    expect(button('撤回(改选)')).toBeTruthy();
    expect(button('标记为已掌握')).toBeTruthy();
    expect(button('删除（不需要再复习）')).toBeTruthy();

    const next = [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === '→');
    if (!next) throw new Error('Next button not found');
    await act(async () => next.click());
    expect(fetchMock).toHaveBeenCalledWith('/api/review/7/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correct: true }),
    });
  });
});
