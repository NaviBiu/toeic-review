'use client';
import { useEffect, useState } from 'react';
import { SCENARIOS } from '@/lib/scenarios';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import Pagination, { PAGE_SIZE } from '@/components/Pagination';
import AccuracyBadge from '@/components/AccuracyBadge';
import {
  LISTENING_800_TARGETS,
  buildPartDiagnostics,
  ratioOf,
  type PartDiagnostic,
  type PartAttempt,
} from '@/lib/practiceAnalytics';

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
type Tab = 'analysis' | 'records';

const PART_TOTALS: Record<1 | 2 | 3 | 4, number> = { 1: 6, 2: 25, 3: 39, 4: 30 };
const PART_OPTIONS: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];

function defaultParts(type: PracticeType): PartScore[] {
  const parts: Array<1 | 2 | 3 | 4> = type === 'full_mock' ? PART_OPTIONS : [2];
  return parts.map((part) => ({ part, correct: 0, total: PART_TOTALS[part] }));
}

function typeLabel(type: PracticeType) {
  return type === 'full_mock' ? '完整模考' : '专项训练';
}

function formatPct(ratio: number | null) {
  return ratio === null ? '-' : `${Math.round(ratio * 100)}%`;
}

function formatGap(ratio: number | null) {
  if (ratio === null) return '暂无数据';
  const points = Math.round(Math.abs(ratio) * 100);
  if (points === 0) return '贴近基准';
  return ratio > 0 ? `高于基准 ${points}%` : `低于基准 ${points}%`;
}

function trendLabel(trend: PartDiagnostic['trend']) {
  if (trend === 'improving') return '长期趋势上升';
  if (trend === 'declining') return '长期趋势下降';
  if (trend === 'flat') return '长期基本持平';
  return '数据还不够判断趋势';
}

function diagnosticTone(diagnostic: PartDiagnostic) {
  if (diagnostic.status === 'at_target') return '稳定达标';
  if (diagnostic.part === 1) return '基础分不该丢';
  return '需要额外练习';
}

function buildHeadline(diagnostics: PartDiagnostic[]) {
  const weakest = [...diagnostics]
    .filter((diagnostic) => diagnostic.status === 'below_target')
    .sort((a, b) => (a.longTermRatio ?? 1) - a.targetRatio - ((b.longTermRatio ?? 1) - b.targetRatio))[0];

  if (!weakest) return '目前有记录的 Part 长期表现都在 800 基准线附近或以上。';

  return `当前最需要补的是 Part ${weakest.part}: 长期正确率${formatGap(
    (weakest.longTermRatio ?? 0) - weakest.targetRatio,
  )}, ${trendLabel(weakest.trend)}。`;
}

function chartY(ratio: number, top = 16, bottom = 112) {
  const clamped = Math.max(0, Math.min(1, ratio));
  return bottom - clamped * (bottom - top);
}

