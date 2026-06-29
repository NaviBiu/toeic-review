'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import AccuracyBadge from '@/components/AccuracyBadge';

function ratioOf(correct: number, total: number) {
  return total > 0 ? correct / total : null;
}

export default function StatsPage() {
  const [stats, setStats] = useState<any>(null);
  const [exams, setExams] = useState<any[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/stats')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setStats)
      .catch(() => setError('统计加载失败,请刷新重试'));
    fetch('/api/mock-exams')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setExams)
      .catch(() => setError('统计加载失败,请刷新重试'));
  }, []);

  if (error) {
    return (
      <main className="min-h-screen bg-stone-50">
        <Header />
        <div className="mx-auto max-w-2xl px-6 py-10 text-red-600">{error}</div>
      </main>
    );
  }

  if (!stats) {
    return (
      <main className="min-h-screen bg-stone-50">
        <Header />
        <div className="mx-auto max-w-2xl px-6 py-10 text-stone-400">加载中…</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50">
      <Header />
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="mb-6 text-xl font-bold text-stone-900">统计</h1>

        <section className="mb-6 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-stone-900">错题库统计</h2>

          <div className="mb-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-stone-50 p-4 text-center">
              <div className="text-2xl font-bold text-stone-900">{stats.activeCount}</div>
              <div className="mt-1 text-xs text-stone-400">活跃</div>
            </div>
            <div className="rounded-xl bg-emerald-50 p-4 text-center">
              <div className="text-2xl font-bold text-emerald-600">{stats.masteredCount}</div>
              <div className="mt-1 text-xs text-stone-400">已掌握</div>
            </div>
          </div>

          <p className="mb-2 text-xs font-medium text-stone-400">按 Part</p>
          <div className="mb-5 flex flex-col gap-1.5">
            {stats.byPart.map((p: any) => (
              <div key={p.part} className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2">
                <span className="text-sm text-stone-700">Part {p.part}</span>
                <AccuracyBadge ratio={p.accuracy} />
              </div>
            ))}
          </div>

          <p className="mb-2 text-xs font-medium text-stone-400">按场景</p>
          <div className="flex flex-col gap-1.5">
            {stats.byScenarioMajor.map((s: any) => (
              <div key={s.scenarioMajor} className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2">
                <span className="text-sm text-stone-700">{s.scenarioMajor}</span>
                <AccuracyBadge ratio={s.accuracy} />
              </div>
            ))}
          </div>
        </section>

        <section className="mb-6 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold text-stone-900">模考历史(最近 5 次)</h2>
          {exams.length === 0 ? (
            <p className="text-sm text-stone-400">还没有模考记录</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {exams.slice(0, 5).map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2">
                  <span className="text-sm text-stone-700">{r.testDate}</span>
                  <div className="flex gap-3">
                    {(['part1', 'part2', 'part3', 'part4'] as const).map((p, i) => (
                      <div key={p} className="flex items-center gap-1 text-xs text-stone-500">
                        P{i + 1} <AccuracyBadge ratio={ratioOf(r[p].correct, r[p].total)} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <Link href="/mock-exams" className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700">
            查看全部 →
          </Link>
        </section>

        <a href="/api/export" className="inline-block rounded-xl bg-stone-700 px-4 py-2.5 font-medium text-white shadow-sm hover:bg-stone-800">
          导出全部数据 (JSON)
        </a>
      </div>
    </main>
  );
}
