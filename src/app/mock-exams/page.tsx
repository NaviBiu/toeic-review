'use client';
import { useEffect, useState } from 'react';
import { SCENARIOS } from '@/lib/scenarios';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import Pagination, { PAGE_SIZE } from '@/components/Pagination';
import AccuracyBadge from '@/components/AccuracyBadge';

type PartScore = { correct: number; total: number };
type ScenarioRow = { scenarioMajor: string; scenarioMinor: string; correct: number; total: number };

const PART_DEFAULTS: Record<string, PartScore> = {
  part1: { correct: 0, total: 6 },
  part2: { correct: 0, total: 25 },
  part3: { correct: 0, total: 39 },
  part4: { correct: 0, total: 30 },
};

function ratioOf(correct: number, total: number) {
  return total > 0 ? correct / total : null;
}

export default function MockExamsPage() {
  const [history, setHistory] = useState<any[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [testDate, setTestDate] = useState('');
  const [parts, setParts] = useState<Record<string, PartScore>>(PART_DEFAULTS);
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
      setHistoryError('模考历史加载失败,请刷新重试');
    }
  }
  useEffect(() => { load(); }, []);

  function updatePart(key: string, field: 'correct' | 'total', value: number) {
    setParts((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
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

  function resetForm() {
    setTestDate('');
    setParts(PART_DEFAULTS);
    setScenarios([]);
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await fetch('/api/mock-exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testDate, ...parts, scenarios }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? '保存失败,请重试');
        return;
      }
      // 模考记录通常一次只录一条,跟错题库"可能连续添加好几条"不一样,
      // 所以这里成功后直接关弹窗,而不是像错题库那样停留等用户手动关闭。
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

  const partLabels: Array<[keyof typeof PART_DEFAULTS, string]> = [
    ['part1', 'Part 1'], ['part2', 'Part 2'], ['part3', 'Part 3'], ['part4', 'Part 4'],
  ];

  return (
    <main className="min-h-screen bg-stone-50">
      <Header />
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-stone-900">模考记录</h1>
          <button
            onClick={() => { resetForm(); setShowAddModal(true); }}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
          >
            + 记录一次模考
          </button>
        </div>

        <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="记录一次模考">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-400">模考日期</label>
              <input
                type="date"
                value={testDate}
                onChange={(e) => setTestDate(e.target.value)}
                required
                className="rounded-xl border border-stone-200 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-stone-400">各 Part 得分</p>
              <div className="grid grid-cols-2 gap-3">
                {partLabels.map(([key, label]) => (
                  <div key={key} className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
                    <span className="w-14 shrink-0 text-sm font-medium text-stone-600">{label}</span>
                    <input
                      type="number"
                      value={parts[key].correct}
                      onChange={(e) => updatePart(key, 'correct', Number(e.target.value))}
                      className="w-12 rounded-lg border border-stone-200 px-1.5 py-1 text-center text-sm"
                    />
                    <span className="text-stone-400">/</span>
                    <input
                      type="number"
                      value={parts[key].total}
                      onChange={(e) => updatePart(key, 'total', Number(e.target.value))}
                      className="w-12 rounded-lg border border-stone-200 px-1.5 py-1 text-center text-sm"
                    />
                  </div>
                ))}
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
                      <input type="number" value={s.correct} onChange={(e) => updateScenarioRow(i, { correct: Number(e.target.value) })} className="w-12 rounded-lg border border-stone-200 px-1.5 py-1 text-center text-sm" />
                      <span className="text-stone-400">/</span>
                      <input type="number" value={s.total} onChange={(e) => updateScenarioRow(i, { total: Number(e.target.value) })} className="w-12 rounded-lg border border-stone-200 px-1.5 py-1 text-center text-sm" />
                    </div>
                    <button type="button" onClick={() => removeScenarioRow(i)} title="删除这个场景" className="ml-auto text-stone-400 hover:text-red-600">✕</button>
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

        <h2 className="mb-3 text-lg font-semibold text-stone-900">模考历史</h2>
        {historyError && <p className="mb-3 text-sm text-red-600">{historyError}</p>}
        {history.length === 0 && !historyError ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center text-stone-400 shadow-sm">
            还没有模考记录
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs font-medium text-stone-500">
                <tr>
                  <th className="px-4 py-2.5 text-left">日期</th>
                  <th className="py-2.5">P1</th>
                  <th className="py-2.5">P2</th>
                  <th className="py-2.5">P3</th>
                  <th className="py-2.5">P4</th>
                </tr>
              </thead>
              <tbody>
                {pageHistory.map((r, idx) => (
                  <tr key={r.id} className={idx % 2 === 1 ? 'bg-stone-50/60' : ''}>
                    <td className="px-4 py-2.5 text-stone-700">{r.testDate}</td>
                    {(['part1', 'part2', 'part3', 'part4'] as const).map((p) => (
                      <td key={p} className="text-center">
                        <div className="text-stone-600">{r[p].correct}/{r[p].total}</div>
                        <AccuracyBadge ratio={ratioOf(r[p].correct, r[p].total)} />
                      </td>
                    ))}
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
