import { workReviewCopy } from '@/lib/disguiseMode';

type ReviewItemActionsProps = {
  mode: 'study' | 'work';
  onMastered: () => void;
  onDelete: () => void;
  className?: string;
  masteredLabel?: string;
  deleteLabel?: string;
};

export default function ReviewItemActions({
  mode,
  onMastered,
  onDelete,
  className = '',
  masteredLabel: masteredLabelOverride,
  deleteLabel: deleteLabelOverride,
}: ReviewItemActionsProps) {
  const masteredLabel = masteredLabelOverride
    ?? (mode === 'work' ? workReviewCopy.mastered : '标记为已掌握');
  const deleteLabel = deleteLabelOverride
    ?? (mode === 'work' ? workReviewCopy.delete : '删除（不需要再复习）');
  const neutralColor = mode === 'work' ? 'text-slate-500' : 'text-stone-400';

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={onMastered}
        title={masteredLabel}
        aria-label={masteredLabel}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-emerald-700 transition hover:bg-emerald-50 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
      >
        <span aria-hidden="true" className="text-xl font-semibold leading-none">✓</span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        title={deleteLabel}
        aria-label={deleteLabel}
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 ${neutralColor}`}
      >
        <span aria-hidden="true" className="text-base leading-none">🗑️</span>
      </button>
    </div>
  );
}
