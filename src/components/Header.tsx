'use client';

import Link from 'next/link';
import { studyNav } from '@/lib/disguiseMode';
import { useWorkMode } from '@/hooks/useWorkMode';

export default function Header() {
  const { enabled, skin, setEnabled, rotateSkin } = useWorkMode();

  if (!enabled) {
    return (
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-6 px-6 py-3">
          <Link href="/" className="shrink-0 font-bold text-stone-900 hover:text-indigo-600">TOEIC 复盘</Link>
          <nav className="flex min-w-0 gap-5 overflow-x-auto text-sm text-stone-500">
            {studyNav.map((item) => <Link key={item.href} href={item.href} className="shrink-0 whitespace-nowrap hover:text-indigo-600">{item.label}</Link>)}
          </nav>
          <button type="button" onClick={() => setEnabled(true)} className="ml-auto shrink-0 rounded-md border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100">Work mode</button>
        </div>
      </header>
    );
  }

  return (
    <header className="work-header relative z-50 border-b border-slate-300 bg-slate-50">
      <div className="mx-auto flex min-h-16 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-6 w-6 shrink-0 place-items-center border border-slate-600 font-mono text-xs font-bold text-slate-700">{skin.title[0]}</span>
          <div className="min-w-0">
            <p className="truncate font-mono text-sm font-bold text-slate-900">{skin.title}</p>
            <p className="hidden font-mono text-[10px] uppercase tracking-wide text-slate-500 sm:block">Internal documentation portal</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => setEnabled(false)} className="border border-slate-300 bg-white px-2 py-1.5 font-mono text-[11px] text-slate-600 hover:bg-slate-100">Study mode</button>
          <button type="button" onClick={rotateSkin} className="border border-slate-600 bg-slate-700 px-2 py-1.5 font-mono text-[11px] text-white hover:bg-slate-800">Open another document</button>
        </div>
      </div>
    </header>
  );
}
