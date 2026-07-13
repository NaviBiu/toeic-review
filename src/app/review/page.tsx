'use client';
import { useEffect, useState } from 'react';
import { SCENARIOS } from '@/lib/scenarios';
import Header from '@/components/Header';

type KP = { id: number; term: string; meaning: string; example: string; notes: string | null };

export default function ReviewPage() {
  const [queue, setQueue] = useState<KP[]>([]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<'guessing' | 'revealed'>('guessing');
  const [guess, setGuess] = useState<'remember' | 'forgot' | null>(null);
  const [undo, setUndo] = useState<{ id: number; term: string; index: number } | null>(null);
  const [majorFilter, setMajorFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');

  async function loadQueue() {
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams();
      if (majorFilter) params.set('scenarioMajor', majorFilter);
      const res = await fetch(`/api/review/queue?${params}`);
      if (!res.ok) throw new Error('队列加载失败,请刷新重试');
      const data: KP[] = await res.json();
      setQueue(data);
      setIndex(0);
      setPhase('guessing');
      setGuess(null);
    } catch (err: any) {
      // Without this, a failed fetch left `queue` as [] -- indistinguishable
      // from a genuinely empty "今天没有需要复盘的内容" state.
      setLoadError(err.message ?? '网络错误,请刷新重试');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadQueue(); }, [majorFilter]);

  const current = queue[index];

  // Browser-native TTS (Web Speech API) -- zero API cost, runs entirely on
  // the device, no network call to anything.
  function speak(text: string) {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  }

  // Plays each text in order, term then example, stopping after one full
  // pass (no looping). Used for the automatic phase-transition playback;
  // manual 🔊 clicks use the single-text `speak` above instead.
  function speakSequence(texts: string[]) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    let i = 0;
    function playNext() {
      if (i >= texts.length) return;
      const text = texts[i++];
      if (!text) { playNext(); return; }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.onend = playNext;
      window.speechSynthesis.speak(utterance);
    }
    playNext();
  }

  // Auto-plays term then example once whenever a card is freshly shown --
  // once "blind" (考察页, masked, phase=guessing -- this is the actual
  // listening test: can you recognize it by ear with nothing to read) and
  // once again on reveal (答案页, phase=revealed, full text + audio
  // together as reinforcement). Re-fires whenever the current item or
  // phase changes, not on every render.
  useEffect(() => {
    if (!current) return;
    speakSequence([current.term, current.example]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, phase]);

  // Stop any in-progress speech when leaving the page entirely.
  useEffect(() => {
    return () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); };
  }, []);

  // → triggers the same action as clicking 下一个, but only once an answer
  // has actually been revealed (otherwise there is nothing to advance from).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' && phase === 'revealed') {
        next();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, current, guess]);

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
    setActionError('');
    if (current && guess) {
      try {
        const res = await fetch(`/api/review/${current.id}/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ correct: guess === 'remember' }),
        });
        if (!res.ok) {
          // Do NOT advance -- guess/phase stay exactly as they are so the
          // user can just click 下一个 again. Previously this result was
          // silently dropped and the UI moved on as if it had been saved.
          setActionError('保存失败,这条结果还没记上,请重试');
          return;
        }
      } catch {
        setActionError('网络错误,这条结果还没记上,请重试');
        return;
      }
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
    setActionError('');
    const deletedId = current.id;
    const deletedTerm = current.term;
    const deletedIndex = index;
    try {
      const res = await fetch(`/api/knowledge-points/${deletedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'deleted' }),
      });
      if (!res.ok) {
        setActionError('删除失败,请重试');
        return;
      }
    } catch {
      setActionError('网络错误,删除失败,请重试');
      return;
    }
    setUndo({ id: deletedId, term: deletedTerm, index: deletedIndex });
    setTimeout(() => setUndo((u) => (u?.id === deletedId ? null : u)), 5000);
    setIndex((i) => i + 1);
    setPhase('guessing');
    setGuess(null);
  }

  async function handleUndo() {
    if (!undo) return;
    try {
      const res = await fetch(`/api/knowledge-points/${undo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      if (!res.ok) {
        setActionError('撤销失败,请重试');
        return;
      }
    } catch {
      setActionError('网络错误,撤销失败,请重试');
      return;
    }
    // Jump back to exactly where it was -- as if the delete never happened,
    // not just "restored in the database but gone from this session".
    setIndex(undo.index);
    setPhase('guessing');
    setGuess(null);
    setUndo(null);
  }

  const remaining = Math.max(0, queue.length - index);

  return (
    <main className="min-h-screen bg-stone-50">
      <Header />
      <div className="mx-auto max-w-xl px-6 py-12">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-stone-900">今日复盘</h1>
          {remaining > 0 && (
            <div className="text-sm font-medium text-stone-400">剩余 {remaining} 个</div>
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

        {actionError && <p className="mb-4 text-sm text-red-600">{actionError}</p>}

        {loading ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center text-stone-400 shadow-sm">
            加载中…
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-10 text-center text-red-600 shadow-sm">
            {loadError}
          </div>
        ) : !current ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center shadow-sm">
            <p className="text-2xl">🎉</p>
            <p className="mt-3 text-stone-500">今天没有需要复盘的内容</p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
              {/* 考察页(guessing): term + example shown but masked -- this is the
                  actual listening test, recognize it by ear with nothing to read.
                  答案页(revealed): both unmasked, plus meaning/notes. */}
              <div className="flex items-center gap-2">
                <p className={'text-3xl font-bold text-stone-900' + (phase === 'guessing' ? ' blur-md select-none' : '')}>
                  {current.term}
                </p>
                <button
                  onClick={() => speak(current.term)}
                  title="朗读"
                  className="rounded-full p-1.5 text-stone-400 hover:bg-stone-100 hover:text-indigo-600"
                >
                  🔊
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <p className={'text-sm text-stone-400 italic' + (phase === 'guessing' ? ' blur-md select-none' : '')}>
                  {current.example}
                </p>
                <button
                  onClick={() => speak(current.example)}
                  title="朗读例句"
                  className="shrink-0 rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-indigo-600"
                >
                  🔊
                </button>
              </div>

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
                      <button
                        onClick={revoke}
                        title="撤回(改选)"
                        className="rounded-full p-1.5 text-stone-400 hover:bg-stone-100 hover:text-indigo-600"
                      >
                        ↺
                      </button>
                    </div>
                    <button
                      onClick={next}
                      title="下一个 (键盘 →)"
                      className="rounded-xl bg-indigo-600 px-5 py-2.5 text-lg font-medium text-white shadow-sm transition hover:bg-indigo-700"
                    >
                      →
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              onClick={handleDelete}
              title="删除(不需要再复习)"
              className="mt-4 rounded-full p-1.5 text-stone-400 hover:bg-stone-100 hover:text-red-600"
            >
              🗑️
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
