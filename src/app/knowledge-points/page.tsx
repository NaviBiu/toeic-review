'use client';
import { useEffect, useState } from 'react';
import { SCENARIOS } from '@/lib/scenarios';

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
      body: JSON.stringify({ term: newTerm, part: Number(newPart), meaning: newMeaning, example: newExample }),
    });
    setNewTerm(''); setNewMeaning(''); setNewExample('');
    load();
  }

  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold mb-4">错题库</h1>

      <form onSubmit={handleAdd} className="border rounded p-3 mb-4 flex flex-col gap-2 max-w-md">
        <p className="text-sm text-gray-600">手动添加一条知识点(释义/例句留空也可以保存,场景默认未分类)</p>
        <input value={newTerm} onChange={(e) => setNewTerm(e.target.value)} placeholder="词/短语" required className="border rounded px-2 py-1" />
        <select value={newPart} onChange={(e) => setNewPart(e.target.value)} className="border rounded px-2 py-1">
          {[1, 2, 3, 4].map((p) => <option key={p} value={p}>Part {p}</option>)}
        </select>
        <input value={newMeaning} onChange={(e) => setNewMeaning(e.target.value)} placeholder="释义(可留空)" className="border rounded px-2 py-1" />
        <input value={newExample} onChange={(e) => setNewExample(e.target.value)} placeholder="例句(可留空)" className="border rounded px-2 py-1" />
        <button type="submit" className="bg-blue-600 text-white rounded px-3 py-1 self-start">添加</button>
      </form>

      <div className="flex gap-3 mb-4">
        <select value={partFilter} onChange={(e) => setPartFilter(e.target.value)} className="border rounded px-2 py-1">
          <option value="">全部 Part</option>
          {[1, 2, 3, 4].map((p) => <option key={p} value={p}>Part {p}</option>)}
        </select>
        <select value={majorFilter} onChange={(e) => setMajorFilter(e.target.value)} className="border rounded px-2 py-1">
          <option value="">全部场景</option>
          {Object.keys(SCENARIOS).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((kp) => (
          <li key={kp.id} className="border rounded p-3 flex justify-between items-start">
            <div>
              <div className="font-medium">{kp.term}</div>
              <div className="text-sm text-gray-600">{kp.meaning}</div>
              <div className="text-xs text-gray-400">Part {kp.part} · {kp.scenarioMajor} / {kp.scenarioMinor}</div>
            </div>
            <button onClick={() => handleDelete(kp.id)} className="text-red-600 text-sm">删除</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
