'use client';

import { useEffect, useState } from 'react';
import Pagination, { PAGE_SIZE } from '@/components/Pagination';

export type ListeningMasteredItem = {
  id: number;
  term: string;
  meaning: string;
  part: number;
  scenarioMajor: string;
  scenarioMinor: string;
};

export default function ListeningMastered({
  initialItems,
  onCountChange,
}: {
  initialItems: ListeningMasteredItem[];
  onCountChange?: (count: number) => void;
}) {
  const [items, setItems] = useState(initialItems);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    onCountChange?.(items.length);
  }, [items.length, onCountChange]);

  async function restore(item: ListeningMasteredItem) {
    if (!window.confirm(`确定要把「${item.term}」移回错题库吗?它会重新进入今天的复盘队列,连续答对次数会清零。`)) return;
    const snapshot = items;
    setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    setError('');
    try {
      const response = await fetch(`/api/knowledge-points/${item.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? '操作失败,请重试');
      }
      setMessage('已移回错题库,今天会重新出现在复盘队列');
      window.setTimeout(() => setMessage(''), 4000);
    } catch (nextError) {
      setItems(snapshot);
      setError(nextError instanceof Error ? nextError.message : '网络错误,请重试');
    }
  }

  return (
    <section aria-label="听力已掌握">
      {message ? <p className="mb-4 text-sm text-emerald-700">{message}</p> : null}
      {error ? <p role="alert" className="mb-4 text-sm text-red-700">{error}</p> : null}
      {items.length === 0 ? <div className="border border-stone-200 bg-white p-10 text-center text-stone-500">还没有已掌握的听力笔记</div> : (
        <ul className="divide-y divide-stone-200 border-y border-stone-200">
          {pageItems.map((item) => <li key={item.id} className="flex items-center justify-between gap-4 py-4"><div className="min-w-0"><p className="font-medium text-stone-900">{item.term}</p><p className="text-sm text-stone-600">{item.meaning}</p><p className="mt-1 text-xs text-stone-500">Part {item.part} · {item.scenarioMajor} / {item.scenarioMinor}</p></div><button type="button" onClick={() => void restore(item)} className="shrink-0 text-sm font-medium text-indigo-700 hover:text-indigo-900">移回错题库</button></li>)}
        </ul>
      )}
      <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />
    </section>
  );
}
