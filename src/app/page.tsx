import Link from 'next/link';

const LINKS = [
  { href: '/review', label: '今日复盘' },
  { href: '/knowledge-points', label: '错题库' },
  { href: '/knowledge-points/import', label: '导入笔记' },
  { href: '/mastered', label: '已掌握' },
  { href: '/mock-exams', label: '模考记录' },
  { href: '/stats', label: '统计' },
];

export default function HomePage() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold mb-6">TOEIC 听力错题复盘</h1>
      <ul className="flex flex-col gap-3">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="text-blue-600 underline text-lg">{l.label}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
