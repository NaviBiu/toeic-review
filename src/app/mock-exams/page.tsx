'use client';
import { useEffect, useState } from 'react';
import { SCENARIOS } from '@/lib/scenarios';
import Header from '@/components/Header';

type PartScore = { correct: number; total: number };
type ScenarioRow = { scenarioMajor: string; scenarioMinor: string; correct: number; total: number };

const PART_DEFAULTS: Record<string, PartScore> = {
  part1: { correct: 0, total: 6 },
  part2: { correct: 0, total: 25 },
  part3: { correct: 0, total: 39 },
  part4: { correct: 0, total: 30 },
};

export default function MockExamsPage() {
  const [history, setHistory] = useState<any[]>([]);
  const [testDate, setTestDate] = useState('');
  const [parts, setParts] = useState<Record<string, PartScore>>(PART_DEFAULTS);
  const [scenarios, setScenarios] = useState<ScenarioRow[]>([]);
  const [error, setError] = useState('');

  async function load() {
    const res = await fetch('/api/mock-exams');
    setHistory(await res.json());
  }
  useEffect(() => { load(); }, []);

  function updatePart(key: string, field: 'correct' | 'total', value: number) {
    setParts((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  function addScenarioRow() {
    setScenarios((prev) => [...prev, { scenarioMajor: Object.keys(SCENARIOS)[0], scenarioMinor: '未分类', correct: 0, total: 1 }]);
  }
  function updateScenarioRow(i: number, patch: Partial<ScenarioRow>) {
    setScenarios((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function removeScenarioRow(i: number) {
    setScenarios((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/mock-exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testDate, ...parts, scenarios }),
    });
    if (!res.ok) {
      setError((await res.json()).error);
      return;
    }
    setTestDate('');
    setParts(PART_DEFAULTS);
    setScenarios([]);
    load();
  }

  return (
    <main className="min-h-screen bg-stone-50">
      <Header />
      <div className="mx-auto max-w-xl px-6 py-10">
        <h1 className="mb-6 text-xl font-bold text-stone-900">记录一次模考</h1>
        <form onSubmit={handleSubmit} className="mb-8 flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} required className="rounded-xl border border-stone-200 px-3 py-2 text-sm" />
          {(['part1', 'part2', 'part3', 'part4'] as const).map((key, i) => (
            <div key={key} className="flex items-center gap-2">
              <span className="w-16 text-sm text-stone-500">Part {i + 1}</span>
              <input type="number" value={parts[key].correct} onChange={(e) => updatePart(key, 'correct', Number(e.target.value))} className="w-20 rounded-xl border border-stone-200 px-2 py-1.5 text-sm" />
              <span className="text-stone-400">/</span>
              <input type="number" value={parts[key].total} onChange={(e) => updatePart(key, 'total', Number(e.target.value))} className="w-20 rounded-xl border border-stone-200 px-2 py-1.5 text-sm" />
            </div>
          ))}

          <div>
            <p className="mb-2 text-sm text-stone-400">场景细分(选填)</p>
            {scenarios.map((s, i) => (
              <div key={i} className="mb-2 flex items-center gap-2">
                <select value={s.scenarioMajor} onChange={(e) => updateScenarioRow(i, { scenarioMajor: e.target.value, scenarioMinor: '未分类' })} className="rounded-lg border border-stone-200 px-1 py-1 text-sm">
                  {Object.keys(SCENARIOS).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <select value={s.scenarioMinor} onChange={(e) => updateScenarioRow(i, { scenarioMinor: e.target.value })} className="rounded-lg border border-stone-200 px-1 py-1 text-sm">
                  {[...SCENARIOS[s.scenarioMajor], '未分类'].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <input type="number" value={s.correct} onChange={(e) => updateScenarioRow(i, { correct: Number(e.target.value) })} className="w-16 rounded-lg border border-stone-200 px-1 py-1 text-sm" />
                <span className="text-stone-400">/</span>
                <input type="number" value={s.total} onChange={(e) => updateScenarioRow(i, { total: Number(e.target.value) })} className="w-16 rounded-lg border border-stone-200 px-1 py-1 text-sm" />
                <button type="button" onClick={() => removeScenarioRow(i)} className="text-sm text-stone-400 hover:text-red-600">删除</button>
              </div>
            ))}
            <button type="button" onClick={addScenarioRow} className="text-sm font-medium text-indigo-600 hover:text-indigo-700">+ 添加场景</button>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" className="self-start rounded-xl bg-indigo-600 px-5 py-2.5 font-medium text-white shadow-sm hover:bg-indigo-700">保存</button>
        </form>

        <h2 className="mb-3 text-lg font-semibold text-stone-900">模考历史</h2>
        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500">
              <tr><th className="px-4 py-2 text-left">日期</th><th className="py-2">P1</th><th className="py-2">P2</th><th className="py-2">P3</th><th className="py-2">P4</th></tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id} className="border-t border-stone-100">
                  <td className="px-4 py-2 text-stone-700">{r.testDate}</td>
                  <td className="text-center text-stone-600">{r.part1.correct}/{r.part1.total}</td>
                  <td className="text-center text-stone-600">{r.part2.correct}/{r.part2.total}</td>
                  <td className="text-center text-stone-600">{r.part3.correct}/{r.part3.total}</td>
                  <td className="text-center text-stone-600">{r.part4.correct}/{r.part4.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
