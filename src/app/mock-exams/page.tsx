'use client';
import { useEffect, useState } from 'react';
import { SCENARIOS } from '@/lib/scenarios';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import Pagination, { PAGE_SIZE } from '@/components/Pagination';
import AccuracyBadge from '@/components/AccuracyBadge';

type PracticeType = 'full_mock' | 'part_drill';
type PartScore = { part: 1 | 2 | 3 | 4; correct: number; total: number };
type ScenarioRow = { scenarioMajor: string; scenarioMinor: string; correct: number; total: number };
type PracticeRecord = {
  id: number;
  practiceDate: string;
  type: PracticeType;
  title: string | null;
  parts: PartScore[];
  scenarios: ScenarioRow[];
};

const PART_TOTALS: Record<1 | 2 | 3 | 4, number> = { 1: 6, 2: 25, 3: 39, 4: 30 };
const PART_OPTIONS: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];

function ratioOf(correct: number, total: number) {
  return total > 0 ? correct / total : null;
}

function defaultParts(type: PracticeType): PartScore[] {
  const parts: Array<1 | 2 | 3 | 4> = type === 'full_mock' ? PART_OPTIONS : [2];
  return parts.map((part) => ({ part, correct: 0, total: PART_TOTALS[part] }));
}

function typeLabel(type: PracticeType) {
  return type === 'full_mock' ? '完整模考' : '专项训练';
}

