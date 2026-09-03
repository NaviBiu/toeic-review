'use client';

import { useEffect, useState } from 'react';
import ReviewItemActions from '@/components/ReviewItemActions';
import { useWorkMode } from '@/hooks/useWorkMode';
import { workReviewCopy } from '@/lib/disguiseMode';
import { SCENARIOS } from '@/lib/scenarios';

export type ListeningReviewItem = {
  id: number;
  term: string;
  meaning: string;
  example: string;
  notes: string | null;
};

type Props = {
  mode: 'study' | 'work';
  prefetched: ListeningReviewItem[];
  active: boolean;
  onPendingChange?: (count: number) => void;
};

export default function ListeningReview({ mode, prefetched, active, onPendingChange }: Props) {
  const { skin } = useWorkMode();
  const [queue, setQueue] = useState(prefetched);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<'guessing' | 'revealed'>('guessing');
  const [guess, setGuess] = useState<'remember' | 'forgot' | null>(null);
  const [undo, setUndo] = useState<{ id: number; term: string; index: number } | null>(null);
  const [majorFilter, setMajorFilter] = useState('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');

  async function loadQueue(filter: string) {
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams();
      if (filter) params.set('scenarioMajor', filter);
      const response = await fetch(`/api/review/queue?${params}`);
      if (!response.ok) throw new Error('队列加载失败,请刷新重试');
      setQueue(await response.json() as ListeningReviewItem[]);
      setIndex(0);
      setPhase('guessing');
      setGuess(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '网络错误,请刷新重试');
    } finally {
      setLoading(false);
    }
  }

  function changeMajorFilter(filter: string) {
    setMajorFilter(filter);
    void loadQueue(filter);
  }

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const loadVoices = () => {
      const english = window.speechSynthesis.getVoices().filter((voice) => /^en[-_]/i.test(voice.lang));
      setVoices(english);
      const saved = window.localStorage.getItem('toeic-speech-voice');
      const preferred = english.find((voice) => voice.name === saved)
        ?? english.find((voice) => /natural|online/i.test(voice.name))
        ?? english.find((voice) => /^en-US/i.test(voice.lang));
      if (preferred) setVoiceName(preferred.name);
    };
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, []);

  function changeVoice(name: string) {
    setVoiceName(name);
    window.localStorage.setItem('toeic-speech-voice', name);
  }

  const current = queue[index];
  const remaining = Math.max(0, queue.length - index);

  useEffect(() => onPendingChange?.(remaining), [onPendingChange, remaining]);

  function utter(text: string, onend?: () => void) {
    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = 'en-US';
    speech.voice = voices.find((voice) => voice.name === voiceName) ?? null;
    if (onend) speech.onend = onend;
    return speech;
  }

  function speak(text: string) {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter(text));
  }

  function speakSequence(texts: string[]) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    let position = 0;
    function playNext() {
      const text = texts[position++];
      if (!text) return;
      window.speechSynthesis.speak(utter(text, position < texts.length ? playNext : undefined));
    }
    playNext();
  }

  useEffect(() => {
    if (!active) {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      return;
    }
    if (current) speakSequence([current.term, current.example]);
    // Replay only for a newly shown card or reveal phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, current?.id, phase]);

  useEffect(() => () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  useEffect(() => {
    if (!active) return;
    function keydown(event: KeyboardEvent) {
      if (event.key === 'ArrowRight' && phase === 'revealed') void next();
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, phase, current, guess]);

  function pickGuess(value: 'remember' | 'forgot') {
    setGuess(value);
    setPhase('revealed');
  }

  function revoke() {
    setGuess((value) => value === 'remember' ? 'forgot' : 'remember');
  }

  async function next() {
    setActionError('');
    if (current && guess) {
      try {
        const response = await fetch(`/api/review/${current.id}/answer`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ correct: guess === 'remember' }),
        });
        if (!response.ok) { setActionError('保存失败,这条结果还没记上,请重试'); return; }
      } catch {
        setActionError('网络错误,这条结果还没记上,请重试');
        return;
      }
      if (guess === 'forgot') setQueue((items) => [...items, current]);
    }
    setIndex((value) => value + 1);
    setPhase('guessing');
    setGuess(null);
  }

  async function updateStatus(status: 'deleted' | 'mastered') {
    if (!current) return;
    setActionError('');
    const removed = { id: current.id, term: current.term, index };
    try {
      const response = await fetch(`/api/knowledge-points/${current.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) { setActionError('删除失败,请重试'); return; }
    } catch {
      setActionError('网络错误,删除失败,请重试');
      return;
    }
    if (status === 'deleted') {
      setUndo(removed);
      window.setTimeout(() => setUndo((value) => value?.id === removed.id ? null : value), 5000);
    }
    setIndex((value) => value + 1);
    setPhase('guessing');
    setGuess(null);
  }

  async function handleUndo() {
    if (!undo) return;
    try {
      const response = await fetch(`/api/knowledge-points/${undo.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      if (!response.ok) { setActionError('撤销失败,请重试'); return; }
    } catch {
      setActionError('网络错误,撤销失败,请重试');
      return;
    }
    setIndex(undo.index);
    setPhase('guessing');
    setGuess(null);
    setUndo(null);
  }

  const itemActions = (
    <ReviewItemActions mode={mode} onMastered={() => void updateStatus('mastered')} onDelete={() => void updateStatus('deleted')} className={mode === 'work' ? 'mt-5 justify-end border-t border-slate-200 pt-4' : 'mt-3 justify-end'} />
  );

  const workItem = current ? (
    <section className="mt-6 border border-slate-300 bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 font-mono text-[11px] uppercase text-slate-500"><span>Current item</span><span>Priority: standard</span></header>
      <div className="p-6">
        <div className="flex items-center gap-2"><p className={`font-mono text-2xl font-semibold text-slate-950${phase === 'guessing' ? ' blur-md select-none' : ''}`}>{current.term}</p><button type="button" onClick={() => speak(current.term)} title={workReviewCopy.termAudio} className="rounded-full p-1.5 text-slate-500">🔊</button></div>
        <div className="mt-3 flex items-center gap-2"><p className={`font-mono text-sm italic text-slate-500${phase === 'guessing' ? ' blur-md select-none' : ''}`}>{current.example}</p><button type="button" onClick={() => speak(current.example)} title={workReviewCopy.exampleAudio} className="rounded-full p-1 text-slate-500">🔊</button></div>
        {phase === 'guessing' ? <div className="mt-7 flex gap-3"><button type="button" onClick={() => pickGuess('remember')} className="flex-1 border border-slate-700 bg-slate-700 py-3 font-mono text-sm text-white">{workReviewCopy.confirmed}</button><button type="button" onClick={() => pickGuess('forgot')} className="flex-1 border border-slate-300 bg-white py-3 font-mono text-sm text-slate-700">{workReviewCopy.followUp}</button></div> : <div className="mt-6 border-t border-slate-200 pt-5"><p className="font-mono text-sm text-slate-600">Decision recorded for this reference. Continue when ready to review the next item.</p><div className="mt-5 border-y border-slate-200 py-4"><p className="font-mono text-[11px] font-semibold uppercase text-slate-700">Reference analysis</p><p className="mt-3 text-sm text-slate-700">{current.meaning}</p><p className="mt-3 text-xs text-slate-500">{current.notes || 'No additional analysis recorded.'}</p></div><div className="mt-5 flex items-center justify-between"><div className="flex items-center gap-3"><span className={`rounded-full px-3 py-1 font-mono text-xs ${guess === 'remember' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{guess === 'remember' ? workReviewCopy.confirmed : workReviewCopy.followUp}</span><button type="button" onClick={revoke} title={workReviewCopy.revert} aria-label={workReviewCopy.revert} className="rounded-full p-1.5 text-slate-500">↩</button></div><button type="button" onClick={() => void next()} className="border border-slate-700 bg-slate-700 px-4 py-2 font-mono text-sm text-white">{workReviewCopy.continue}</button></div></div>}
        {itemActions}
      </div>
    </section>
  ) : null;

  if (mode === 'work') {
    return (
      <section className={`work-review-document work-skin-${skin.id} mx-auto max-w-4xl px-4 py-8 sm:px-6`} aria-label="Listening review">
        <section className="border border-slate-300 bg-white shadow-sm">
          <header className="border-b border-slate-200 px-6 py-6 sm:px-8"><p className="font-mono text-[11px] uppercase text-slate-400">{skin.title} / section 01</p><div className="mt-2 flex items-end justify-between gap-3"><h1 className="font-mono text-2xl font-semibold text-slate-950">{skin.reviewTitle}</h1><span className="border border-slate-300 px-2 py-1 font-mono text-[11px] text-slate-600">{workReviewCopy.pending(remaining)}</span></div></header>
          <div className="p-6 sm:p-8"><div className="grid gap-8 border-b border-slate-200 pb-8 lg:grid-cols-[1.15fr_.85fr]"><div><p className="font-mono text-[11px] uppercase text-slate-500">Document purpose</p><p className="mt-3 text-base leading-7 text-slate-600">This document records the current review queue and confirms whether each referenced item satisfies the expected interpretation and context requirements.</p></div><div className="grid grid-cols-2 border border-slate-300 font-mono text-xs text-slate-600"><div className="border-b border-r border-slate-300 p-3">Owner<p className="mt-1 text-slate-900">Language Ops</p></div><div className="border-b border-slate-300 p-3">Revision<p className="mt-1 text-slate-900">0.8</p></div><div className="border-r border-slate-300 p-3">Items pending<p className="mt-1 text-slate-900">{workReviewCopy.pending(remaining)}</p></div><div className="p-3">Classification<p className="mt-1 text-slate-900">Internal</p></div></div></div>
            {actionError ? <p className="mt-4 border-l-2 border-amber-600 bg-amber-50 px-3 py-2 text-sm text-amber-800">{workReviewCopy.saveError}</p> : null}
            {loading ? <p className="py-12 text-center font-mono text-sm text-slate-500">{workReviewCopy.loading}</p> : loadError ? <p className="py-12 text-center font-mono text-sm text-slate-600">{workReviewCopy.loadError}</p> : current ? workItem : <p className="py-12 text-center font-mono text-sm text-slate-600">{workReviewCopy.empty}</p>}
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-xl px-4 py-8 sm:px-6" aria-label="听力复盘">
      <div className="mb-6 flex items-center justify-between"><h2 className="text-lg font-semibold text-stone-900">听力复盘</h2>{remaining > 0 ? <span className="text-sm text-stone-500">剩余 {remaining} 个</span> : null}</div>
      <div className="mb-6 flex flex-wrap gap-2"><select value={majorFilter} onChange={(event) => changeMajorFilter(event.target.value)} className="rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"><option value="">全部场景</option>{Object.keys(SCENARIOS).map((item) => <option key={item} value={item}>{item}</option>)}</select>{voices.length > 0 ? <select aria-label="选择英语音色" value={voiceName} onChange={(event) => changeVoice(event.target.value)} className="max-w-56 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"><option value="">选择英语音色</option>{voices.map((voice) => <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name} ({voice.lang})</option>)}</select> : null}</div>
      {actionError ? <p className="mb-4 text-sm text-red-600">{actionError}</p> : null}
      {loading ? <div className="border border-stone-200 bg-white p-10 text-center text-stone-400">加载中…</div> : loadError ? <div className="border border-red-200 bg-red-50 p-10 text-center text-red-600">{loadError}</div> : !current ? <div className="border border-stone-200 bg-white p-10 text-center text-stone-500">今天没有需要复盘的内容</div> : <><div className="rounded-md border border-stone-200 bg-white p-8 shadow-sm"><div className="flex items-center gap-2"><p className={`text-3xl font-bold text-stone-900${phase === 'guessing' ? ' blur-md select-none' : ''}`}>{current.term}</p><button type="button" onClick={() => speak(current.term)} title="朗读" className="rounded-full p-1.5 text-stone-400">🔊</button></div><div className="mt-3 flex items-center gap-2"><p className={`text-sm italic text-stone-400${phase === 'guessing' ? ' blur-md select-none' : ''}`}>{current.example}</p><button type="button" onClick={() => speak(current.example)} title="朗读例句" className="rounded-full p-1 text-stone-400">🔊</button></div>{phase === 'guessing' ? <div className="mt-6 flex gap-3"><button type="button" onClick={() => pickGuess('remember')} className="flex-1 rounded-md bg-emerald-700 py-3 font-medium text-white">记得</button><button type="button" onClick={() => pickGuess('forgot')} className="flex-1 rounded-md bg-stone-200 py-3 font-medium text-stone-700">不记得</button></div> : <><div className="mt-5 border-t border-stone-100 pt-5"><p>{current.meaning}</p>{current.notes ? <p className="mt-2 text-sm text-stone-500">{current.notes}</p> : null}</div><div className="mt-6 flex items-center justify-between"><div className="flex items-center gap-3"><span className={`rounded-full px-3 py-1 text-sm ${guess === 'remember' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>你的判断:{guess === 'remember' ? '记得' : '不记得'}</span><button type="button" onClick={revoke} title="撤回(改选)" aria-label="撤回(改选)" className="rounded-full p-1.5 text-stone-400">↺</button></div><button type="button" onClick={() => void next()} className="rounded-md bg-indigo-600 px-5 py-2.5 text-lg text-white">→</button></div></>}</div>{itemActions}</>}
      {undo ? <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-md bg-stone-900 px-4 py-3 text-white shadow-lg">已删除「{undo.term}」<button type="button" onClick={() => void handleUndo()} className="font-medium underline">撤销</button></div> : null}
    </section>
  );
}
