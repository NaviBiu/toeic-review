export function formatPracticeSource(title: string | null) {
  if (title) {
    try {
      const url = new URL(title);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return { label: '打开练习链接', href: title };
      }
    } catch {
      // Plain text titles are rendered as-is.
    }
  }
  return { label: title, href: null };
}
