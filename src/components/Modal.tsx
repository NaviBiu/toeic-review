'use client';
import { useEffect } from 'react';

export default function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
  compact = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  compact?: boolean;
}) {
  const widthClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-3xl',
  }[size];

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`max-h-[90vh] w-full ${widthClass} overflow-y-auto ${compact ? 'rounded-md' : 'rounded-2xl'} bg-white p-6 shadow-xl`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
          <button onClick={onClose} title="关闭" className="text-stone-400 hover:text-stone-600">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
