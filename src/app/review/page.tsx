'use client';
import { useEffect, useState } from 'react';
import { SCENARIOS } from '@/lib/scenarios';

type KP = { id: number; term: string; meaning: string; example: string; notes: string | null };

export default function ReviewPage() {
  const [queue, setQueue] = useState<KP[]>([]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<'guessing' | 'revealed'>('guessing');
  const [guess, setGuess] = useState<'remember' | 'forgot' | null>(null);
  const [undo, setUndo] = useState<{ id: number; term: string } | null>(null);
  const [majorFilter, setMajorFilter] = useState('');

  async function loadQueue() {
    const params = new URLSearchParams();
    if (majorFilter) params.set('scenarioMajor', majorFilter);
    const res = await fetch(`/api/review/queue?${params}`);
    setQueue(await res.json());
    setIndex(0);
    setPhase('guessing');
    setGuess(null);
  }

  useEffect(() => { loadQueue(); }, [majorFilter]);

  const current = queue[index];

  function pickGuess(value: 'remember' | 'forgot') {
    setGuess(value);
    setPhase('revealed');
  }

  function revoke() {
    // Flip to the other choice without re-hiding the answer or returning to the
    // guessing phase -- per spec, 撤回 lets the user correct a mis-click while
    // still seeing meaning/example/notes, then commit via 下一个. It is not a
    // "start over blind" action.
    setGuess((g) => (g === 'remember' ? 'forgot' : 'remember'));
  }

  async function next() {
    if (current && guess) {
      await fetch(`/api/review/${current.id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correct: guess === 'remember' }),
      });
    }
    setIndex((i) => i + 1);
    setPhase('guessing');
    setGuess(null);
  }

  async function handleDelete() {
    if (!current) return;
    const deletedId = current.id;
    const deletedTerm = current.term;
    await fetch(`/api/knowledge-points/${deletedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'deleted' }),
    });
    setUndo({ id: deletedId, term: deletedTerm });
    setTimeout(() => setUndo((u) => (u?.id === deletedId ? null : u)), 5000);
    setIndex((i) => i + 1);
    setPhase('guessing');
    setGuess(null);
  }

  async function handleUndo() {
    if (!undo) return;
    await fetch(`/api/knowledge-points/${undo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    setUndo(null);
  }

  return (
    <main className="p-6 max-w-xl">
      <div className="mb-4">
        <select value={majorFilter} onChange={(e) => setMajorFilter(e.target.value)} className="border rounded px-2 py-1">
          <option value="">全部场景</option>
          {Object.keys(SCENARIOS).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {!current ? (
        <p>今天没有需要复盘的内容</p>
      ) : (
        <>
          <div className="border rounded p-6 mb-4">
            <p className="text-2xl font-semibold mb-4">{current.term}</p>
            {phase === 'guessing' && (
              <div className="flex gap-3">
                <button onClick={() => pickGuess('remember')} className="bg-green-600 text-white rounded px-4 py-2">记得</button>
                <button onClick={() => pickGuess('forgot')} className="bg-gray-400 text-white rounded px-4 py-2">不记得</button>
              </div>
            )}
            {phase === 'revealed' && (
              <>
                <p className="text-gray-700">{current.meaning}</p>
                <p className="text-gray-500 text-sm mt-1">{current.example}</p>
                {current.notes && <p className="text-gray-400 text-sm mt-1">{current.notes}</p>}
                <div className="flex gap-3 mt-4 items-center">
                  <span className="text-sm text-gray-500">你的判断:{guess === 'remember' ? '记得' : '不记得'}</span>
                  <button onClick={revoke} className="text-sm text-gray-500 underline">撤回(改选)</button>
                  <button onClick={next} className="bg-blue-600 text-white rounded px-4 py-2">下一个</button>
                </div>
              </>
            )}
          </div>
          <button onClick={handleDelete} className="text-red-600 text-sm">删除(不需要再复习)</button>
        </>
      )}

      {undo && (
        <div className="fixed bottom-4 left-4 bg-gray-800 text-white rounded px-4 py-2 flex gap-3 items-center">
          已删除「{undo.term}」
          <button onClick={handleUndo} className="underline">撤销</button>
        </div>
      )}
    </main>
  );
}
