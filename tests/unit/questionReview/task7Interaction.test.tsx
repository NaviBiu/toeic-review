// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CategoryManager from '@/components/part5/CategoryManager';
import TrainingSession from '@/components/part5/TrainingSession';
import type { AttemptResult, CategoryNode, SessionQuestion } from '@/lib/questionReview/types';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const categories: CategoryNode[] = [
  {
    id: 1,
    section: 'reading',
    part: 5,
    parentId: null,
    name: '语法',
    isDefault: false,
    status: 'active',
    sortOrder: 0,
    stats: { total: 2, learningCount: 2, masteredCount: 0, attempted: 0, unattempted: 2, latestCorrect: 0, accuracy: null },
    children: [{
      id: 11,
      section: 'reading',
      part: 5,
      parentId: 1,
      name: '来源分类',
      isDefault: false,
      status: 'active',
      sortOrder: 0,
      stats: { total: 1, learningCount: 1, masteredCount: 0, attempted: 0, unattempted: 1, latestCorrect: 0, accuracy: null },
      children: [],
    }],
  },
  {
    id: 2,
    section: 'reading',
    part: 5,
    parentId: null,
    name: '词汇',
    isDefault: false,
    status: 'active',
    sortOrder: 1,
    stats: { total: 1, learningCount: 1, masteredCount: 0, attempted: 0, unattempted: 1, latestCorrect: 0, accuracy: null },
    children: [{
      id: 21,
      section: 'reading',
      part: 5,
      parentId: 2,
      name: '目标分类',
      isDefault: false,
      status: 'active',
      sortOrder: 0,
      stats: { total: 1, learningCount: 1, masteredCount: 0, attempted: 0, unattempted: 1, latestCorrect: 0, accuracy: null },
      children: [],
    }],
  },
];

const question: SessionQuestion = {
  id: 101,
  position: 1,
  stem: 'The report is due Friday.',
  options: { A: 'is', B: 'are', C: 'be', D: 'been' },
  source: null,
  categoryPath: ['语法', '时态'],
  stats: { correctCount: 0, wrongCount: 0, latestCorrect: null, latestDurationMs: null },
};

const attemptResult: AttemptResult = {
  attemptId: 501,
  isCorrect: true,
  correctOption: 'A',
  analysis: 'Use the singular verb.',
  notes: null,
  durationMs: 1200,
  durationExcluded: false,
  stats: { correctCount: 3, wrongCount: 2, latestCorrect: true, latestDurationMs: 1200 },
};

let host: HTMLDivElement;
let root: Root;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

function emptyResponse(): Response {
  return { ok: true, json: async () => { throw new Error('No content'); } } as Response;
}

function buttonByText(text: string, scope: ParentNode = host): HTMLButtonElement {
  const button = [...scope.querySelectorAll('button')].find((item) => item.textContent === text);
  if (!button) throw new Error('Button not found: ' + text);
  return button;
}

function buttonStartingWith(text: string, scope: ParentNode = host): HTMLButtonElement {
  const button = [...scope.querySelectorAll('button')].find((item) => item.textContent?.startsWith(text));
  if (!button) throw new Error('Button not found: ' + text);
  return button;
}

