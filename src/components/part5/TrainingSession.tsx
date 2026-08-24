'use client';

import { useEffect, useMemo, useState } from 'react';
import { elapsedMs, normalizeEditedDuration } from '@/lib/questionReview/timing';
import type { AttemptResult, QuestionOption, SessionQuestion } from '@/lib/questionReview/types';

type Session = { id: number; actualCount: number; questions: SessionQuestion[] };
type PendingAttempt = {
  requestId: string;
  selectedOption: QuestionOption;
  durationMs: number | null;
};

const options: QuestionOption[] = ['A', 'B', 'C', 'D'];

function formatSeconds(durationMs: number | null) {
  return durationMs === null ? '未记录' : (durationMs / 1000).toFixed(1) + ' 秒';
}

async function saveAttempt(sessionId: number, questionId: number, pending: PendingAttempt) {
  const response = await fetch('/api/question-attempts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, questionId, ...pending }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? '作答保存失败，请重试');
  return body as AttemptResult;
}

function QuestionAttempt({
  sessionId,
  question,
  isFinalQuestion,
  onSaved,
  onNext,
}: {
  sessionId: number;
  question: SessionQuestion;
  isFinalQuestion: boolean;
  onSaved: (result: AttemptResult) => void;
  onNext: () => void;
}) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [pendingAttempt, setPendingAttempt] = useState<PendingAttempt | null>(null);
  const [attemptResult, setAttemptResult] = useState<AttemptResult | null>(null);
  const [saveError, setSaveError] = useState('');
  const [editingDuration, setEditingDuration] = useState(false);
  const [editedDuration, setEditedDuration] = useState('');
  const [timingError, setTimingError] = useState('');
  const [timingSaving, setTimingSaving] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setStartedAt(performance.now()));
    return () => cancelAnimationFrame(frame);
  }, []);

  async function submit(pending: PendingAttempt) {
    setSaveError('');
    try {
      const result = await saveAttempt(sessionId, question.id, pending);
      setAttemptResult(result);
      onSaved(result);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '作答保存失败，请重试');
    }
  }

  function selectOption(selectedOption: QuestionOption, endedAt: number) {
    if (pendingAttempt || attemptResult) return;
    const pending = {
      requestId: crypto.randomUUID(),
      selectedOption,
      durationMs: startedAt === null ? null : elapsedMs(startedAt, endedAt),
    };
    setPendingAttempt(pending);
    void submit(pending);
  }

  async function updateTiming(durationMs: number | null, durationExcluded: boolean) {
    if (!attemptResult) return;
    setTimingSaving(true);
    setTimingError('');
    try {
      const response = await fetch('/api/question-attempts/' + attemptResult.attemptId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationMs, durationExcluded }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? '用时保存失败，请重试');
      setAttemptResult(body as AttemptResult);
      setEditingDuration(false);
    } catch {
      setTimingError('用时保存失败，请重试');
    } finally {
      setTimingSaving(false);
    }
  }

  function saveEditedTiming() {
    if (!attemptResult) return;
    try {
      const durationMs = normalizeEditedDuration(editedDuration);
      void updateTiming(durationMs, attemptResult.durationExcluded);
    } catch (error) {
      setTimingError(error instanceof Error ? error.message : '用时不正确');
    }
  }

  return (
    <>
      <p className="mt-6 whitespace-pre-wrap text-base leading-7 text-stone-900">{question.stem}</p>
      {question.source ? <p className="mt-2 text-xs text-stone-500">来源：{question.source}</p> : null}

      <div className="mt-6 grid gap-2" role="group" aria-label="答案选项">
        {options.map((option) => {
          const selected = pendingAttempt?.selectedOption === option;
          const correct = attemptResult?.correctOption === option;
          const revealClass = attemptResult
            ? correct
              ? 'border-emerald-600 bg-emerald-50 text-emerald-950'
              : selected
                ? 'border-red-600 bg-red-50 text-red-950'
                : 'border-stone-200 bg-white text-stone-700'
            : 'border-stone-300 bg-white text-stone-900 hover:border-stone-500 hover:bg-stone-50';
          return (
            <button
              key={option}
              type="button"
              onClick={() => selectOption(option, performance.now())}
              disabled={pendingAttempt !== null || attemptResult !== null}
              className={['grid w-full grid-cols-[2rem_minmax(0,1fr)] items-start gap-3 rounded-md border px-4 py-3 text-left text-sm disabled:cursor-not-allowed', revealClass].join(' ')}
            >
              <span className="font-mono font-semibold">{option}</span>
              <span className="whitespace-pre-wrap leading-6">{question.options[option]}</span>
            </button>
          );
        })}
      </div>

      {pendingAttempt && !attemptResult ? <p className="mt-3 text-sm text-stone-500">正在保存作答…</p> : null}
      {saveError ? <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 border-l-2 border-red-600 bg-red-50 px-3 py-3 text-sm text-red-800"><p>{saveError}</p><button type="button" onClick={() => pendingAttempt && void submit(pendingAttempt)} className="font-medium underline">重试保存</button></div> : null}

      {attemptResult ? <div className="mt-6 border-t border-stone-300 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className={attemptResult.isCorrect ? 'text-sm font-semibold text-emerald-700' : 'text-sm font-semibold text-red-700'}>{attemptResult.isCorrect ? '回答正确' : '回答错误，正确答案是 ' + attemptResult.correctOption}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-stone-600">
              <span>本次用时：{formatSeconds(attemptResult.durationMs)}</span>
              <button type="button" onClick={() => { setEditedDuration(attemptResult.durationMs === null ? '' : String(attemptResult.durationMs / 1000)); setEditingDuration(true); setTimingError(''); }} disabled={timingSaving} className="font-medium text-stone-800 hover:text-stone-500 disabled:text-stone-400">修改用时</button>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={attemptResult.durationExcluded} onChange={(event) => void updateTiming(attemptResult.durationMs, event.target.checked)} disabled={timingSaving} className="h-4 w-4 rounded border-stone-300 text-stone-800 focus:ring-stone-500" />
                本次用时不计入统计
              </label>
            </div>
          </div>
          <button type="button" onClick={onNext} disabled={timingSaving} className="rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-300">{isFinalQuestion ? '完成训练' : '下一题'}</button>
        </div>
        {editingDuration ? <div className="mt-3 flex flex-wrap items-end gap-2 border-l-2 border-stone-400 bg-stone-50 px-3 py-3">
          <label className="text-sm text-stone-700">用时（秒）
            <input autoFocus type="number" min="0" step="0.1" inputMode="decimal" value={editedDuration} onChange={(event) => setEditedDuration(event.target.value)} className="mt-1 block w-32 rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900" />
          </label>
          <button type="button" onClick={saveEditedTiming} disabled={timingSaving} className="rounded-md bg-stone-800 px-3 py-1.5 text-sm font-medium text-white disabled:bg-stone-300">保存用时</button>
          <button type="button" onClick={() => { setEditingDuration(false); setTimingError(''); }} disabled={timingSaving} className="text-sm font-medium text-stone-600 hover:text-stone-900">取消</button>
        </div> : null}
        {timingError ? <p role="alert" className="mt-3 border-l-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800">{timingError}</p> : null}
        <div className="mt-5 border-t border-stone-200 pt-4">
          <h3 className="text-sm font-semibold text-stone-900">解析</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-700">{attemptResult.analysis}</p>
          <h3 className="mt-5 text-sm font-semibold text-stone-900">笔记</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-700">{attemptResult.notes || '暂无笔记'}</p>
        </div>
      </div> : null}
    </>
  );
}

