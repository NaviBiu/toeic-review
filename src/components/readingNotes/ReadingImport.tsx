'use client';

import { useState } from 'react';
import type { ReadingImportPreview } from '@/lib/readingNotes/types';
import { RichReadingContent } from './RichReadingContent';

const FILE_ERROR = '阅读笔记批量导入仅支持 Word(.docx) 文件';

type ImportResult = {
  requested: number;
  inserted: number;
  duplicates: number;
  categoriesCreated: number;
  message: string;
};

async function parseResponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? fallback);
  return body as T;
}

export default function ReadingImport() {
  const [preview, setPreview] = useState<ReadingImportPreview | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [usingAi, setUsingAi] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  function applyPreview(next: ReadingImportPreview) {
    setPreview(next);
    setAccepted(new Set(next.candidates.map((candidate) => candidate.sourceIndex)));
    setResult(null);
  }

  async function handleReadingFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    if (!file.name.toLocaleLowerCase('en-US').endsWith('.docx')) {
      setPreview(null);
      setError(FILE_ERROR);
      return;
    }
    setUploading(true);
    setPreview(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/reading-notes/import', { method: 'POST', body: form });
      applyPreview(await parseResponse<ReadingImportPreview>(response, 'Word 解析失败，请重试'));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Word 解析失败，请重试');
    } finally {
      setUploading(false);
    }
  }

  async function handleAiFallback() {
    if (!preview || usingAi) return;
    setUsingAi(true);
    setError('');
    try {
      const response = await fetch('/api/reading-notes/import/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: preview.token }),
      });
      applyPreview(await parseResponse<ReadingImportPreview>(response, 'DeepSeek 解析失败，请重试'));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'DeepSeek 解析失败，请重试');
    } finally {
      setUsingAi(false);
    }
  }

  async function confirmImport() {
    if (!preview || confirming) return;
    setConfirming(true);
    setError('');
    try {
      const response = await fetch('/api/reading-notes/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: preview.token,
          acceptedSourceIndexes: [...accepted],
        }),
      });
      setResult(await parseResponse<ImportResult>(response, '导入失败，请重试'));
      setPreview(null);
      setAccepted(new Set());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '导入失败，请重试');
    } finally {
      setConfirming(false);
    }
  }

  function toggleCandidate(sourceIndex: number) {
    setAccepted((current) => {
      const next = new Set(current);
      if (next.has(sourceIndex)) next.delete(sourceIndex);
      else next.add(sourceIndex);
      return next;
    });
  }

  return (
    <section aria-label="阅读笔记导入">
      <label className={`flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-6 py-8 text-center ${uploading ? 'cursor-wait border-stone-200 bg-stone-100' : 'border-stone-300 bg-white hover:border-stone-500'}`}>
        <span aria-hidden="true" className="text-2xl">▤</span>
        <span className="mt-3 text-sm font-medium text-stone-700">{uploading ? '正在解析 Word…' : '点击选择 Word(.docx) 文件'}</span>
        <span className="mt-1 text-xs text-stone-500">保留文字、列表和表格；不会自动调用 AI</span>
        <input
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={handleReadingFile}
          disabled={uploading}
          className="sr-only"
        />
      </label>

      {error ? <p role="alert" className="mt-4 border-l-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}

      {preview ? (
        <div className="mt-6">
          <div className="grid gap-px border border-stone-200 bg-stone-200 sm:grid-cols-3">
            <div className="bg-white p-4"><p className="text-xs text-stone-500">可导入</p><p className="mt-1 text-xl font-semibold text-stone-900">{preview.recognizedCount}</p></div>
            <div className="bg-white p-4"><p className="text-xs text-stone-500">重复</p><p className="mt-1 text-xl font-semibold text-stone-900">{preview.duplicateCount}</p></div>
            <div className="bg-white p-4"><p className="text-xs text-stone-500">待确认</p><p className="mt-1 text-xl font-semibold text-stone-900">{preview.unrecognizedCount}</p></div>
          </div>

          {preview.proposedCategories.length > 0 ? <p className="mt-3 text-sm text-stone-600">确认后新增分类：{preview.proposedCategories.join('、')}</p> : null}

          <ul className="mt-5 divide-y divide-stone-200 border-y border-stone-200">
            {preview.candidates.map((candidate) => (
              <li key={candidate.sourceIndex} className="flex items-start gap-3 py-4">
                <input aria-label={`选择 ${candidate.contentText}`} type="checkbox" checked={accepted.has(candidate.sourceIndex)} onChange={() => toggleCandidate(candidate.sourceIndex)} className="mt-1 h-4 w-4 accent-stone-900" />
                <div className="min-w-0 flex-1">
                  <p className="mb-2 text-xs font-medium text-stone-500">{candidate.categoryName} · {candidate.noteDate}</p>
                  <RichReadingContent html={candidate.contentHtml} />
                  {candidate.notes ? <p className="mt-2 text-sm text-stone-600">{candidate.notes}</p> : null}
                </div>
              </li>
            ))}
          </ul>

          {preview.exceptions.length > 0 ? (
            <div className="mt-5 border-l-2 border-amber-600 bg-amber-50 px-4 py-3">
              <p className="text-sm font-medium text-amber-900">以下内容需要调整文档格式</p>
              <ul className="mt-2 space-y-2 text-sm text-amber-900">
                {preview.exceptions.map((candidate) => <li key={candidate.sourceIndex}>{candidate.contentText}：{candidate.issue}</li>)}
              </ul>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={() => void confirmImport()} disabled={confirming || accepted.size === 0} className="rounded-md bg-stone-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:bg-stone-300">
              {confirming ? '正在导入…' : `确认导入 ${accepted.size} 条`}
            </button>
            <button
              type="button"
              onClick={() => { setPreview(null); setAccepted(new Set()); setError(''); }}
              disabled={confirming || usingAi}
              className="rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:text-stone-400"
            >
              取消本次导入
            </button>
            {preview.aiFallbackAvailable ? <button type="button" onClick={() => void handleAiFallback()} disabled={usingAi} className="rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:text-stone-400">
              {usingAi ? 'DeepSeek 正在解析…' : '使用 AI 重新解析（调用 DeepSeek 1 次）'}
            </button> : null}
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="mt-6 border border-stone-200 bg-white p-5">
          <h2 className="text-base font-semibold text-stone-900">导入完成</h2>
          <p className="mt-2 text-sm text-stone-700">{result.message}</p>
          <a href="/review" className="mt-4 inline-flex rounded-md bg-stone-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-stone-800">进入学习</a>
        </div>
      ) : null}
    </section>
  );
}