async function render(component: React.ReactNode) {
  await act(async () => {
    root.render(component);
  });
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

async function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal('crypto', { randomUUID: () => '5a8c5b91-c122-4aae-8ee2-09b9cc12d880' });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Task 7 component interactions', () => {
  it('creates a first-level category from its dedicated form', async () => {
    const onChanged = vi.fn();
    const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
      return Promise.resolve(init?.method === 'POST'
        ? jsonResponse({ category: { id: 3, name: '固定搭配', parentId: null }, categories })
        : jsonResponse(categories));
    });
    vi.stubGlobal('fetch', fetchMock);

    await render(<CategoryManager categories={categories} onChanged={onChanged} />);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="一级分类名称"]');
    if (!input) throw new Error('First-level category input not found');

    await setValue(input, '固定搭配');
    await click(buttonByText('新增一级分类'));

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/question-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'reading', part: 5, parentId: null, name: '固定搭配', includeInactive: false }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith(categories);
  });

  it('creates a second-level category under the explicitly selected parent', async () => {
    const onChanged = vi.fn();
    const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
      return Promise.resolve(init?.method === 'POST'
        ? jsonResponse({ category: { id: 22, name: '词义辨析', parentId: 2 }, categories })
        : jsonResponse(categories));
    });
    vi.stubGlobal('fetch', fetchMock);

    await render(<CategoryManager categories={categories} onChanged={onChanged} />);
    const parentSelect = host.querySelector<HTMLSelectElement>('select[aria-label="二级分类所属一级分类"]');
    const input = host.querySelector<HTMLInputElement>('input[aria-label="二级分类名称"]');
    if (!parentSelect || !input) throw new Error('Second-level category form not found');

    await setValue(parentSelect, '2');
    await setValue(input, '词义辨析');
    await click(buttonByText('新增二级分类'));

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/question-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'reading', part: 5, parentId: 2, name: '词义辨析', includeInactive: false }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith(categories);
  });

  it('renders cumulative question stats after the answer POST resolves and only then permits exit', async () => {
    const pendingPost = deferred<Response>();
    const fetchMock = vi.fn(() => pendingPost.promise);
    const onExit = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await render(<TrainingSession session={{ id: 7, actualCount: 1, questions: [question] }} onExit={onExit} />);

    const selectedOption = buttonStartingWith('A');
    await click(selectedOption);
    const abandon = buttonByText('放弃本次训练');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(abandon.disabled).toBe(true);
    expect(selectedOption.className).toContain('bg-stone-100');

    await click(abandon);
    expect(onExit).not.toHaveBeenCalled();

    await act(async () => {
      pendingPost.resolve(jsonResponse(attemptResult));
      await pendingPost.promise;
    });

    expect(host.textContent).toContain('本题累计：正确 3，错误 2');
    expect(abandon.disabled).toBe(false);

    await click(abandon);
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('waits for named irreversible confirmation before deleting an empty category', async () => {
    const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
      return Promise.resolve(init?.method === 'DELETE' ? emptyResponse() : jsonResponse(categories));
    });
    vi.stubGlobal('fetch', fetchMock);

    await render(<CategoryManager categories={categories} onChanged={vi.fn()} />);
    const sourceName = [...host.querySelectorAll('p')].find((item) => item.textContent === '来源分类');
    if (!sourceName) throw new Error('Source category name not found');
    const sourceRow = sourceName.closest('li');
    if (!sourceRow) throw new Error('Source category row not found');

    await click(buttonByText('删除', sourceRow));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain('确认删除“来源分类”？此操作无法撤销。');

    await click(buttonByText('删除“来源分类”'));
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/question-categories/11', { method: 'DELETE' });
  });

  it('sends a child merge request across different parents after named confirmation', async () => {
    const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
      return Promise.resolve(init?.method === 'POST' ? jsonResponse({}) : jsonResponse(categories));
    });
    vi.stubGlobal('fetch', fetchMock);

    await render(<CategoryManager categories={categories} onChanged={vi.fn()} />);
    const sourceSelect = host.querySelector<HTMLSelectElement>('select[aria-label="合并来源分类"]');
    const targetSelect = host.querySelector<HTMLSelectElement>('select[aria-label="合并目标分类"]');
    if (!sourceSelect || !targetSelect) throw new Error('Merge category selects not found');
    await setValue(sourceSelect, '11');
    await setValue(targetSelect, '21');

    const textInputs = [...host.querySelectorAll('input')].filter((item) => item.type === 'text');
    await setValue(textInputs[textInputs.length - 1], '语法 / 来源分类 -> 词汇 / 目标分类');
    await click(buttonByText('合并'));

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/question-categories/11/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId: 21 }),
    });
  });
});
