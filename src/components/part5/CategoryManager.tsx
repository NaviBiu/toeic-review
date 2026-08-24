'use client';

import { useState } from 'react';
import type { CategoryNode } from '@/lib/questionReview/types';

type CategoryAction = 'rename' | 'move' | 'deactivate' | 'delete' | 'merge' | 'create';

function categoryLabel(category: CategoryNode) {
  return category.parentId === null ? category.name : category.name;
}

function categoryPath(category: CategoryNode, parents: CategoryNode[]) {
  if (category.parentId === null) return category.name;
  const parent = parents.find((item) => item.id === category.parentId);
  return parent ? `${parent.name} / ${category.name}` : category.name;
}

async function requestCategory(path: string, init: RequestInit) {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? '分类保存失败，请重试');
  return body;
}

export default function CategoryManager({
  categories,
  onChanged,
}: {
  categories: CategoryNode[];
  onChanged: () => void;
}) {
  const [inactiveCategories, setInactiveCategories] = useState<CategoryNode[] | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [selectedParentId, setSelectedParentId] = useState<number | null>(categories[0]?.id ?? null);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [movingId, setMovingId] = useState<number | null>(null);
  const [moveTargetId, setMoveTargetId] = useState<number | null>(null);
  const [mergeSourceId, setMergeSourceId] = useState<number | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);
  const [mergeConfirmation, setMergeConfirmation] = useState('');
  const [busyAction, setBusyAction] = useState<CategoryAction | null>(null);
  const [error, setError] = useState('');

  const managedCategories = showInactive ? inactiveCategories ?? categories : categories;
  const parents = managedCategories.filter((category) => category.parentId === null);
  const selectedParent = parents.find((category) => category.id === selectedParentId) ?? parents[0] ?? null;
  const children = selectedParent?.children ?? [];
  const allCategories = parents.flatMap((parent) => [parent, ...parent.children]);
  const mergeSource = allCategories.find((category) => category.id === mergeSourceId) ?? null;
  const mergeTarget = allCategories.find((category) => category.id === mergeTargetId) ?? null;
  const mergePhrase = mergeSource && mergeTarget ? `${categoryPath(mergeSource, parents)} -> ${categoryPath(mergeTarget, parents)}` : '';

  async function reload(includeInactive = showInactive) {
    const response = await fetch(`/api/question-categories?section=reading&part=5&includeInactive=${includeInactive}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? '分类加载失败，请重试');
    if (includeInactive) setInactiveCategories(body as CategoryNode[]);
  }

  async function handleInactiveToggle(nextValue: boolean) {
    setShowInactive(nextValue);
    setError('');
    if (!nextValue) {
      return;
    }
    try {
      await reload(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '分类加载失败，请重试');
    }
  }

  async function afterMutation() {
    await reload();
    onChanged();
  }

  async function createCategory(parentId: number | null) {
    const name = newName.trim();
    if (!name) {
      setError('请输入分类名称');
      return;
    }
    setBusyAction('create');
    setError('');
    try {
      await requestCategory('/api/question-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'reading', part: 5, parentId, name }),
      });
      setNewName('');
      await afterMutation();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '分类保存失败，请重试');
    } finally {
      setBusyAction(null);
    }
  }

  async function updateCategory(id: number, fields: Record<string, unknown>, action: CategoryAction) {
    setBusyAction(action);
    setError('');
    try {
      await requestCategory(`/api/question-categories/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      setEditingId(null);
      setMovingId(null);
      await afterMutation();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '分类保存失败，请重试');
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteCategory(id: number) {
    setBusyAction('delete');
    setError('');
    try {
      await requestCategory(`/api/question-categories/${id}`, { method: 'DELETE' });
      await afterMutation();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '分类删除失败，请重试');
    } finally {
      setBusyAction(null);
    }
  }

  async function mergeCategories() {
    if (!mergeSource || !mergeTarget || mergeSource.id === mergeTarget.id) {
      setError('请选择两个不同的分类');
      return;
    }
    if (mergeSource.parentId !== mergeTarget.parentId) {
      setError('只能合并同一层级的分类');
      return;
    }
    if (mergeConfirmation !== mergePhrase) {
      setError('请输入完整的合并确认名称');
      return;
    }
    setBusyAction('merge');
    setError('');
    try {
      await requestCategory(`/api/question-categories/${mergeSource.id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: mergeTarget.id }),
      });
      setMergeSourceId(null);
      setMergeTargetId(null);
      setMergeConfirmation('');
      await afterMutation();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '分类合并失败，请重试');
    } finally {
      setBusyAction(null);
    }
  }

  function beginRename(category: CategoryNode) {
    setEditingId(category.id);
    setEditingName(category.name);
    setError('');
  }

  function renderCategoryRow(category: CategoryNode) {
    const isEditing = editingId === category.id;
    const isMoving = movingId === category.id;
    const mutable = !category.isDefault;
    return (
      <li className="border-b border-stone-200 px-3 py-3 last:border-b-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            {isEditing ? (
              <input
                autoFocus
                value={editingName}
                onChange={(event) => setEditingName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void updateCategory(category.id, { name: editingName }, 'rename');
                  if (event.key === 'Escape') setEditingId(null);
                }}
                className="w-full max-w-60 rounded-md border border-stone-400 bg-white px-2 py-1 text-sm text-stone-900"
                aria-label="分类名称"
              />
            ) : (
              <p className="truncate text-sm font-medium text-stone-900">{categoryLabel(category)}</p>
            )}
            <p className="mt-0.5 text-xs text-stone-500">{category.stats.total} 题 {category.status === 'inactive' ? '· 已停用' : ''}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium">
            {isEditing ? (
              <>
                <button type="button" onClick={() => void updateCategory(category.id, { name: editingName }, 'rename')} disabled={busyAction !== null} className="text-stone-900 hover:text-stone-600 disabled:text-stone-400">保存</button>
                <button type="button" onClick={() => setEditingId(null)} disabled={busyAction !== null} className="text-stone-600 hover:text-stone-900 disabled:text-stone-400">取消</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => beginRename(category)} disabled={!mutable || busyAction !== null} className="text-stone-600 hover:text-stone-900 disabled:text-stone-300">重命名</button>
                {category.parentId !== null ? <button type="button" onClick={() => { setMovingId(category.id); setMoveTargetId(category.parentId); }} disabled={!mutable || busyAction !== null} className="text-stone-600 hover:text-stone-900 disabled:text-stone-300">移动</button> : null}
                <button type="button" onClick={() => void updateCategory(category.id, { status: category.status === 'active' ? 'inactive' : 'active' }, 'deactivate')} disabled={!mutable || busyAction !== null} className="text-stone-600 hover:text-stone-900 disabled:text-stone-300">{category.status === 'active' ? '停用' : '启用'}</button>
                <button type="button" onClick={() => void deleteCategory(category.id)} disabled={!mutable || busyAction !== null} className="text-red-700 hover:text-red-900 disabled:text-stone-300">删除</button>
              </>
            )}
          </div>
        </div>
        {isMoving ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
            <label className="text-xs text-stone-600" htmlFor={`move-${category.id}`}>移动至</label>
            <select id={`move-${category.id}`} value={moveTargetId ?? ''} onChange={(event) => setMoveTargetId(Number(event.target.value))} className="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-stone-800">
              {parents.filter((parent) => parent.status === 'active').map((parent) => <option key={parent.id} value={parent.id}>{parent.name}</option>)}
            </select>
            <button type="button" onClick={() => moveTargetId !== null && void updateCategory(category.id, { parentId: moveTargetId }, 'move')} disabled={busyAction !== null} className="rounded-md bg-stone-800 px-3 py-1 text-xs font-medium text-white disabled:bg-stone-300">确认</button>
            <button type="button" onClick={() => setMovingId(null)} disabled={busyAction !== null} className="text-xs font-medium text-stone-600 hover:text-stone-900">取消</button>
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <section aria-labelledby="category-manager-title">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-300 pb-3">
        <div>
          <h2 id="category-manager-title" className="text-base font-semibold text-stone-900">分类管理</h2>
          <p className="mt-1 text-sm text-stone-500">一级分类和其二级分类在同一工作区维护。</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={showInactive} onChange={(event) => void handleInactiveToggle(event.target.checked)} className="h-4 w-4 rounded border-stone-300 text-stone-800 focus:ring-stone-500" />
          显示已停用分类
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-b border-stone-200 pb-4">
        <label className="sr-only" htmlFor="new-category-name">新分类名称</label>
        <input id="new-category-name" value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createCategory(selectedParent ? selectedParent.id : null); }} placeholder="新分类名称" className="min-w-52 flex-1 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900" />
        <button type="button" onClick={() => void createCategory(null)} disabled={busyAction !== null} className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-100 disabled:text-stone-400">新建一级</button>
        <button type="button" onClick={() => selectedParent && void createCategory(selectedParent.id)} disabled={!selectedParent || selectedParent.status !== 'active' || busyAction !== null} className="rounded-md bg-stone-800 px-3 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:bg-stone-300">添加至当前分类</button>
      </div>

      {error ? <p role="alert" className="mt-3 border-l-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.2fr)]">
        <div className="border border-stone-200 bg-white">
          <p className="border-b border-stone-200 px-3 py-2 text-xs font-medium text-stone-500">一级分类</p>
          <ul>
            {parents.map((parent) => (
              <li key={parent.id}>
                <button type="button" onClick={() => setSelectedParentId(parent.id)} className={`flex w-full items-center justify-between gap-3 border-b border-stone-200 px-3 py-3 text-left text-sm last:border-b-0 ${selectedParent?.id === parent.id ? 'bg-stone-100 text-stone-950' : 'text-stone-700 hover:bg-stone-50'}`}>
                  <span className="truncate font-medium">{parent.name}</span>
                  <span className="shrink-0 font-mono text-xs text-stone-500">{parent.stats.total}</span>
                </button>
              </li>
            ))}
            {parents.length === 0 ? <li className="px-3 py-6 text-sm text-stone-500">暂无分类</li> : null}
          </ul>
        </div>
        <div className="border border-stone-200 bg-white">
          <div className="flex items-center justify-between border-b border-stone-200 px-3 py-2">
            <p className="text-xs font-medium text-stone-500">{selectedParent ? `${selectedParent.name} 的二级分类` : '二级分类'}</p>
            {selectedParent ? <div className="text-xs text-stone-500">{selectedParent.stats.total} 题</div> : null}
          </div>
          <ul>{children.map(renderCategoryRow)}</ul>
          {selectedParent && children.length === 0 ? <p className="px-3 py-6 text-sm text-stone-500">暂无二级分类</p> : null}
          {selectedParent ? <div className="border-t border-stone-200">{renderCategoryRow(selectedParent)}</div> : null}
        </div>
      </div>

      <div className="mt-5 border-t border-stone-300 pt-4">
        <h3 className="text-sm font-semibold text-stone-900">合并分类</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-stone-700">来源分类
            <select value={mergeSourceId ?? ''} onChange={(event) => { setMergeSourceId(event.target.value ? Number(event.target.value) : null); setMergeConfirmation(''); }} className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800">
              <option value="">请选择</option>
              {allCategories.filter((category) => !category.isDefault).map((category) => <option key={category.id} value={category.id}>{categoryPath(category, parents)}</option>)}
            </select>
          </label>
          <label className="text-sm text-stone-700">目标分类
            <select value={mergeTargetId ?? ''} onChange={(event) => { setMergeTargetId(event.target.value ? Number(event.target.value) : null); setMergeConfirmation(''); }} className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800">
              <option value="">请选择</option>
              {allCategories.filter((category) => category.status === 'active' && category.id !== mergeSourceId).map((category) => <option key={category.id} value={category.id}>{categoryPath(category, parents)}</option>)}
            </select>
          </label>
        </div>
        {mergePhrase ? <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="min-w-60 flex-1 text-sm text-stone-700">输入 “{mergePhrase}” 确认
            <input value={mergeConfirmation} onChange={(event) => setMergeConfirmation(event.target.value)} className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900" />
          </label>
          <button type="button" onClick={() => void mergeCategories()} disabled={busyAction !== null || mergeConfirmation !== mergePhrase} className="rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:bg-stone-300">合并</button>
        </div> : null}
      </div>
    </section>
  );
}
