import Link from 'next/link';

const LINKS = [
  { href: '/review', label: '今日复盘', desc: '回忆、揭示、判断', icon: '📝' },
  { href: '/knowledge-points', label: '错题库', desc: '浏览全部记录', icon: '📚' },
  { href: '/knowledge-points/import', label: '导入笔记', desc: 'PDF / Word 自动解析', icon: '📥' },
  { href: '/mastered', label: '已掌握', desc: '长期记住的内容', icon: '✅' },
  { href: '/mock-exams', label: '模考记录', desc: '记录历次成绩', icon: '🎯' },
  { href: '/stats', label: '统计', desc: '查看复盘数据', icon: '📊' },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-stone-50">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <header className="mb-10">
          <h1 className="text-3xl font-bold text-stone-900">TOEIC 听力错题复盘</h1>
          <p className="mt-2 text-stone-500">把每一次听不懂的瞬间,变成记得住的知识点</p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="group flex items-start gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow-md"
            >
              <span className="text-2xl">{l.icon}</span>
              <span>
                <span className="block text-lg font-semibold text-stone-900 group-hover:text-indigo-600">
                  {l.label}
                </span>
                <span className="block text-sm text-stone-400">{l.desc}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
