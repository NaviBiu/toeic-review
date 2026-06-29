'use client';
import { useEffect, useState } from 'react';
import { SCENARIOS } from '@/lib/scenarios';
import Header from '@/components/Header';
import Modal from '@/components/Modal';
import Pagination, { PAGE_SIZE } from '@/components/Pagination';

type KP = {
  id: number; term: string; meaning: string; example: string; notes: string | null; part: number;
  scenarioMajor: string; scenarioMinor: string; dateAdded: string; status: string; wrongCount: number;
};

type SortKey = 'dateAdded_desc' | 'dateAdded_asc' | 'wrongCount_desc' | 'wrongCount_asc';

const SORT_LABELS: Record<SortKey, string> = {
  dateAdded_desc: '添加时间(新→旧)',
  dateAdded_asc: '添加时间(旧→新)',
  wrongCount_desc: '错误次数(多→少)',
  wrongCount_asc: '错误次数(少→多)',
};

type EditDraft = {
  meaning: string; example: string; notes: string | null; part: number;
  scenarioMajor: string; scenarioMinor: string; dateAdded: string;
};

const TODAY = new Date().toISOString().slice(0, 10);

export default function KnowledgePointsPage() {
  const [items, setItems] = useState<KP[]>([]);
  const [partFilter, setPartFilter] = useState('');
  const [majorFilter, setMajorFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('dateAdded_desc');
  const [page, setPage] = useState(1);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTerm, setNewTerm] = useState('');
  const [newPart, setNewPart] = useState('1');
  const [newMeaning, setNewMeaning] = useState('');
  const [newExample, setNewExample] = useState('');
  const [newScenarioMajor, setNewScenarioMajor] = useState<string | null>(null);
  const [newScenarioMinor, setNewScenarioMinor] = useState<string | null>(null);
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');
  const [adding, setAdding] = useState(false);
  const [assisting, setAssisting] = useState(false);
  const [assistError, setAssistError] = useState('');

  const [undo, setUndo] = useState<{ id: number; term: string } | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [editError, setEditError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const params = new URLSearchParams();
    if (partFilter) params.set('part', partFilter);
    if (majorFilter) params.set('scenarioMajor', majorFilter);
    const res = await fetch(`/api/knowledge-points?${params}`);
    setItems(await res.json());
  }

  useEffect(() => { load(); }, [partFilter, majorFilter]);

  // Search/sort run client-side over the already-fetched (part/scenario
  // filtered) list -- this is a personal single-user vocab list, never large
  // enough to need a server-side query for a plain substring match or a
  // four-way sort.
  useEffect(() => { setPage(1); }, [partFilter, majorFilter, search, sortKey]);

  const visible = items
    .filter((kp) => !search.trim() || kp.term.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => {
      if (sortKey.startsWith('wrongCount')) {
        return sortKey.endsWith('desc') ? b.wrongCount - a.wrongCount : a.wrongCount - b.wrongCount;
      }
      const cmp = a.dateAdded.localeCompare(b.dateAdded);
      return sortKey.endsWith('desc') ? -cmp : cmp;
    });
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  async function handleDelete(id: number, term: string) {
    await fetch(`/api/knowledge-points/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'deleted' }),
    });
    setUndo({ id, term });
    setTimeout(() => setUndo((u) => (u?.id === id ? null : u)), 5000);
    load();
  }

  async function handleUndo() {
    if (!undo) return;
    await fetch(`/api/knowledge-points/${undo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    setUndo(null);
    load();
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError('');
    setAddSuccess('');
    setAdding(true);
    try {
      const res = await fetch('/api/knowledge-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          term: newTerm,
          part: Number(newPart),
          meaning: newMeaning,
          example: newExample,
          scenarioMajor: newScenarioMajor ?? undefined,
          scenarioMinor: newScenarioMinor ?? undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setAddError(body.error ?? '添加失败,请重试');
        return;
      }
      setAddSuccess(`已添加「${newTerm}」`);
      setTimeout(() => setAddSuccess(''), 4000);
      setNewTerm(''); setNewMeaning(''); setNewExample('');
      setNewScenarioMajor(null); setNewScenarioMinor(null);
      load();
    } catch {
      setAddError('网络错误,请重试');
    } finally {
      setAdding(false);
    }
  }

  async function handleAiAssist() {
    setAssistError('');
    setAssisting(true);
    try {
      const res = await fetch('/api/knowledge-points/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term: newTerm, part: Number(newPart) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAssistError(body.error ?? 'AI 补全失败,请重试');
        return;
      }
      setNewMeaning(body.meaning);
      setNewExample(body.example);
      setNewScenarioMajor(body.scenarioMajor);
      setNewScenarioMinor(body.scenarioMinor);
    } catch {
      setAssistError('网络错误,请重试');
    } finally {
      setAssisting(false);
    }
  }

  function startEdit(kp: KP) {
    setEditingId(kp.id);
    setEditDraft({
      meaning: kp.meaning, example: kp.example, notes: kp.notes, part: kp.part,
      scenarioMajor: kp.scenarioMajor, scenarioMinor: kp.scenarioMinor, dateAdded: kp.dateAdded,
    });
    setEditError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
    setEditError('');
  }

  async function saveEdit(id: number) {
    if (!editDraft) return;
    setSaving(true);
    setEditError('');
    try {
      const res = await fetch(`/api/knowledge-points/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editDraft),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setEditError(body.error ?? '保存失败,请重试');
        return;
      }
      setEditingId(null);
      setEditDraft(null);
      load();
    } catch {
      setEditError('网络错误,请重试');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-50">
      <Header />
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-stone-900">错题库</h1>
          <button
            onClick={() => setShowAddModal(true)}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
          >
            + 手动添加
          </button>
        </div>

        <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="手动添加知识点">
          <form onSubmit={handleAdd} className="flex flex-col gap-3">
            <p className="text-sm text-stone-400">释义/例句留空也可以保存,场景默认未分类</p>
            <input
              value={newTerm}
              onChange={(e) => setNewTerm(e.target.value)}
              placeholder="词/短语"
              required
              className="rounded-xl border border-stone-200 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={handleAiAssist}
              disabled={!newTerm || assisting}
              className="self-start text-sm font-medium text-indigo-600 hover:text-indigo-700 disabled:text-stone-300"
            >
              {assisting ? '正在补全…' : 'AI 自动补全'}
            </button>
            {assistError && <p className="text-sm text-red-600">{assistError}</p>}
            <select value={newPart} onChange={(e) => setNewPart(e.target.value)} className="rounded-xl border border-stone-200 px-3 py-2 text-sm">
              {[1, 2, 3, 4].map((p) => <option key={p} value={p}>Part {p}</option>)}
            </select>
            <input value={newMeaning} onChange={(e) => setNewMeaning(e.target.value)} placeholder="释义(可留空)" className="rounded-xl border border-stone-200 px-3 py-2 text-sm" />
            <input value={newExample} onChange={(e) => setNewExample(e.target.value)} placeholder="例句(可留空)" className="rounded-xl border border-stone-200 px-3 py-2 text-sm" />
            <button
              type="submit"
              disabled={adding}
              className="self-start rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
            >
              {adding ? '添加中…' : '添加'}
            </button>
            {addError && <p className="text-sm text-red-600">{addError}</p>}
            {addSuccess && <p className="text-sm text-emerald-600">{addSuccess}</p>}
          </form>
        </Modal>

        <div className="mb-4 flex flex-wrap gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索词/短语"
            className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm shadow-sm"
          />
          <select value={partFilter} onChange={(e) => setPartFilter(e.target.value)} className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm shadow-sm">
            <option value="">全部 Part</option>
            {[1, 2, 3, 4].map((p) => <option key={p} value={p}>Part {p}</option>)}
          </select>
          <select value={majorFilter} onChange={(e) => setMajorFilter(e.target.value)} className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm shadow-sm">
            <option value="">全部场景</option>
            {Object.keys(SCENARIOS).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm shadow-sm">
            {Object.entries(SORT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
        <ul className="flex flex-col gap-3">
          {pageItems.map((kp) => (
            <li key={kp.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              {editingId === kp.id && editDraft ? (
                <div>
                  <div className="mb-2 font-medium text-stone-900">{kp.term}</div>

                  <label className="block text-xs text-stone-400">释义</label>
                  <textarea
                    value={editDraft.meaning}
                    onChange={(e) => setEditDraft({ ...editDraft, meaning: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-stone-200 p-2 text-sm"
                  />
                  <label className="mt-2 block text-xs text-stone-400">例句</label>
                  <textarea
                    value={editDraft.example}
                    onChange={(e) => setEditDraft({ ...editDraft, example: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-stone-200 p-2 text-sm"
                  />
                  <label className="mt-2 block text-xs text-stone-400">备注(可留空)</label>
                  <textarea
                    value={editDraft.notes ?? ''}
                    onChange={(e) => setEditDraft({ ...editDraft, notes: e.target.value || null })}
                    className="mt-1 w-full rounded-xl border border-stone-200 p-2 text-sm"
                  />
                  <label className="mt-2 block text-xs text-stone-400">学习日期</label>
                  <input
                    type="date"
                    value={editDraft.dateAdded}
                    max={TODAY}
                    onChange={(e) => setEditDraft({ ...editDraft, dateAdded: e.target.value })}
                    className="mt-1 rounded-lg border border-stone-200 px-2 py-1 text-sm"
                  />

                  <div className="mt-2 flex flex-wrap gap-2">
                    <select
                      value={editDraft.part}
                      onChange={(e) => setEditDraft({ ...editDraft, part: Number(e.target.value) })}
                      className="rounded-lg border border-stone-200 px-2 py-1 text-sm"
                    >
                      {[1, 2, 3, 4].map((p) => <option key={p} value={p}>Part {p}</option>)}
                    </select>
                    <select
                      value={editDraft.scenarioMajor}
                      onChange={(e) => setEditDraft({ ...editDraft, scenarioMajor: e.target.value, scenarioMinor: '未分类' })}
                      className="rounded-lg border border-stone-200 px-2 py-1 text-sm"
                    >
                      {Object.keys(SCENARIOS).map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <select
                      value={editDraft.scenarioMinor}
                      onChange={(e) => setEditDraft({ ...editDraft, scenarioMinor: e.target.value })}
                      className="rounded-lg border border-stone-200 px-2 py-1 text-sm"
                    >
                      {[...(SCENARIOS[editDraft.scenarioMajor] ?? []), '未分类'].map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>

                  {editError && <p className="mt-2 text-sm text-red-600">{editError}</p>}
                  <div className="mt-3 flex gap-3">
                    <button
                      onClick={() => saveEdit(kp.id)}
                      disabled={saving}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                    >
                      {saving ? '保存中…' : '保存'}
                    </button>
                    <button onClick={cancelEdit} className="text-sm text-stone-400 hover:text-stone-600">取消</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium text-stone-900">{kp.term}</div>
                    <div className="text-sm text-stone-500">{kp.meaning}</div>
                    <div className="mt-1 text-xs text-stone-400">Part {kp.part} · {kp.scenarioMajor} / {kp.scenarioMinor}</div>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => startEdit(kp)} className="text-sm text-indigo-600 hover:text-indigo-700">编辑</button>
                    <button onClick={() => handleDelete(kp.id, kp.term)} className="text-sm text-stone-400 hover:text-red-600">删除</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
        <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />
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
