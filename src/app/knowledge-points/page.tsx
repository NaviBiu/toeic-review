'use client';
import { useEffect, useState } from 'react';
import { SCENARIOS } from '@/lib/scenarios';
import Header from '@/components/Header';

type KP = {
  id: number; term: string; meaning: string; example: string; part: number;
  scenarioMajor: string; scenarioMinor: string; status: string;
};

export default function KnowledgePointsPage() {
  const [items, setItems] = useState<KP[]>([]);
  const [partFilter, setPartFilter] = useState('');
  const [majorFilter, setMajorFilter] = useState('');
  const [newTerm, setNewTerm] = useState('');
  const [newPart, setNewPart] = useState('1');
  const [newMeaning, setNewMeaning] = useState('');
  const [newExample, setNewExample] = useState('');
  const [newScenarioMajor, setNewScenarioMajor] = useState<string | null>(null);
  const [newScenarioMinor, setNewScenarioMinor] = useState<string | null>(null);

  async function load() {
    const params = new URLSearchParams();
    if (partFilter) params.set('part', partFilter);
    if (majorFilter) params.set('scenarioMajor', majorFilter);
    const res = await fetch(`/api/knowledge-points?${params}`);
    setItems(await res.json());
  }

  useEffect(() => { load(); }, [partFilter, majorFilter]);

  async function handleDelete(id: number) {
    await fetch(`/api/knowledge-points/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'deleted' }),
    });
    load();
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/knowledge-points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        term: newTerm,
        part: Number(newPart),
        meaning: newMeaning,
        example: newExample,
        scenarioMajor: newScenarioMajor ?? undefined,
        scenarioMinor: newScenarioMinor ?? undefined,
      }),
    });
    setNewTerm(''); setNewMeaning(''); setNewExample('');
    setNewScenarioMajor(null); setNewScenarioMinor(null);
    load();
  }

  async function handleAiAssist() {
    const res = await fetch('/api/knowledge-points/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: newTerm, part: Number(newPart) }),
    });
    if (!res.ok) return;
    const suggestion = await res.json();
    setNewMeaning(suggestion.meaning);
    setNewExample(suggestion.example);
    setNewScenarioMajor(suggestion.scenarioMajor);
    setNewScenarioMinor(suggestion.scenarioMinor);
  }

  return (
    <main className="min-h-screen bg-stone-50">
      <Header />
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="mb-6 text-xl font-bold text-stone-900">错题库</h1>

        <form onSubmit={handleAdd} className="mb-6 flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-stone-400">手动添加一条知识点(释义/例句留空也可以保存,场景默认未分类)</p>
          <input
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
            placeholder="词/短语"
            required
            className="rounded-xl border border-stone-200 px-3 py-2 text-sm"
          />
          <button type="button" onClick={handleAiAssist} disabled={!newTerm} className="self-start text-sm font-medium text-indigo-600 hover:text-indigo-700 disabled:text-stone-300">
            AI 自动补全
          </button>
          <select value={newPart} onChange={(e) => setNewPart(e.target.value)} className="rounded-xl border border-stone-200 px-3 py-2 text-sm">
            {[1, 2, 3, 4].map((p) => <option key={p} value={p}>Part {p}</option>)}
          </select>
          <input value={newMeaning} onChange={(e) => setNewMeaning(e.target.value)} placeholder="释义(可留空)" className="rounded-xl border border-stone-200 px-3 py-2 text-sm" />
          <input value={newExample} onChange={(e) => setNewExample(e.target.value)} placeholder="例句(可留空)" className="rounded-xl border border-stone-200 px-3 py-2 text-sm" />
          <button type="submit" className="self-start rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
            添加
          </button>
        </form>

        <div className="mb-4 flex gap-3">
          <select value={partFilter} onChange={(e) => setPartFilter(e.target.value)} className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm shadow-sm">
            <option value="">全部 Part</option>
            {[1, 2, 3, 4].map((p) => <option key={p} value={p}>Part {p}</option>)}
          </select>
          <select value={majorFilter} onChange={(e) => setMajorFilter(e.target.value)} className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm shadow-sm">
            <option value="">全部场景</option>
            {Object.keys(SCENARIOS).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <ul className="flex flex-col gap-3">
          {items.map((kp) => (
            <li key={kp.id} className="flex items-start justify-between rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <div>
                <div className="font-medium text-stone-900">{kp.term}</div>
                <div className="text-sm text-stone-500">{kp.meaning}</div>
                <div className="mt-1 text-xs text-stone-400">Part {kp.part} · {kp.scenarioMajor} / {kp.scenarioMinor}</div>
              </div>
              <button onClick={() => handleDelete(kp.id)} className="text-sm text-stone-400 hover:text-red-600">删除</button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
