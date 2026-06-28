'use client';
import { useEffect, useState } from 'react';
import Header from '@/components/Header';

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
    <main className="min-h-screen bg-stone-50">
      <Header />
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="mb-6 text-xl font-bold text-stone-900">已掌握</h1>
        {items.length === 0 ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center text-stone-400 shadow-sm">
            还没有真正长期记住的内容
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((kp) => (
              <li key={kp.id} className="flex items-center justify-between rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                <div>
                  <div className="font-medium text-stone-900">✅ {kp.term}</div>
                  <div className="text-sm text-stone-500">{kp.meaning}</div>
                  <div className="mt-1 text-xs text-stone-400">Part {kp.part} · {kp.scenarioMajor} / {kp.scenarioMinor}</div>
                </div>
                <button onClick={() => restore(kp.id)} className="text-sm font-medium text-indigo-600 hover:text-indigo-700">移回错题库</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
