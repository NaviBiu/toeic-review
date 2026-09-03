'use client';

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import ListeningKnowledgePointLibrary from '@/components/knowledgePoints/ListeningKnowledgePointLibrary';
import ReadingNoteLibrary from '@/components/readingNotes/ReadingNoteLibrary';
import SectionTabs from '@/components/SectionTabs';
import type { ReadingNote, ReadingNoteCategory } from '@/lib/readingNotes/types';

type LibraryTab = 'listening' | 'reading';
type ReadingNotesPage = {
  items: ReadingNote[];
  total: number;
  page: number;
  pageSize: number;
};

export default function KnowledgePointsPage() {
  const [tab, setTab] = useState<LibraryTab>('listening');
  const [prefetchedCategories, setPrefetchedCategories] = useState<ReadingNoteCategory[] | null>(null);
  const [prefetchedPage, setPrefetchedPage] = useState<ReadingNotesPage | null>(null);

  useEffect(() => {
    let active = true;
    const prefetch = async () => {
      const [categoriesResponse, notesResponse] = await Promise.all([
        fetch('/api/reading-note-categories'),
        fetch('/api/reading-notes?page=1&pageSize=20&status=active'),
      ]);
      if (!active || !categoriesResponse.ok || !notesResponse.ok) return;
      const [categories, page] = await Promise.all([
        categoriesResponse.json() as Promise<ReadingNoteCategory[]>,
        notesResponse.json() as Promise<ReadingNotesPage>,
      ]);
      if (active) {
        setPrefetchedCategories(categories);
        setPrefetchedPage(page);
      }
    };
    void prefetch().catch(() => undefined);
    return () => { active = false; };
  }, []);

  return (
    <main className="min-h-screen bg-stone-50">
      <Header />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-stone-900">错题库</h1>
        </div>
        <SectionTabs
          value={tab}
          options={[
            { value: 'listening', label: '听力笔记' },
            { value: 'reading', label: '阅读笔记' },
          ]}
          onChange={setTab}
          label="错题库类型"
        />
        <div className="mt-7" role="tabpanel">
          {tab === 'listening' ? (
            <div className="mx-auto max-w-2xl">
              <ListeningKnowledgePointLibrary />
            </div>
          ) : (
            <ReadingNoteLibrary
              initialCategories={prefetchedCategories}
              initialPage={prefetchedPage}
            />
          )}
        </div>
      </div>
    </main>
  );
}
