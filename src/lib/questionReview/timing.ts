export function elapsedMs(startedAt: number, endedAt: number) {
  return Math.max(0, Math.round(endedAt - startedAt));
}

export function normalizeEditedDuration(seconds: string) {
  const trimmed = seconds.trim();
  if (!trimmed) return null;

  const value = Number(trimmed);
  if (!Number.isFinite(value)) throw new Error('用时必须是有效数字');
  if (value < 0) throw new Error('用时不能小于 0');

  return Math.round(value * 1000);
}
