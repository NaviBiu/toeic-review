'use client';
import { useEffect, useState } from 'react';

export default function StatsPage() {
  const [stats, setStats] = useState<any>(null);
  const [exams, setExams] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/stats').then((r) => r.json()).then(setStats);
    fetch('/api/mock-exams').then((r) => r.json()).then(setExams);
  }, []);

  if (!stats) return <main className="p-6">加载中…</main>;

  return (
    <main className="p-6 max-w-2xl">
      <h1 className="text-xl font-semibold mb-4">统计</h1>

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">错题库统计</h2>
        <p>活跃: {stats.activeCount} · 已掌握: {stats.masteredCount}</p>
        <table className="w-full text-sm mt-2">
          <thead><tr><th className="text-left">Part</th><th>正确率</th></tr></thead>
          <tbody>
            {stats.byPart.map((p: any) => (
              <tr key={p.part}><td>Part {p.part}</td><td>{p.accuracy === null ? '—' : `${Math.round(p.accuracy * 100)}%`}</td></tr>
            ))}
          </tbody>
        </table>
        <table className="w-full text-sm mt-2">
          <thead><tr><th className="text-left">场景</th><th>正确率</th></tr></thead>
          <tbody>
            {stats.byScenarioMajor.map((s: any) => (
              <tr key={s.scenarioMajor}><td>{s.scenarioMajor}</td><td>{s.accuracy === null ? '—' : `${Math.round(s.accuracy * 100)}%`}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">模考历史</h2>
        <table className="w-full text-sm">
          <thead><tr><th className="text-left">日期</th><th>P1</th><th>P2</th><th>P3</th><th>P4</th></tr></thead>
          <tbody>
            {exams.map((r) => (
              <tr key={r.id}>
                <td>{r.testDate}</td>
                <td>{r.part1.correct}/{r.part1.total}</td>
                <td>{r.part2.correct}/{r.part2.total}</td>
                <td>{r.part3.correct}/{r.part3.total}</td>
                <td>{r.part4.correct}/{r.part4.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <a href="/api/export" className="bg-gray-700 text-white rounded px-4 py-2 inline-block">导出全部数据 (JSON)</a>
    </main>
  );
}
