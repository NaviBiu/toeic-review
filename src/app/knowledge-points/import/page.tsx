'use client';

import { useState } from 'react';
import Header from '@/components/Header';
import ListeningImport from '@/components/knowledgePoints/ListeningImport';
import ReadingImport from '@/components/readingNotes/ReadingImport';
import SectionTabs from '@/components/SectionTabs';

type ImportTab = 'listening' | 'reading';

export default function ImportPage() {
  const [tab, setTab] = useState<ImportTab>('listening');
  return (
    <main className="min-h-screen bg-stone-50">
      <Header />
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="mb-6 text-xl font-bold text-stone-900">导入错题笔记</h1>
        <SectionTabs
          value={tab}
          options={[
            { value: 'listening', label: '听力笔记' },
            { value: 'reading', label: '阅读笔记' },
          ]}
          onChange={setTab}
          label="导入笔记类型"
        />
        <div className="mt-7" hidden={tab !== 'listening'}><ListeningImport /></div>
        <div className="mt-7" hidden={tab !== 'reading'}><ReadingImport /></div>
      </div>
    </main>
  );
}
