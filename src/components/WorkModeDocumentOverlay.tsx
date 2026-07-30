'use client';

import { usePathname } from 'next/navigation';
import { getDisguiseTitle } from '@/lib/disguiseMode';
import { useWorkMode } from '@/hooks/useWorkMode';

export default function WorkModeDocumentOverlay() {
  const pathname = usePathname();
  const { enabled, skin } = useWorkMode();
  // Keep entry and study pages usable; disguise mode is only rendered on
  // secondary authenticated routes and must never cover real app content.
  if (!enabled || pathname === '/' || pathname === '/review' || pathname === '/login') return null;

  return (
    <section className="work-document-overlay fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto bg-slate-50 px-4 py-8 sm:px-6">
      <article className="work-document-sheet mx-auto max-w-4xl border border-slate-300 bg-white shadow-sm">
        <header className="border-b border-slate-200 px-6 py-7 sm:px-9">
          <p className="font-mono text-[11px] uppercase tracking-wide text-slate-400">{skin.title} / internal working document</p>
          <div className="mt-2 flex items-start justify-between gap-4">
            <h1 className="font-mono text-2xl font-semibold text-slate-950">{getDisguiseTitle(pathname)}</h1>
            <span className="shrink-0 border border-slate-300 px-2 py-1 font-mono text-[11px] text-slate-500">{skin.documentId}</span>
          </div>
        </header>
        <div className="grid gap-8 px-6 py-7 sm:grid-cols-[1.2fr_.8fr] sm:px-9">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wide text-slate-500">Document purpose</p>
            <p className="mt-3 text-sm leading-7 text-slate-600">This reference captures current review context, supporting notes, and routine control information for the active workstream.</p>
            <h2 className="mt-8 border-b border-slate-200 pb-2 font-mono text-sm font-semibold uppercase tracking-wide text-slate-800">Acceptance criteria</h2>
            <ul className="mt-3 space-y-3 text-sm text-slate-600"><li>Scope and supporting references are available.</li><li>Owner acknowledgement is recorded.</li><li>Outstanding items remain visible for the next review.</li></ul>
          </div>
          <aside className="border border-slate-200 bg-slate-50 p-4 font-mono text-xs text-slate-600"><p className="text-slate-400">DOCUMENT STATUS</p><p className="mt-2 text-slate-800">In review</p><p className="mt-5 text-slate-400">OWNER</p><p className="mt-2 text-slate-800">Operations team</p><p className="mt-5 text-slate-400">REVISION</p><p className="mt-2 text-slate-800">Current working copy</p></aside>
        </div>
      </article>
    </section>
  );
}
