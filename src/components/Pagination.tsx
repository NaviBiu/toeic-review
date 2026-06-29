'use client';

export const PAGE_SIZE = 20;

export default function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-center gap-4 text-sm">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-stone-600 shadow-sm hover:bg-stone-100 disabled:opacity-40"
      >
        上一页
      </button>
      <span className="text-stone-500">第 {page} / {totalPages} 页</span>
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-stone-600 shadow-sm hover:bg-stone-100 disabled:opacity-40"
      >
        下一页
      </button>
    </div>
  );
}
