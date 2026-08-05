'use client';
import { useEffect, useState } from 'react';
import { SCENARIOS } from '@/lib/scenarios';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import Pagination, { PAGE_SIZE } from '@/components/Pagination';
import AccuracyBadge from '@/components/AccuracyBadge';
import { formatPracticeSource } from '@/lib/practiceRecordView';
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
type PracticeAttachment = { id: number; name: string; mimeType: string; dataUrl: string };
type PracticeRecord = {
  id: number;
  practiceDate: string;
  type: PracticeType;
  title: string | null;
  parts: PartScore[];
  scenarios: ScenarioRow[];
  attachments: PracticeAttachment[];
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

function PracticeRecordListItem({
  record,
  onPreview,
  onManage,
}: {
  record: PracticeRecord;
  onPreview: (attachment: PracticeAttachment) => void;
  onManage: (record: PracticeRecord) => void;
}) {
  const source = formatPracticeSource(record.title);
  const firstAttachment = record.attachments?.[0];

  return (
    <article className="grid gap-5 border-b border-stone-200 px-5 py-5 last:border-b-0 md:grid-cols-[112px_minmax(180px,1fr)_minmax(250px,1.2fr)_150px] md:items-center md:px-6">
      <div>
        <p className="text-xs font-medium text-stone-400">练习日期</p>
        <time className="mt-1 block whitespace-nowrap font-mono text-sm font-semibold tabular-nums text-stone-800">{record.practiceDate}</time>
      </div>

      <div className="min-w-0">
        <p className="text-sm font-semibold text-stone-900">{typeLabel(record.type)}</p>
        {source.label ? (
          source.href ? <a href={source.href} target="_blank" rel="noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 hover:underline">{source.label}<span aria-hidden="true">↗</span></a>
            : <p className="mt-1 truncate text-sm text-stone-500" title={source.label}>{source.label}</p>
        ) : <p className="mt-1 text-sm text-stone-400">未填写来源</p>}
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-stone-400">Part 成绩</p>
        <div className="grid grid-cols-2 gap-2">
          {record.parts.map((part) => (
            <div key={part.part} className="flex min-h-9 items-center justify-between gap-2 rounded-md bg-stone-100 px-3 py-1.5 text-sm text-stone-700">
              <span className="whitespace-nowrap font-medium">P{part.part} {part.correct}/{part.total}</span>
              <AccuracyBadge ratio={ratioOf(part.correct, part.total)} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 md:justify-end">
        {firstAttachment ? (
          <button type="button" onClick={() => onPreview(firstAttachment)} title="查看错题图片" className="relative h-16 w-20 shrink-0 overflow-hidden rounded-md border border-stone-200 bg-stone-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
            <img src={firstAttachment.dataUrl} alt={firstAttachment.name} className="h-full w-full object-cover" />
            {record.attachments.length > 1 ? <span className="absolute bottom-1 right-1 rounded bg-stone-950/75 px-1.5 py-0.5 text-[10px] font-medium text-white">+{record.attachments.length - 1}</span> : null}
          </button>
        ) : null}
        <button type="button" onClick={() => onManage(record)} className="whitespace-nowrap rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 hover:border-indigo-300 hover:text-indigo-700">{firstAttachment ? '管理图片' : '添加图片'}</button>
      </div>
    </article>
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
  const [attachments, setAttachments] = useState<PracticeAttachment[]>([]);
  const [editingRecord, setEditingRecord] = useState<PracticeRecord | null>(null);
  const [editingAttachments, setEditingAttachments] = useState<PracticeAttachment[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<PracticeAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState('');
  const [savingAttachments, setSavingAttachments] = useState(false);
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
    setAttachments([]);
    setError('');
  }

  async function handleAttachmentChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 5) { setError('最多上传 5 张错题图片'); return; }
    if (files.some((file) => !file.type.startsWith('image/'))) { setError('错题附件只能是图片'); return; }
    if (files.reduce((sum, file) => sum + file.size, 0) > 3_000_000) { setError('错题图片合计不能超过约 3 MB'); return; }
    try {
      const next = await Promise.all(files.map((file) => new Promise<PracticeAttachment>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ id: 0, name: file.name, mimeType: file.type, dataUrl: String(reader.result) });
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(file);
      })));
      setError('');
      setAttachments(next);
    } catch (err: any) {
      setError(err.message ?? '图片读取失败');
    }
  }

  function removeAttachment(index: number) {
    setAttachments((current) => current.filter((_, i) => i !== index));
  }

  function openAttachmentEditor(record: PracticeRecord) {
    setEditingRecord(record);
    setEditingAttachments(record.attachments ?? []);
    setAttachmentError('');
  }

  async function handleEditAttachmentChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (editingAttachments.length + files.length > 5) { setAttachmentError('每条成绩最多保存 5 张错题图片'); return; }
    if (files.some((file) => !file.type.startsWith('image/'))) { setAttachmentError('错题附件只能是图片'); return; }
    const existingBytes = editingAttachments.reduce((sum, item) => sum + Math.ceil(item.dataUrl.length * 0.75), 0);
    if (existingBytes + files.reduce((sum, file) => sum + file.size, 0) > 3_000_000) { setAttachmentError('错题图片合计不能超过约 3 MB'); return; }
    try {
      const next = await Promise.all(files.map((file) => new Promise<PracticeAttachment>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ id: 0, name: file.name, mimeType: file.type, dataUrl: String(reader.result) });
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(file);
      })));
      setEditingAttachments((current) => [...current, ...next]);
      setAttachmentError('');
      e.target.value = '';
    } catch (err: any) {
      setAttachmentError(err.message ?? '图片读取失败');
    }
  }

  async function saveEditedAttachments() {
    if (!editingRecord) return;
    setSavingAttachments(true);
    setAttachmentError('');
    try {
      const res = await fetch(`/api/mock-exams/${editingRecord.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attachments: editingAttachments.map(({ name, mimeType, dataUrl }) => ({ name, mimeType, dataUrl })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setAttachmentError(body.error ?? '保存图片失败，请重试'); return; }
      setHistory((current) => current.map((record) => (
        record.id === editingRecord.id ? { ...record, attachments: body.attachments } : record
      )));
      setEditingRecord(null);
    } catch {
      setAttachmentError('网络错误，图片尚未保存');
    } finally {
      setSavingAttachments(false);
    }
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
          attachments: attachments.map(({ name, mimeType, dataUrl }) => ({ name, mimeType, dataUrl })),
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
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
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

            <div>
              <p className="mb-2 text-xs font-medium text-stone-400">错题图片（可选）</p>
              <input type="file" accept="image/*" multiple onChange={handleAttachmentChange} className="block w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-600" />
              {attachments.length > 0 && <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">{attachments.map((attachment, index) => <div key={`${attachment.name}-${index}`} className="relative overflow-hidden rounded-lg border border-stone-200 bg-stone-50"><button type="button" onClick={() => setPreviewAttachment(attachment)} title="查看大图" className="block w-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"><img src={attachment.dataUrl} alt={attachment.name} className="h-24 w-full object-cover" /></button><button type="button" onClick={() => removeAttachment(index)} className="absolute right-1 top-1 rounded-full bg-white/90 px-2 py-0.5 text-xs text-red-600 shadow-sm">×</button><p className="truncate px-2 py-1 text-xs text-stone-500">{attachment.name}</p></div>)}</div>}
              <p className="mt-2 text-xs text-stone-400">支持多张图片，合计不超过约 3 MB。</p>
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

        <Modal open={editingRecord !== null} onClose={() => setEditingRecord(null)} title="管理错题图片">
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">
              <span className="font-medium text-stone-800">{editingRecord?.practiceDate}</span>
              {editingRecord?.title ? <span className="ml-2">{editingRecord.title}</span> : null}
            </div>

            {editingAttachments.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {editingAttachments.map((attachment, index) => (
                  <div key={`${attachment.id}-${attachment.name}-${index}`} className="relative overflow-hidden rounded-lg border border-stone-200 bg-white">
                    <button type="button" onClick={() => setPreviewAttachment(attachment)} title="查看大图" className="block w-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"><img src={attachment.dataUrl} alt={attachment.name} className="h-28 w-full object-cover" /></button>
                    <button type="button" onClick={() => setEditingAttachments((current) => current.filter((_, i) => i !== index))} title="移除这张图片" aria-label="移除这张图片" className="absolute right-1 top-1 rounded-full bg-white/95 px-2 py-0.5 text-sm text-red-600 shadow-sm">×</button>
                    <p className="truncate px-2 py-1.5 text-xs text-stone-500">{attachment.name}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-400">这条成绩还没有错题图片</div>
            )}

            <label className="block">
              <span className="mb-2 block text-xs font-medium text-stone-500">追加图片</span>
              <input type="file" accept="image/*" multiple onChange={handleEditAttachmentChange} className="block w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-600" />
            </label>
            <p className="text-xs text-stone-400">每条成绩最多 5 张，合计不超过约 3 MB。</p>
            {attachmentError ? <p className="text-sm text-red-600">{attachmentError}</p> : null}
            <div className="flex justify-end gap-2 border-t border-stone-200 pt-4">
              <button type="button" onClick={() => setEditingRecord(null)} className="rounded-lg border border-stone-200 px-4 py-2 text-sm text-stone-600 hover:bg-stone-50">取消</button>
              <button type="button" onClick={saveEditedAttachments} disabled={savingAttachments} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">{savingAttachments ? '保存中…' : '保存图片'}</button>
            </div>
          </div>
        </Modal>

        {previewAttachment ? (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/80 p-4" onClick={() => setPreviewAttachment(null)}>
            <div className="relative flex max-h-[94vh] max-w-[94vw] flex-col" onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => setPreviewAttachment(null)} title="关闭图片" aria-label="关闭图片" className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-xl text-stone-700 shadow-md hover:bg-white">×</button>
              <img src={previewAttachment.dataUrl} alt={previewAttachment.name} className="max-h-[88vh] max-w-[92vw] rounded-md bg-white object-contain shadow-2xl" />
              <p className="mt-2 truncate text-center text-sm text-white/80">{previewAttachment.name}</p>
            </div>
          </div>
        ) : null}

        <div className="mb-8 inline-flex w-full rounded-lg border border-stone-200 bg-white p-1 sm:w-auto">
          {([
            ['analysis', '分析'],
            ['records', '记录'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={
                'min-w-28 flex-1 rounded-md px-4 py-2 text-sm font-medium sm:flex-none ' +
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
            <div className="mb-3 flex items-end justify-between gap-3">
              <div><h2 className="text-lg font-semibold text-stone-900">练习历史</h2><p className="mt-1 text-sm text-stone-500">成绩、来源和错题图片集中在同一条记录中。</p></div>
              <span className="text-xs font-medium text-stone-400">共 {history.length} 条</span>
            </div>
            {history.length === 0 && !historyError ? (
              <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center text-stone-400 shadow-sm">
                还没有练习记录
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
                {pageHistory.map((record) => <PracticeRecordListItem key={record.id} record={record} onPreview={setPreviewAttachment} onManage={openAttachmentEditor} />)}
              </div>
            )}
            <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />
          </>
        )}
      </div>
    </main>
  );
}