export default function TrainingSession({ session, onExit }: { session: Session; onExit: () => void }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<Record<number, boolean>>({});
  const currentQuestion = session.questions[currentIndex];
  const answeredCount = Object.keys(outcomes).length;
  const correctCount = useMemo(() => Object.values(outcomes).filter(Boolean).length, [outcomes]);
  const wrongCount = answeredCount - correctCount;

  function abandon() {
    if (window.confirm('放弃本次训练？已保存的作答将保留。')) onExit();
  }

  if (!currentQuestion) return null;
  const isFinalQuestion = currentIndex === session.actualCount - 1;

  return (
    <section aria-labelledby="training-session-title">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-300 pb-4">
        <div>
          <p className="font-mono text-xs font-medium text-stone-500">第 {currentIndex + 1} / {session.actualCount} 题</p>
          <h2 id="training-session-title" className="mt-1 text-lg font-semibold text-stone-900">{currentQuestion.categoryPath.join(' / ')}</h2>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-emerald-700">正确 {correctCount}</span>
          <span className="text-red-700">错误 {wrongCount}</span>
          <button type="button" onClick={abandon} className="font-medium text-stone-600 hover:text-stone-950">放弃本次训练</button>
        </div>
      </div>
      <QuestionAttempt
        key={currentQuestion.id}
        sessionId={session.id}
        question={currentQuestion}
        isFinalQuestion={isFinalQuestion}
        onSaved={(result) => setOutcomes((current) => ({ ...current, [currentQuestion.id]: result.isCorrect }))}
        onNext={() => {
          if (isFinalQuestion) onExit();
          else setCurrentIndex((index) => index + 1);
        }}
      />
    </section>
  );
}
