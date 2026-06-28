'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.push('/');
      router.refresh();
    } else {
      setError('密码不正确');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50">
      <form onSubmit={handleSubmit} className="w-80 rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-lg font-bold text-stone-900">TOEIC 听力错题复盘</h1>
        <p className="mb-5 text-sm text-stone-400">输入密码进入</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
          autoFocus
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button type="submit" className="mt-4 w-full rounded-xl bg-indigo-600 py-2.5 font-medium text-white shadow-sm hover:bg-indigo-700">
          进入
        </button>
      </form>
    </main>
  );
}
