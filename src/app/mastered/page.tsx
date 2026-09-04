'use client';

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import ListeningMastered, { type ListeningMasteredItem } from '@/components/mastered/ListeningMastered';
import ReadingMastered, { type ReadingMasteredPage } from '@/components/readingNotes/ReadingMastered';
import SectionTabs from '@/components/SectionTabs';

type MasteredTab = 'listening' | 'reading';

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) throw new Error(fallback);
  return response.json() as Promise<T>;
}

export default function MasteredPage() {
  const [tab, setTab] = useState<MasteredTab>('listening');
  const [listening, setListening] = useState<ListeningMasteredItem[] | null>(null);
  const [reading, setReading] = useState<ReadingMasteredPage | null>(null);
  const [listeningCount, setListeningCount] = useState(0);
  const [readingCount, setReadingCount] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/knowledge-points?status=mastered')
        .then((response) => readJson<ListeningMasteredItem[]>(response, '听力笔记加载失败')),
      fetch('/api/reading-notes?status=mastered&page=1&pageSize=20')
        .then((response) => readJson<ReadingMasteredPage>(response, '阅读笔记加载失败')),
    ]).then(([listeningItems, readingPage]) => {
      if (!active) return;
      setListening(listeningItems);
      setReading(readingPage);
      setListeningCount(listeningItems.length);
      setReadingCount(readingPage.total);
    }).catch((nextError) => {
      if (active) setError(nextError instanceof Error ? nextError.message : '已掌握内容加载失败');
    });
    return () => { active = false; };
  }, []);

  return (
    <main className="min-h-screen bg-stone-50">
      <Header />
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="mb-6 text-xl font-bold text-stone-900">已掌握</h1>
        <SectionTabs
          value={tab}
          options={[
            { value: 'listening', label: `听力 ${listeningCount}` },
            { value: 'reading', label: `阅读 ${readingCount}` },
          ]}
          onChange={setTab}
          label="已掌握笔记类型"
        />
        {error ? <p role="alert" className="mt-6 border-l-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
        {!listening || !reading ? <p className="py-12 text-center text-sm text-stone-500">正在加载…</p> : (
          <div className="mt-7">
            <div hidden={tab !== 'listening'}><ListeningMastered initialItems={listening} onCountChange={setListeningCount} /></div>
            <div hidden={tab !== 'reading'}><ReadingMastered initialPage={reading} onCountChange={setReadingCount} /></div>
          </div>
        )}
      </div>
    </main>
  );
}
