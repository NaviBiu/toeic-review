'use client';
import { useState } from 'react';

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
    <main className="p-6 max-w-3xl">
      <h1 className="text-xl font-semibold mb-4">导入错题笔记</h1>
      <input type="file" accept=".pdf,.docx,.doc" onChange={handleUpload} className="mb-4" />
      {error && <p className="text-red-600">{error}</p>}

      {candidates.length > 0 && (
        <>
          <ul className="flex flex-col gap-3 mb-4">
            {candidates.map((c, i) => (
              <li key={i} className="border rounded p-3">
                <div className="flex justify-between items-center mb-2">
                  <input
                    type="checkbox"
                    checked={c.confirmed}
                    onChange={(e) => updateCandidate(i, { confirmed: e.target.checked })}
                  />
                  <span className="font-medium">{c.term}</span>
                  <span className="text-xs text-gray-400">Part {c.part} · {c.scenarioMajor}/{c.scenarioMinor}</span>
                </div>
                {c.decision.action === 'skip_duplicate' && (
                  <p className="text-sm text-gray-500">与现有记录完全相同,已跳过</p>
                )}
                {c.scenarioWasSanitized && (
                  <p className="text-sm text-yellow-700 bg-yellow-50 p-1 rounded">AI 分类未命中,已自动归为未分类,请手动校正</p>
                )}
                {(c.meaningWasAiGenerated || c.exampleWasAiGenerated) && (
                  <p className="text-sm text-blue-700">释义/例句由 AI 补充,请检查</p>
                )}
                <textarea
                  value={c.meaning}
                  onChange={(e) => updateCandidate(i, { meaning: e.target.value })}
                  className="border rounded w-full p-1 mt-1 text-sm"
                />
                {c.decision.action === 'wrong_again' && c.decision.textConflict && (
                  <div className="flex gap-3 mt-1 text-sm">
                    <label>
                      <input type="radio" checked={c.keepVersion === 'new'} onChange={() => updateCandidate(i, { keepVersion: 'new' })} /> 保留新版本
                    </label>
                    <label>
                      <input type="radio" checked={c.keepVersion === 'existing'} onChange={() => updateCandidate(i, { keepVersion: 'existing' })} /> 保留现有版本
                    </label>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <button onClick={handleConfirm} className="bg-blue-600 text-white rounded px-4 py-2">
            确认导入
          </button>
        </>
      )}

      {results.length > 0 && (
        <ul className="mt-4 text-sm">
          {results.map((r, i) => (
            <li key={i}>{r.term}: {r.action === 'error' ? `失败 — ${r.error}` : r.action}</li>
          ))}
        </ul>
      )}
    </main>
  );
}
