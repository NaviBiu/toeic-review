'use client';

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import ListeningReview, { type ListeningReviewItem } from '@/components/review/ListeningReview';
import ReadingReview from '@/components/readingNotes/ReadingReview';
import SectionTabs from '@/components/SectionTabs';
import { useWorkMode } from '@/hooks/useWorkMode';
import type { ReadingQueuePage } from '@/lib/readingNotes/types';

type ReviewTab = 'listening' | 'reading';

async function json<T>(response: Response, message: string): Promise<T> {
  if (!response.ok) throw new Error(message);
  return response.json() as Promise<T>;
}

export default function ReviewPage() {
  const { enabled: workMode } = useWorkMode();
  const [tab, setTab] = useState<ReviewTab>('listening');
  const [listeningQueue, setListeningQueue] = useState<ListeningReviewItem[] | null>(null);
  const [readingPage, setReadingPage] = useState<ReadingQueuePage | null>(null);
  const [listeningCount, setListeningCount] = useState(0);
  const [readingCount, setReadingCount] = useState(0);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let active = true;
    const listeningRequest = fetch('/api/review/queue?')
      .then((response) => json<ListeningReviewItem[]>(response, '听力复盘加载失败'));
    const readingCountRequest = fetch('/api/reading-review/count')
      .then((response) => json<{ count: number }>(response, '阅读复盘加载失败'));

    Promise.all([listeningRequest, readingCountRequest])
      .then(([listening, reading]) => {
        if (!active) return undefined;
        setListeningQueue(listening);
        setListeningCount(listening.length);
        setReadingCount(reading.count);
        return fetch('/api/reading-review/queue?limit=50')
          .then((response) => json<ReadingQueuePage>(response, '阅读复盘加载失败'))
          .then((page) => {
            if (active) setReadingPage(page);
          });
      })
      .catch((error) => {
        if (active) setLoadError(error instanceof Error ? error.message : '复盘加载失败');
      });
    return () => { active = false; };
  }, []);

  const options = [
    { value: 'listening' as const, label: `${workMode ? 'Listening review' : '听力复盘'} ${listeningCount}` },
    { value: 'reading' as const, label: `${workMode ? 'Reading review' : '阅读复盘'} ${readingCount}` },
  ];

  return (
    <main className={`min-h-screen ${workMode ? 'bg-slate-50' : 'bg-stone-50'}`}>
      <Header />
      <div className={`mx-auto px-4 pt-6 sm:px-6 ${workMode ? 'max-w-4xl' : 'max-w-2xl'}`}>
        <SectionTabs
          value={tab}
          options={options}
          onChange={setTab}
          label={workMode ? 'Review type' : '复盘类型'}
        />
      </div>

      {loadError ? (
        <p role="alert" className="mx-auto mt-8 max-w-2xl border-l-2 border-red-600 bg-red-50 px-4 py-3 text-sm text-red-800">
          {workMode ? 'Unable to load the review queue. Please try again.' : loadError}
        </p>
      ) : null}
      {listeningQueue ? (
        <div hidden={tab !== 'listening'}>
          <ListeningReview
            mode={workMode ? 'work' : 'study'}
            prefetched={listeningQueue}
            active={tab === 'listening'}
            onPendingChange={setListeningCount}
          />
        </div>
      ) : null}
      {readingPage ? (
        <div hidden={tab !== 'reading'}>
          <ReadingReview
            mode={workMode ? 'work' : 'study'}
            prefetched={readingPage}
            onPendingChange={setReadingCount}
          />
        </div>
      ) : null}
    </main>
  );
}
