'use client';
import { useEffect, useState } from 'react';

type KP = { id: number; term: string; meaning: string; part: number; scenarioMajor: string; scenarioMinor: string };

export default function MasteredPage() {
  const [items, setItems] = useState<KP[]>([]);

  async function load() {
    const res = await fetch('/api/knowledge-points?status=mastered');
    setItems(await res.json());
  }

  useEffect(() => { load(); }, []);

  async function restore(id: number) {
    await fetch(`/api/knowledge-points/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    load();
  }

  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold mb-4">已掌握</h1>
      <ul className="flex flex-col gap-2">
        {items.map((kp) => (
          <li key={kp.id} className="border rounded p-3 flex justify-between items-center">
            <div>
              <div className="font-medium">{kp.term}</div>
              <div className="text-sm text-gray-600">{kp.meaning}</div>
              <div className="text-xs text-gray-400">Part {kp.part} · {kp.scenarioMajor} / {kp.scenarioMinor}</div>
            </div>
            <button onClick={() => restore(kp.id)} className="text-blue-600 text-sm">移回错题库</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
