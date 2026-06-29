'use client';
import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import Pagination, { PAGE_SIZE } from '@/components/Pagination';

type KP = { id: number; term: string; meaning: string; part: number; scenarioMajor: string; scenarioMinor: string };

export default function MasteredPage() {
  const [items, setItems] = useState<KP[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  async function load() {
    const res = await fetch('/api/knowledge-points?status=mastered');
    setItems(await res.json());
  }

  useEffect(() => { load(); }, []);

  async function restore(id: number, term: string) {
    // 移回错题库会把连续答对次数清零、重新进入复盘队列,不算完全无副作用的操作,
    // 加一道确认避免手滑误触。
    if (!window.confirm(`确定要把「${term}」移回错题库吗?它会重新进入今天的复盘队列,连续答对次数会清零。`)) {
      return;
    }
    setError('');
    try {
      const res = await fetch(`/api/knowledge-points/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? '操作失败,请重试');
        return;
      }
      setMessage(`已移回错题库,今天会重新出现在复盘队列`);
      setTimeout(() => setMessage(''), 4000);
      load();
    } catch {
      setError('网络错误,请重试');
    }
  }

  return (
    <main className="min-h-screen bg-stone-50">
      <Header />
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="mb-6 text-xl font-bold text-stone-900">已掌握</h1>
        {message && <p className="mb-4 text-sm text-emerald-600">{message}</p>}
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        {items.length === 0 ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center text-stone-400 shadow-sm">
            还没有真正长期记住的内容
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {pageItems.map((kp) => (
              <li key={kp.id} className="flex items-center justify-between rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                <div>
                  <div className="font-medium text-stone-900">✅ {kp.term}</div>
                  <div className="text-sm text-stone-500">{kp.meaning}</div>
                  <div className="mt-1 text-xs text-stone-400">Part {kp.part} · {kp.scenarioMajor} / {kp.scenarioMinor}</div>
                </div>
                <button onClick={() => restore(kp.id, kp.term)} className="text-sm font-medium text-indigo-600 hover:text-indigo-700">移回错题库</button>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />
      </div>
    </main>
  );
}