function PartDiagnosticChart({ diagnostic }: { diagnostic: PartDiagnostic }) {
  const points = diagnostic.attempts;
  const polyline = points
    .map((point, index) => {
      const x = points.length === 1 ? 160 : 24 + (index * 272) / (points.length - 1);
      const y = chartY(point.ratio ?? 0);
      return `${x},${y}`;
    })
    .join(' ');
  const targetY = chartY(diagnostic.targetRatio);

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Part {diagnostic.part}</h2>
          <p className="mt-1 text-xs text-stone-500">{diagnostic.role}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-stone-900">{diagnosticTone(diagnostic)}</p>
          <p className="mt-1 text-xs text-stone-500">{trendLabel(diagnostic.trend)}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_150px] sm:items-center">
        <svg viewBox="0 0 320 130" className="h-40 w-full overflow-visible">
          <line x1="24" y1="16" x2="296" y2="16" stroke="#e7e5e4" strokeWidth="1" />
          <line x1="24" y1="64" x2="296" y2="64" stroke="#f5f5f4" strokeWidth="1" />
          <line x1="24" y1="112" x2="296" y2="112" stroke="#e7e5e4" strokeWidth="1" />
          <line x1="24" y1={targetY} x2="296" y2={targetY} stroke="#dc2626" strokeWidth="2" strokeDasharray="5 5" />
          <text x="300" y={targetY + 4} fill="#dc2626" fontSize="10">
            {formatPct(diagnostic.targetRatio)}
          </text>
          <polyline points={polyline} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((point, index) => {
            const x = points.length === 1 ? 160 : 24 + (index * 272) / (points.length - 1);
            const y = chartY(point.ratio ?? 0);
            return (
              <g key={point.id}>
                <circle cx={x} cy={y} r="4" fill="#2563eb" />
                {index === points.length - 1 && (
                  <text x={Math.min(x + 8, 250)} y={y - 8} fill="#1c1917" fontSize="11" fontWeight="600">
                    {formatGap(point.gapToTarget)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        <div className="rounded-xl bg-stone-50 p-3">
          <p className="text-xs text-stone-500">长期正确率</p>
          <p className="mt-1 text-2xl font-bold text-stone-900">{formatPct(diagnostic.longTermRatio)}</p>
          <p className="mt-3 text-xs text-stone-500">800 基准</p>
          <p className="mt-1 text-sm font-medium text-stone-800">
            至少 {diagnostic.targetCorrect}/{PART_TOTALS[diagnostic.part]}, 最多错 {diagnostic.maxWrong}
          </p>
          <p className="mt-3 text-xs font-medium text-stone-600">{formatGap((diagnostic.longTermRatio ?? 0) - diagnostic.targetRatio)}</p>
        </div>
      </div>
    </section>
  );
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
  const [tab, setTab] = useState<Tab>('analysis');
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageHistory = history.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const partAttempts: PartAttempt[] = history.flatMap((record) =>
    record.parts.map((part) => ({
      id: record.id,
      date: record.practiceDate,
      part: part.part,
      correct: part.correct,
      total: part.total,
    })),
  );
  const diagnostics = buildPartDiagnostics(partAttempts);
  const diagnosticsByPart = new Map(diagnostics.map((diagnostic) => [diagnostic.part, diagnostic]));

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

        <div className="mb-6 flex rounded-xl border border-stone-200 bg-white p-1 shadow-sm">
          {([
            ['analysis', '分析'],
            ['records', '记录'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={
                'flex-1 rounded-lg px-4 py-2 text-sm font-medium ' +
                (tab === value ? 'bg-stone-900 text-white' : 'text-stone-500 hover:bg-stone-50')
              }
            >
              {label}
            </button>
          ))}
        </div>

        {historyError && <p className="mb-3 text-sm text-red-600">{historyError}</p>}

        {tab === 'analysis' ? (
          history.length === 0 && !historyError ? (
            <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center text-stone-400 shadow-sm">
              还没有练习记录
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-medium text-stone-500">800 目标诊断</p>
                <h2 className="mt-2 text-xl font-bold leading-snug text-stone-950">{buildHeadline(diagnostics)}</h2>
                <p className="mt-3 text-sm leading-6 text-stone-600">
                  听力目标按 400 分估算: 整体约答对 83 题。Part 1 按满分要求, Part 2/3/4 分别按 88%/82%/77% 作为基准线。
                </p>
              </section>

              {PART_OPTIONS.map((part) => {
                const diagnostic = diagnosticsByPart.get(part);
                const target = LISTENING_800_TARGETS[part];
                if (!diagnostic) {
                  return (
                    <section key={part} className="rounded-2xl border border-dashed border-stone-200 bg-white p-5 text-stone-500">
                      <h2 className="text-lg font-semibold text-stone-900">Part {part}</h2>
                      <p className="mt-2 text-sm">还没有这个 Part 的练习记录。基准线: {formatPct(target.targetRatio)}, 至少 {target.targetCorrect}/{PART_TOTALS[part]}。</p>
                    </section>
                  );
                }

                return <PartDiagnosticChart key={part} diagnostic={diagnostic} />;
              })}
            </div>
          )
        ) : (
          <>
            <h2 className="mb-3 text-lg font-semibold text-stone-900">练习历史</h2>
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
          </>
        )}
      </div>
    </main>
  );
}