export default function MockExamsPage() {
  const [history, setHistory] = useState<PracticeRecord[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [practiceDate, setPracticeDate] = useState('');
  const [practiceType, setPracticeType] = useState<PracticeType>('full_mock');
  const [title, setTitle] = useState('');
  const [parts, setParts] = useState<PartScore[]>(defaultParts('full_mock'));
  const [scenarios, setScenarios] = useState<ScenarioRow[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageHistory = history.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  async function load() {
    try {
      const res = await fetch('/api/mock-exams');
      if (!res.ok) throw new Error();
      setHistory(await res.json());
    } catch {
      setHistoryError('练习记录加载失败,请刷新重试');
    }
  }
  useEffect(() => { load(); }, []);

  function resetForm() {
    setPracticeDate('');
    setPracticeType('full_mock');
    setTitle('');
    setParts(defaultParts('full_mock'));
    setScenarios([]);
    setError('');
  }

  function changeType(type: PracticeType) {
    setPracticeType(type);
    setParts(defaultParts(type));
    setTitle(type === 'full_mock' ? '' : '专项训练');
  }

  function togglePart(part: 1 | 2 | 3 | 4, enabled: boolean) {
    setParts((prev) => {
      if (enabled) {
        if (prev.some((p) => p.part === part)) return prev;
        return [...prev, { part, correct: 0, total: PART_TOTALS[part] }].sort((a, b) => a.part - b.part);
      }
      return prev.filter((p) => p.part !== part);
    });
  }

  function updatePart(part: 1 | 2 | 3 | 4, field: 'correct' | 'total', value: number) {
    setParts((prev) => prev.map((p) => (p.part === part ? { ...p, [field]: value } : p)));
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
    if (parts.length < 1) {
      setError('至少选择一个 Part');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/mock-exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          practiceDate,
          type: practiceType,
          title: title.trim() || null,
          parts,
          scenarios,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? '保存失败,请重试');
        return;
      }
      resetForm();
      setShowAddModal(false);
      setPage(1);
      load();
    } catch {
      setError('网络错误,请重试');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-50">
      <Header />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-stone-900">练习记录</h1>
          <button
            onClick={() => { resetForm(); setShowAddModal(true); }}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
          >
            + 记录一次练习
          </button>
        </div>

        <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="记录一次练习">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-2">
              {(['full_mock', 'part_drill'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => changeType(type)}
                  className={
                    'rounded-xl px-4 py-2 text-sm font-medium ' +
                    (practiceType === type ? 'bg-indigo-600 text-white' : 'border border-stone-200 bg-white text-stone-600')
                  }
                >
                  {typeLabel(type)}
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-stone-400">练习日期</span>
                <input
                  type="date"
                  value={practiceDate}
                  onChange={(e) => setPracticeDate(e.target.value)}
                  required
                  className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-stone-400">标题/备注(可选)</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={practiceType === 'full_mock' ? '例如 ETS Test 1' : '例如 Part 3 长对话专项'}
                  className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-stone-400">本次包含的 Part</p>
              <div className="flex flex-col gap-3">
                {PART_OPTIONS.map((part) => {
                  const score = parts.find((p) => p.part === part);
                  const enabled = Boolean(score);
                  return (
                    <div key={part} className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
                      <label className="flex w-24 items-center gap-2 text-sm font-medium text-stone-700">
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={practiceType === 'full_mock'}
                          onChange={(e) => togglePart(part, e.target.checked)}
                          className="h-4 w-4 accent-indigo-600"
                        />
                        Part {part}
                      </label>
                      {enabled ? (
                        <>
                          <input
                            type="number"
                            min={0}
                            value={score!.correct}
                            onChange={(e) => updatePart(part, 'correct', Number(e.target.value))}
                            className="w-16 rounded-lg border border-stone-200 px-1.5 py-1 text-center text-sm"
                          />
                          <span className="text-stone-400">/</span>
                          <input
                            type="number"
                            min={1}
                            value={score!.total}
                            onChange={(e) => updatePart(part, 'total', Number(e.target.value))}
                            className="w-16 rounded-lg border border-stone-200 px-1.5 py-1 text-center text-sm"
                          />
                        </>
                      ) : (
                        <span className="text-sm text-stone-400">本次未练</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-stone-400">场景细分(选填)</p>
              <div className="flex flex-col gap-2">
                {scenarios.map((s, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 p-2">
                    <select
                      value={s.scenarioMajor}
                      onChange={(e) => updateScenarioRow(i, { scenarioMajor: e.target.value, scenarioMinor: '未分类' })}
                      className="rounded-lg border border-stone-200 px-2 py-1 text-sm"
                    >
                      {Object.keys(SCENARIOS).map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <select
                      value={s.scenarioMinor}
                      onChange={(e) => updateScenarioRow(i, { scenarioMinor: e.target.value })}
                      className="rounded-lg border border-stone-200 px-2 py-1 text-sm"
                    >
                      {[...SCENARIOS[s.scenarioMajor], '未分类'].map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <div className="flex items-center gap-1">
                      <input type="number" min={0} value={s.correct} onChange={(e) => updateScenarioRow(i, { correct: Number(e.target.value) })} className="w-12 rounded-lg border border-stone-200 px-1.5 py-1 text-center text-sm" />
                      <span className="text-stone-400">/</span>
                      <input type="number" min={1} value={s.total} onChange={(e) => updateScenarioRow(i, { total: Number(e.target.value) })} className="w-12 rounded-lg border border-stone-200 px-1.5 py-1 text-center text-sm" />
                    </div>
                    <button type="button" onClick={() => removeScenarioRow(i)} title="删除这个场景" className="ml-auto text-stone-400 hover:text-red-600">×</button>
                  </div>
                ))}
                <button type="button" onClick={addScenarioRow} className="self-start text-sm font-medium text-indigo-600 hover:text-indigo-700">
                  + 添加场景
                </button>
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={saving}
              className="self-start rounded-xl bg-indigo-600 px-5 py-2.5 font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </form>
        </Modal>

        <h2 className="mb-3 text-lg font-semibold text-stone-900">练习历史</h2>
        {historyError && <p className="mb-3 text-sm text-red-600">{historyError}</p>}
        {history.length === 0 && !historyError ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center text-stone-400 shadow-sm">
            还没有练习记录
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs font-medium text-stone-500">
                <tr>
                  <th className="px-4 py-3.5 text-left">日期</th>
                  <th className="py-3.5 text-left">类型</th>
                  <th className="py-3.5 text-left">Part 成绩</th>
                </tr>
              </thead>
              <tbody>
                {pageHistory.map((r, idx) => (
                  <tr key={r.id} className={idx % 2 === 1 ? 'bg-stone-50/60' : ''}>
                    <td className="px-4 py-4 text-stone-700">{r.practiceDate}</td>
                    <td className="py-4 text-stone-600">
                      <div>{typeLabel(r.type)}</div>
                      {r.title && <div className="mt-1 text-xs text-stone-400">{r.title}</div>}
                    </td>
                    <td className="py-4">
                      <div className="flex flex-wrap gap-2">
                        {r.parts.map((part) => (
                          <div key={part.part} className="flex items-center gap-1 rounded-lg bg-stone-50 px-2 py-1 text-xs text-stone-600">
                            P{part.part} {part.correct}/{part.total}
                            <AccuracyBadge ratio={ratioOf(part.correct, part.total)} />
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />
      </div>
    </main>
  );
}
