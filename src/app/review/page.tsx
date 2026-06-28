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
      // A wrong answer stays due today on the backend (src/lib/srs.ts) instead
      // of moving to tomorrow -- re-appending it here makes it actually
      // resurface within this same sitting instead of only on next page load,
      // so today's session can't be finished on it until it's answered right.
      if (guess === 'forgot') {
        setQueue((q) => [...q, current]);
      }
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
    <main className="min-h-screen bg-stone-50">
      <div className="mx-auto max-w-xl px-6 py-12">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-stone-900">今日复盘</h1>
          {queue.length > 0 && (
            <span className="text-sm font-medium text-stone-400">
              {Math.min(index + 1, queue.length)} / {queue.length}
            </span>
          )}
        </div>

        <select
          value={majorFilter}
          onChange={(e) => setMajorFilter(e.target.value)}
          className="mb-6 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 shadow-sm"
        >
          <option value="">全部场景</option>
          {Object.keys(SCENARIOS).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>

        {!current ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center shadow-sm">
            <p className="text-2xl">🎉</p>
            <p className="mt-3 text-stone-500">今天没有需要复盘的内容</p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
              <p className="text-3xl font-bold text-stone-900">{current.term}</p>
              {phase === 'guessing' && (
                <div className="mt-6 flex gap-3">
                  <button
                    onClick={() => pickGuess('remember')}
                    className="flex-1 rounded-xl bg-emerald-600 py-3 font-medium text-white shadow-sm transition hover:bg-emerald-700"
                  >
                    记得
                  </button>
                  <button
                    onClick={() => pickGuess('forgot')}
                    className="flex-1 rounded-xl bg-stone-200 py-3 font-medium text-stone-600 transition hover:bg-stone-300"
                  >
                    不记得
                  </button>
                </div>
              )}
              {phase === 'revealed' && (
                <>
                  <div className="mt-5 border-t border-stone-100 pt-5">
                    <p className="text-stone-800">{current.meaning}</p>
                    <p className="mt-2 text-sm text-stone-400 italic">{current.example}</p>
                    {current.notes && <p className="mt-2 text-sm text-stone-400">{current.notes}</p>}
                  </div>
                  <div className="mt-6 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span
                        className={
                          'rounded-full px-3 py-1 text-sm font-medium ' +
                          (guess === 'remember' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')
                        }
                      >
                        你的判断:{guess === 'remember' ? '记得' : '不记得'}
                      </span>
                      <button onClick={revoke} className="text-sm text-stone-400 underline hover:text-stone-600">
                        撤回(改选)
                      </button>
                    </div>
                    <button
                      onClick={next}
                      className="rounded-xl bg-indigo-600 px-5 py-2.5 font-medium text-white shadow-sm transition hover:bg-indigo-700"
                    >
                      下一个
                    </button>
                  </div>
                </>
              )}
            </div>
            <button onClick={handleDelete} className="mt-4 text-sm text-stone-400 hover:text-red-600">
              删除(不需要再复习)
            </button>
          </>
        )}
      </div>

      {undo && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-xl bg-stone-800 px-4 py-3 text-white shadow-lg">
          已删除「{undo.term}」
          <button onClick={handleUndo} className="font-medium underline">撤销</button>
        </div>
      )}
    </main>
  );
}
