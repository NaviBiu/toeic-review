'use client';

import { useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import { parsePastedQuestion } from '@/lib/questionReview/parser';
import type { CategoryNode, QuestionListItem, QuestionOption, QuestionStatus, ReviewQuestion } from '@/lib/questionReview/types';

const options: QuestionOption[] = ['A', 'B', 'C', 'D'];
const statuses: QuestionStatus[] = ['learning', 'mastered', 'inactive', 'deleted'];

type QuestionDraft = {
  stem: string;
  options: Record<QuestionOption, string>;
  correctOption: QuestionOption;
  analysis: string;
  notes: string;
  source: string;
  parentId: number | null;
  categoryId: number | null;
  status: QuestionStatus;
};

function activeParents(categories: CategoryNode[]) {
  return categories.filter((parent) => parent.status === 'active' && parent.children.some((child) => child.status === 'active'));
}

function findParent(categories: CategoryNode[], categoryId: number | null) {
  return categories.find((parent) => parent.id === categoryId || parent.children.some((child) => child.id === categoryId)) ?? null;
}

function draftFromQuestion(question: ReviewQuestion | null, categories: CategoryNode[]): QuestionDraft {
  const parent = question
    ? findParent(categories, question.categoryId)
    : activeParents(categories)[0] ?? null;
  const child = question
    ? parent?.children.find((item) => item.id === question.categoryId) ?? null
    : parent?.children.find((item) => item.status === 'active') ?? null;
  return {
    stem: question?.stem ?? '',
    options: question?.options ?? { A: '', B: '', C: '', D: '' },
    correctOption: question?.correctOption ?? 'A',
    analysis: question?.analysis ?? '',
    notes: question?.notes ?? '',
    source: question?.source ?? '',
    parentId: parent?.id ?? null,
    categoryId: question?.categoryId ?? child?.id ?? null,
    status: question?.status ?? 'learning',
  };
}

export default function QuestionEditorModal({
  questionId,
  categories,
  open,
  onClose,
  onSaved,
  initialQuestion = null,
}: {
  questionId: number | null;
  categories: CategoryNode[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initialQuestion?: QuestionListItem | null;
}) {
  const [paste, setPaste] = useState('');
  const [draft, setDraft] = useState<QuestionDraft>(() => draftFromQuestion(initialQuestion, categories));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(questionId !== null && !initialQuestion ? '题目数据未加载，请关闭后重试。' : '');
  const [parseWarning, setParseWarning] = useState('');
  const [duplicateId, setDuplicateId] = useState<number | null>(null);

  const selectedParent = useMemo(
    () => categories.find((parent) => parent.id === draft.parentId)
      ?? (initialQuestion && draft.categoryId === initialQuestion.categoryId
        ? findParent(categories, draft.categoryId)
        : null),
    [categories, draft.categoryId, draft.parentId, initialQuestion],
  );
  const childCategories = selectedParent?.children ?? [];

  function updateDraft(fields: Partial<QuestionDraft>) {
    setDraft((current) => ({ ...current, ...fields }));
    setDirty(true);
    setFormError('');
    setDuplicateId(null);
  }

  function handlePasteParse() {
    const parsed = parsePastedQuestion(paste);
    updateDraft({
      stem: parsed.stem || draft.stem,
      options: { ...draft.options, ...parsed.options },
    });
    setParseWarning(parsed.warning ?? '已解析到题干和四个选项。');
  }

  function handleParentChange(value: string) {
    const parent = categories.find((item) => item.id === Number(value)) ?? null;
    const child = parent?.children.find((item) => item.status === 'active') ?? null;
    updateDraft({ parentId: parent?.id ?? null, categoryId: child?.id ?? null });
  }

  function handleStatusChange(nextStatus: QuestionStatus) {
    if ((nextStatus === 'inactive' || nextStatus === 'deleted')
      && !window.confirm(`确定将这道题标记为${nextStatus === 'inactive' ? '已停用' : '已删除'}吗？`)) return;
    updateDraft({ status: nextStatus });
  }

  function handleClose() {
    if (dirty && !window.confirm('尚有未保存内容，确定离开吗？')) return;
    onClose();
  }

  async function save(confirmDuplicate = false) {
    if (saving || draft.categoryId === null) {
      if (draft.categoryId === null) setFormError('请选择二级分类。');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const response = await fetch(questionId === null ? '/api/review-questions' : `/api/review-questions/${questionId}`, {
        method: questionId === null ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stem: draft.stem,
          options: draft.options,
          correctOption: draft.correctOption,
          analysis: draft.analysis,
          notes: draft.notes || null,
          source: draft.source || null,
          categoryId: draft.categoryId,
          status: draft.status,
          confirmDuplicate: confirmDuplicate || undefined,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409 && typeof body.duplicateId === 'number') {
        setFormError(body.error ?? '检测到相同题干');
        setDuplicateId(body.duplicateId);
        return;
      }
      if (!response.ok) {
        setFormError(body.error ?? '保存失败，请检查表单后重试。');
        return;
      }
      setDirty(false);
      onSaved();
      onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '网络错误，请重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title={questionId === null ? '新增 Part 5 题目' : `编辑题目 #${questionId}`} size="lg" compact>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-5">
        <section className="border-b border-stone-200 pb-5">
          <label className="block text-sm font-medium text-stone-800">粘贴题目
            <textarea value={paste} onChange={(event) => setPaste(event.target.value)} rows={5} placeholder={'题干\n(A) 选项 A\n(B) 选项 B\n(C) 选项 C\n(D) 选项 D'} className="mt-2 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900" />
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-3"><button type="button" onClick={handlePasteParse} className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100">解析到表单</button>{parseWarning ? <p className="text-sm text-stone-600">{parseWarning}</p> : null}</div>
        </section>

        {formError ? <div className="border-l-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800"><p>{formError}</p>{duplicateId !== null ? <button type="button" onClick={() => void save(true)} disabled={saving} className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1.5 font-medium text-red-800 hover:bg-red-100 disabled:text-red-400">仍然保存（匹配题目 #{duplicateId}）</button> : null}</div> : null}

        <label className="block text-sm font-medium text-stone-800">题干
          <textarea value={draft.stem} onChange={(event) => updateDraft({ stem: event.target.value })} rows={3} required className="mt-2 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900" />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          {options.map((option) => <label key={option} className="block text-sm font-medium text-stone-800">选项 {option}
            <input value={draft.options[option]} onChange={(event) => updateDraft({ options: { ...draft.options, [option]: event.target.value } })} required className="mt-2 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900" />
          </label>)}
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-stone-800">正确答案</legend>
          <div className="mt-2 inline-flex overflow-hidden rounded-md border border-stone-300" role="group" aria-label="正确答案">
            {options.map((option) => <button key={option} type="button" aria-pressed={draft.correctOption === option} onClick={() => updateDraft({ correctOption: option })} className={`min-w-11 border-r border-stone-300 px-3 py-2 text-sm font-medium last:border-r-0 ${draft.correctOption === option ? 'bg-stone-800 text-white' : 'bg-white text-stone-700 hover:bg-stone-100'}`}>{option}</button>)}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-stone-800">一级分类
            <select value={selectedParent?.id ?? draft.parentId ?? ''} onChange={(event) => handleParentChange(event.target.value)} required className="mt-2 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900">
              <option value="" disabled>选择一级分类</option>
              {categories.map((parent) => (
                <option key={parent.id} value={parent.id} disabled={parent.status !== 'active'}>
                  {parent.name}{parent.status === 'inactive' ? '（已停用）' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-stone-800">二级分类
            <select value={draft.categoryId ?? ''} onChange={(event) => updateDraft({ categoryId: event.target.value ? Number(event.target.value) : null })} required disabled={childCategories.length === 0} className="mt-2 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 disabled:bg-stone-100">
              <option value="" disabled>选择二级分类</option>
              {childCategories.map((child) => {
                const parentInactive = selectedParent?.status === 'inactive';
                const inactive = child.status === 'inactive' || parentInactive;
                return (
                  <option key={child.id} value={child.id} disabled={inactive}>
                    {child.name}{child.status === 'inactive' ? '（已停用）' : parentInactive ? '（父分类已停用）' : ''}
                  </option>
                );
              })}
            </select>
          </label>
        </div>

        <label className="block text-sm font-medium text-stone-800">考点分析
          <textarea value={draft.analysis} onChange={(event) => updateDraft({ analysis: event.target.value })} rows={4} required className="mt-2 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900" />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-stone-800">备注
            <textarea value={draft.notes} onChange={(event) => updateDraft({ notes: event.target.value })} rows={3} className="mt-2 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900" />
          </label>
          <div className="space-y-3">
            <label className="block text-sm font-medium text-stone-800">来源
              <input value={draft.source} onChange={(event) => updateDraft({ source: event.target.value })} className="mt-2 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900" />
            </label>
            <label className="block text-sm font-medium text-stone-800">状态
              <select value={draft.status} onChange={(event) => handleStatusChange(event.target.value as QuestionStatus)} className="mt-2 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900">
                {statuses.map((status) => <option key={status} value={status}>{status === 'learning' ? '学习中' : status === 'mastered' ? '已掌握' : status === 'inactive' ? '已停用' : '已删除'}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-stone-200 pt-4">
          <button type="button" onClick={handleClose} disabled={saving} className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:text-stone-400">取消</button>
          <button type="submit" disabled={saving} className="rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-300">{saving ? '保存中…' : '保存题目'}</button>
        </div>
      </form>
    </Modal>
  );
}
