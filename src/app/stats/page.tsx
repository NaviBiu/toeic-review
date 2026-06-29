'use client';
import { useEffect, useState } from 'react';
import Header from '@/components/Header';

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
          <h2 className="mb-3 text-lg font-semibold text-stone-900">错题库统计</h2>
          <p className="mb-3 text-sm text-stone-500">
            活跃 <span className="font-semibold text-stone-900">{stats.activeCount}</span> · 已掌握{' '}
            <span className="font-semibold text-emerald-600">{stats.masteredCount}</span>
          </p>
          <table className="w-full text-sm">
            <thead className="text-stone-400"><tr><th className="text-left">Part</th><th className="text-right">正确率</th></tr></thead>
            <tbody>
              {stats.byPart.map((p: any) => (
                <tr key={p.part} className="border-t border-stone-100">
                  <td className="py-1.5 text-stone-700">Part {p.part}</td>
                  <td className="py-1.5 text-right text-stone-700">{p.accuracy === null ? '—' : `${Math.round(p.accuracy * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="mt-3 w-full text-sm">
            <thead className="text-stone-400"><tr><th className="text-left">场景</th><th className="text-right">正确率</th></tr></thead>
            <tbody>
              {stats.byScenarioMajor.map((s: any) => (
                <tr key={s.scenarioMajor} className="border-t border-stone-100">
                  <td className="py-1.5 text-stone-700">{s.scenarioMajor}</td>
                  <td className="py-1.5 text-right text-stone-700">{s.accuracy === null ? '—' : `${Math.round(s.accuracy * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mb-6 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold text-stone-900">模考历史</h2>
          <table className="w-full text-sm">
            <thead className="text-stone-400"><tr><th className="text-left">日期</th><th>P1</th><th>P2</th><th>P3</th><th>P4</th></tr></thead>
            <tbody>
              {exams.map((r) => (
                <tr key={r.id} className="border-t border-stone-100">
                  <td className="py-1.5 text-stone-700">{r.testDate}</td>
                  <td className="text-center text-stone-600">{r.part1.correct}/{r.part1.total}</td>
                  <td className="text-center text-stone-600">{r.part2.correct}/{r.part2.total}</td>
                  <td className="text-center text-stone-600">{r.part3.correct}/{r.part3.total}</td>
                  <td className="text-center text-stone-600">{r.part4.correct}/{r.part4.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <a href="/api/export" className="inline-block rounded-xl bg-stone-700 px-4 py-2.5 font-medium text-white shadow-sm hover:bg-stone-800">
          导出全部数据 (JSON)
        </a>
      </div>
    </main>
  );
}
