export default function AccuracyBadge({ ratio }: { ratio: number | null }) {
  if (ratio === null) return <span className="text-sm text-stone-400">—</span>;
  const pct = Math.round(ratio * 100);
  const color =
    pct >= 80 ? 'bg-emerald-100 text-emerald-700' : pct >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>{pct}%</span>;
}
