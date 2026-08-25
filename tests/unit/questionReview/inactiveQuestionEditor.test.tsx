// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Part5Workspace from '@/components/part5/Part5Workspace';
import QuestionEditorModal from '@/components/part5/QuestionEditorModal';
import type { CategoryNode, QuestionListItem } from '@/lib/questionReview/types';

const emptyStats = {
  total: 0,
  learningCount: 0,
  masteredCount: 0,
  attempted: 0,
  unattempted: 0,
  latestCorrect: 0,
  accuracy: null,
};

const activeCategories: CategoryNode[] = [{
  id: 1,
  section: 'reading',
  part: 5,
  parentId: null,
  name: '语法',
  isDefault: false,
  status: 'active',
  sortOrder: 0,
  stats: emptyStats,
  children: [{
    id: 11,
    section: 'reading',
    part: 5,
    parentId: 1,
    name: '时态',
    isDefault: false,
    status: 'active',
    sortOrder: 0,
    stats: emptyStats,
    children: [],
  }],
}];

const inactiveChildCategories: CategoryNode[] = [{
  ...activeCategories[0],
  children: [
    ...activeCategories[0].children,
    {
      ...activeCategories[0].children[0],
      id: 12,
      name: '旧分类',
      status: 'inactive',
      sortOrder: 1,
    },
  ],
}];

const inactiveParentCategories: CategoryNode[] = [
  ...activeCategories,
  {
    ...activeCategories[0],
    id: 2,
    name: '旧父分类',
    status: 'inactive',
    sortOrder: 1,
    children: [{
      ...activeCategories[0].children[0],
      id: 21,
      parentId: 2,
      name: '保留子分类',
    }],
  },
];

function question(categoryId: number): QuestionListItem {
  return {
    id: 101,
    section: 'reading',
    part: 5,
    questionFormat: 'single_choice',
    stem: 'The report is due Friday.',
    options: { A: 'is', B: 'are', C: 'be', D: 'been' },
    correctOption: 'A',
    analysis: 'Use the singular verb.',
    notes: null,
    source: null,
    categoryId,
    status: 'learning',
    categoryPath: ['旧分类', '保留分类'],
    stats: { correctCount: 0, wrongCount: 0, latestCorrect: null, latestDurationMs: null },
  };
}

let host: HTMLDivElement;
let root: Root;

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

async function render(component: React.ReactNode) {
  await act(async () => {
    root.render(component);
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function selectFor(labelText: string): HTMLSelectElement {
  const label = [...host.querySelectorAll('label')]
    .find((item) => item.textContent?.startsWith(labelText));
  const select = label?.querySelector('select');
  if (!select) throw new Error(`Select not found: ${labelText}`);
  return select;
}

async function clickSave() {
  const button = [...host.querySelectorAll('button')]
    .find((item) => item.textContent === '保存题目');
  if (!button) throw new Error('Save button not found');
  await act(async () => {
    button.click();
    await Promise.resolve();
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
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('inactive category question editing', () => {
  it('loads inactive editor categories without changing the active first-load tree', async () => {
    const editedQuestion = question(12);
    const fetchMock = vi.fn((request: RequestInfo | URL) => {
      const url = String(request);
      if (url.includes('includeInactive=true')) return Promise.resolve(jsonResponse(inactiveChildCategories));
      if (url.startsWith('/api/review-questions?')) {
        return Promise.resolve(jsonResponse({ items: [editedQuestion], total: 1 }));
      }
      return Promise.resolve(jsonResponse(activeCategories));
    });
    vi.stubGlobal('fetch', fetchMock);

    await render(<Part5Workspace />);
    await flush();
    await flush();

    const edit = [...host.querySelectorAll('button')].find((button) => button.textContent === '编辑');
    if (!edit) throw new Error('Edit button not found');
    await act(async () => edit.click());
    await flush();

    const categoryRequests = fetchMock.mock.calls
      .map(([request]) => String(request))
      .filter((url) => url.startsWith('/api/question-categories'));
    expect(categoryRequests[0]).toBe('/api/question-categories?section=reading&part=5');
    expect(categoryRequests).toContain('/api/question-categories?section=reading&part=5&includeInactive=true');
    expect(selectFor('二级分类').value).toBe('12');
  });

  it('preserves and labels an inactive child category when saving', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(question(12))));
    vi.stubGlobal('fetch', fetchMock);

    await render(<QuestionEditorModal
      questionId={101}
      initialQuestion={question(12)}
      categories={inactiveChildCategories}
      open
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />);

    const childSelect = selectFor('二级分类');
    const inactiveOption = childSelect.querySelector<HTMLOptionElement>('option[value="12"]');
    expect(childSelect.value).toBe('12');
    expect(inactiveOption?.textContent).toContain('已停用');
    expect(inactiveOption?.disabled).toBe(true);

    await clickSave();

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ categoryId: 12 });
  });

  it('preserves and labels a child whose parent is inactive', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(question(21))));
    vi.stubGlobal('fetch', fetchMock);

    await render(<QuestionEditorModal
      questionId={101}
      initialQuestion={question(21)}
      categories={inactiveParentCategories}
      open
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />);

    const parentSelect = selectFor('一级分类');
    const childSelect = selectFor('二级分类');
    const inactiveParent = parentSelect.querySelector<HTMLOptionElement>('option[value="2"]');
    const retainedChild = childSelect.querySelector<HTMLOptionElement>('option[value="21"]');

    expect(parentSelect.value).toBe('2');
    expect(inactiveParent?.textContent).toContain('已停用');
    expect(inactiveParent?.disabled).toBe(true);
    expect(childSelect.value).toBe('21');
    expect(retainedChild?.textContent).toContain('父分类已停用');
    expect(retainedChild?.disabled).toBe(true);

    await clickSave();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ categoryId: 21 });
  });
});
