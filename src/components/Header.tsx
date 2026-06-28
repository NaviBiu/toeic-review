import Link from 'next/link';

const NAV = [
  { href: '/review', label: '今日复盘' },
  { href: '/knowledge-points', label: '错题库' },
  { href: '/knowledge-points/import', label: '导入笔记' },
  { href: '/mastered', label: '已掌握' },
  { href: '/mock-exams', label: '模考记录' },
  { href: '/stats', label: '统计' },
];

export default function Header() {
  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-4xl items-center gap-6 px-6 py-3 overflow-x-auto">
        <Link href="/" className="shrink-0 font-bold text-stone-900 hover:text-indigo-600">
          TOEIC 复盘
        </Link>
        <nav className="flex gap-5 text-sm text-stone-500">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="shrink-0 whitespace-nowrap hover:text-indigo-600">
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
