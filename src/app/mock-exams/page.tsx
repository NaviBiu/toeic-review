'use client';
import { useEffect, useState } from 'react';
import { SCENARIOS } from '@/lib/scenarios';

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
    <main className="p-6 max-w-xl">
      <h1 className="text-xl font-semibold mb-4">记录一次模考</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 mb-6">
        <input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} required className="border rounded px-2 py-1" />
        {(['part1', 'part2', 'part3', 'part4'] as const).map((key, i) => (
          <div key={key} className="flex gap-2 items-center">
            <span className="w-16">Part {i + 1}</span>
            <input type="number" value={parts[key].correct} onChange={(e) => updatePart(key, 'correct', Number(e.target.value))} className="border rounded px-2 py-1 w-20" />
            <span>/</span>
            <input type="number" value={parts[key].total} onChange={(e) => updatePart(key, 'total', Number(e.target.value))} className="border rounded px-2 py-1 w-20" />
          </div>
        ))}

        <div>
          <p className="text-sm text-gray-600 mb-1">场景细分(选填)</p>
          {scenarios.map((s, i) => (
            <div key={i} className="flex gap-2 items-center mb-1">
              <select value={s.scenarioMajor} onChange={(e) => updateScenarioRow(i, { scenarioMajor: e.target.value, scenarioMinor: '未分类' })} className="border rounded px-1">
                {Object.keys(SCENARIOS).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <select value={s.scenarioMinor} onChange={(e) => updateScenarioRow(i, { scenarioMinor: e.target.value })} className="border rounded px-1">
                {[...SCENARIOS[s.scenarioMajor], '未分类'].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <input type="number" value={s.correct} onChange={(e) => updateScenarioRow(i, { correct: Number(e.target.value) })} className="border rounded px-1 w-16" />
              <span>/</span>
              <input type="number" value={s.total} onChange={(e) => updateScenarioRow(i, { total: Number(e.target.value) })} className="border rounded px-1 w-16" />
              <button type="button" onClick={() => removeScenarioRow(i)} className="text-red-600 text-sm">删除</button>
            </div>
          ))}
          <button type="button" onClick={addScenarioRow} className="text-blue-600 text-sm">+ 添加场景</button>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button type="submit" className="bg-blue-600 text-white rounded px-4 py-2">保存</button>
      </form>

      <h2 className="text-lg font-semibold mb-2">模考历史</h2>
      <table className="w-full text-sm">
        <thead><tr><th className="text-left">日期</th><th>P1</th><th>P2</th><th>P3</th><th>P4</th></tr></thead>
        <tbody>
          {history.map((r) => (
            <tr key={r.id}>
              <td>{r.testDate}</td>
              <td>{r.part1.correct}/{r.part1.total}</td>
              <td>{r.part2.correct}/{r.part2.total}</td>
              <td>{r.part3.correct}/{r.part3.total}</td>
              <td>{r.part4.correct}/{r.part4.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
