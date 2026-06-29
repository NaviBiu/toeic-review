'use client';
import { useState } from 'react';
import Header from '@/components/Header';
import { SCENARIOS } from '@/lib/scenarios';
import Pagination, { PAGE_SIZE } from '@/components/Pagination';

type Candidate = {
  term: string; meaning: string; example: string; notes: string | null; part: number;
  dateAdded: string; scenarioMajor: string; scenarioMinor: string;
  scenarioWasSanitized: boolean; meaningWasAiGenerated: boolean; exampleWasAiGenerated: boolean;
  dateWasClampedToToday: boolean;
  decision: { action: string; reviveFromMastered?: boolean; textConflict?: boolean };
  existingId: number | null;
  confirmed: boolean;
  keepVersion: 'new' | 'existing';
};

const ACTION_LABELS: Record<string, string> = {
  inserted: '已新增',
  wrong_again: '已记录为又错一次',
  skipped: '与现有记录相同,已跳过',
};

const TODAY = new Date().toISOString().slice(0, 10);

export default function ImportPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(candidates.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageCandidates = candidates.slice(pageStart, pageStart + PAGE_SIZE);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // reset now (the captured `file` above is unaffected) so re-selecting the
    // same filename later still fires onChange -- browsers otherwise treat it as "no change"
    setError('');
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      // AI parsing a real multi-entry document can genuinely take 20-30s+
      // (measured against production) -- without the loading state above,
      // this entire wait looked identical to "nothing happened".
      const res = await fetch('/api/knowledge-points/import', { method: 'POST', body: form });
      let body: any;
      try {
        body = await res.json();
      } catch {
        throw new Error('服务器返回了无法识别的内容,请重试');
      }
      if (!res.ok) {
        setError(body.error ?? '解析失败,请重试');
        return;
      }
      setCandidates(body.candidates.map((c: any) => ({ ...c, confirmed: c.decision.action !== 'skip_duplicate', keepVersion: 'new' })));
      setPage(1);
    } catch (err: any) {
      // Covers network drops / timeouts -- previously unhandled, so a failed
      // fetch produced no feedback at all.
      setError(err.message ?? '网络错误,请重试');
    } finally {
      setUploading(false);
    }
  }

  function updateCandidate(i: number, patch: Partial<Candidate>) {
    setCandidates((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  async function handleConfirm() {
    setConfirmError('');
    setConfirming(true);
    try {
      const res = await fetch('/api/knowledge-points/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: candidates.filter((c) => c.confirmed) }),
      });
      let body: any;
      try {
        body = await res.json();
      } catch {
        throw new Error('服务器返回了无法识别的内容,请重试');
      }
      if (!res.ok) {
        throw new Error(body.error ?? '导入失败,请重试');
      }
      setResults(body.results);
      setCandidates([]);
    } catch (err: any) {
      // Keep `candidates` intact on failure -- otherwise every edit the user
      // just made on the confirm list (fixing AI misclassifications, etc.)
      // would be silently lost and they'd have to redo all of it.
      setConfirmError(err.message ?? '网络错误,请重试');
    } finally {
      setConfirming(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-50">
      <Header />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="mb-6 text-xl font-bold text-stone-900">导入错题笔记</h1>

        <label
          className={
            'mb-6 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center shadow-sm ' +
            (uploading
              ? 'cursor-not-allowed border-stone-200 bg-stone-100'
              : 'cursor-pointer border-stone-300 bg-white hover:border-indigo-300')
          }
        >
          <span className="text-2xl">{uploading ? '⏳' : '📄'}</span>
          <span className="mt-2 text-sm font-medium text-stone-600">
            {uploading ? 'AI 正在解析,可能需要 30 秒以上,请耐心等待…' : '点击选择 PDF / Word(.docx)文件'}
          </span>
          <input type="file" accept=".pdf,.docx" onChange={handleUpload} disabled={uploading} className="hidden" />
        </label>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {candidates.length > 0 && (
          <>
            <p className="mb-3 text-sm text-stone-400">
              共 {candidates.length} 条 · "确认导入"会处理全部已勾选的条目,不限于当前页面
            </p>
            <ul className="mb-4 flex flex-col gap-3">
              {pageCandidates.map((c, localIdx) => {
                const i = pageStart + localIdx;
                return (
                <li key={i} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={c.confirmed}
                      onChange={(e) => updateCandidate(i, { confirmed: e.target.checked })}
                      className="h-4 w-4 accent-indigo-600"
                    />
                    <span className="flex-1 text-sm font-medium text-stone-900">{c.term}</span>
                  </div>
                  {c.decision.action === 'skip_duplicate' && (
                    <p className="text-sm text-stone-400">与现有记录完全相同,已跳过</p>
                  )}
                  {c.scenarioWasSanitized && (
                    <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-700">AI 分类未命中,已自动归为未分类,请手动校正</p>
                  )}
                  {c.dateWasClampedToToday && (
                    <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">解析出的日期晚于今天,已自动改为今天,如果不对请在下面手动修正</p>
                  )}
                  {(c.meaningWasAiGenerated || c.exampleWasAiGenerated) && (
                    <p className="text-sm text-indigo-600">释义/例句由 AI 补充,请检查</p>
                  )}

                  <label className="mt-2 block text-xs text-stone-400">释义</label>
                  <textarea
                    value={c.meaning}
                    onChange={(e) => updateCandidate(i, { meaning: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-stone-200 p-2 text-sm"
                  />

                  <label className="mt-2 block text-xs text-stone-400">例句</label>
                  <textarea
                    value={c.example}
                    onChange={(e) => updateCandidate(i, { example: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-stone-200 p-2 text-sm"
                  />

                  <label className="mt-2 block text-xs text-stone-400">备注(可留空)</label>
                  <textarea
                    value={c.notes ?? ''}
                    onChange={(e) => updateCandidate(i, { notes: e.target.value || null })}
                    className="mt-1 w-full rounded-xl border border-stone-200 p-2 text-sm"
                  />

                  <div className="mt-2 flex flex-wrap gap-2">
                    <input
                      type="date"
                      value={c.dateAdded}
                      max={TODAY}
                      onChange={(e) => updateCandidate(i, { dateAdded: e.target.value })}
                      className="rounded-lg border border-stone-200 px-2 py-1 text-sm"
                    />
                    <select
                      value={c.part}
                      onChange={(e) => updateCandidate(i, { part: Number(e.target.value) })}
                      className="rounded-lg border border-stone-200 px-2 py-1 text-sm"
                    >
                      {[1, 2, 3, 4].map((p) => <option key={p} value={p}>Part {p}</option>)}
                    </select>
                    <select
                      value={c.scenarioMajor}
                      onChange={(e) => updateCandidate(i, { scenarioMajor: e.target.value, scenarioMinor: '未分类' })}
                      className="rounded-lg border border-stone-200 px-2 py-1 text-sm"
                    >
                      {Object.keys(SCENARIOS).map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <select
                      value={c.scenarioMinor}
                      onChange={(e) => updateCandidate(i, { scenarioMinor: e.target.value })}
                      className="rounded-lg border border-stone-200 px-2 py-1 text-sm"
                    >
                      {[...(SCENARIOS[c.scenarioMajor] ?? []), '未分类'].map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>

                  {c.decision.action === 'wrong_again' && c.decision.textConflict && (
                    <div className="mt-2 flex gap-4 text-sm text-stone-600">
                      <label className="flex items-center gap-1">
                        <input type="radio" checked={c.keepVersion === 'new'} onChange={() => updateCandidate(i, { keepVersion: 'new' })} /> 保留新版本
                      </label>
                      <label className="flex items-center gap-1">
                        <input type="radio" checked={c.keepVersion === 'existing'} onChange={() => updateCandidate(i, { keepVersion: 'existing' })} /> 保留现有版本
                      </label>
                    </div>
                  )}
                </li>
                );
              })}
            </ul>
            <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />
            <button
              onClick={handleConfirm}
              disabled={confirming}
              className="mt-4 rounded-xl bg-indigo-600 px-5 py-2.5 font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
            >
              {confirming ? '正在导入…' : '确认导入'}
            </button>
            {confirmError && <p className="mt-2 text-sm text-red-600">{confirmError}(你的修改还在,可以再次点击确认)</p>}
          </>
        )}

        {results.length > 0 && (() => {
          const counts = results.reduce<Record<string, number>>((acc, r) => {
            acc[r.action] = (acc[r.action] ?? 0) + 1;
            return acc;
          }, {});
          const parts = [
            counts.inserted && `新增 ${counts.inserted} 条`,
            counts.wrong_again && `标记答错 ${counts.wrong_again} 条`,
            counts.skipped && `跳过重复 ${counts.skipped} 条`,
            counts.error && `失败 ${counts.error} 条`,
          ].filter(Boolean);
          return (
            <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <p className="font-medium text-stone-900">导入完成:{parts.join('、')}</p>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {results.map((r, i) => (
                  <li key={i} className={r.action === 'error' ? 'text-red-600' : 'text-stone-500'}>
                    {r.term}:{r.action === 'error' ? `失败 — ${r.error}` : ACTION_LABELS[r.action] ?? r.action}
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}
      </div>
    </main>
  );
}
