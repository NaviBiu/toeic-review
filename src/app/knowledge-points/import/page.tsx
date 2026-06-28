'use client';
import { useState } from 'react';
import Header from '@/components/Header';

type Candidate = {
  term: string; meaning: string; example: string; notes: string | null; part: number;
  dateAdded: string; scenarioMajor: string; scenarioMinor: string;
  scenarioWasSanitized: boolean; meaningWasAiGenerated: boolean; exampleWasAiGenerated: boolean;
  decision: { action: string; reviveFromMastered?: boolean; textConflict?: boolean };
  existingId: number | null;
  confirmed: boolean;
  keepVersion: 'new' | 'existing';
};

export default function ImportPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState('');
  const [results, setResults] = useState<any[]>([]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // reset now (the captured `file` above is unaffected) so re-selecting the
    // same filename later still fires onChange -- browsers otherwise treat it as "no change"
    setError('');
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/knowledge-points/import', { method: 'POST', body: form });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? '解析失败,请重试');
      return;
    }
    setCandidates(body.candidates.map((c: any) => ({ ...c, confirmed: c.decision.action !== 'skip_duplicate', keepVersion: 'new' })));
  }

  function updateCandidate(i: number, patch: Partial<Candidate>) {
    setCandidates((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  async function handleConfirm() {
    const res = await fetch('/api/knowledge-points/import/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: candidates.filter((c) => c.confirmed) }),
    });
    const body = await res.json();
    setResults(body.results);
    setCandidates([]);
  }

  return (
    <main className="min-h-screen bg-stone-50">
      <Header />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="mb-6 text-xl font-bold text-stone-900">导入错题笔记</h1>

        <label className="mb-6 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-stone-300 bg-white p-8 text-center shadow-sm hover:border-indigo-300">
          <span className="text-2xl">📄</span>
          <span className="mt-2 text-sm font-medium text-stone-600">点击选择 PDF / Word 文件</span>
          <input type="file" accept=".pdf,.docx,.doc" onChange={handleUpload} className="hidden" />
        </label>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {candidates.length > 0 && (
          <>
            <ul className="mb-4 flex flex-col gap-3">
              {candidates.map((c, i) => (
                <li key={i} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={c.confirmed}
                        onChange={(e) => updateCandidate(i, { confirmed: e.target.checked })}
                        className="h-4 w-4 accent-indigo-600"
                      />
                      <span className="font-medium text-stone-900">{c.term}</span>
                    </label>
                    <span className="text-xs text-stone-400">Part {c.part} · {c.scenarioMajor}/{c.scenarioMinor}</span>
                  </div>
                  {c.decision.action === 'skip_duplicate' && (
                    <p className="text-sm text-stone-400">与现有记录完全相同,已跳过</p>
                  )}
                  {c.scenarioWasSanitized && (
                    <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-700">AI 分类未命中,已自动归为未分类,请手动校正</p>
                  )}
                  {(c.meaningWasAiGenerated || c.exampleWasAiGenerated) && (
                    <p className="text-sm text-indigo-600">释义/例句由 AI 补充,请检查</p>
                  )}
                  <textarea
                    value={c.meaning}
                    onChange={(e) => updateCandidate(i, { meaning: e.target.value })}
                    className="mt-2 w-full rounded-xl border border-stone-200 p-2 text-sm"
                  />
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
              ))}
            </ul>
            <button onClick={handleConfirm} className="rounded-xl bg-indigo-600 px-5 py-2.5 font-medium text-white shadow-sm hover:bg-indigo-700">
              确认导入
            </button>
          </>
        )}

        {results.length > 0 && (
          <ul className="mt-6 flex flex-col gap-1 text-sm text-stone-600">
            {results.map((r, i) => (
              <li key={i}>{r.term}: {r.action === 'error' ? `失败 — ${r.error}` : r.action}</li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
