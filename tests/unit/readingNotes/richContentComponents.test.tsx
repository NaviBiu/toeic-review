// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import {
  RichReadingContent,
  RichReadingEditor,
} from '@/components/readingNotes/RichReadingContent';

describe('reading rich content components', () => {
  it('sanitizes a Word-style table on paste and renders its cells', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const onChange = vi.fn();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;

    await act(async () => root.render(
      <RichReadingEditor value="" onChange={onChange} ariaLabel="知识点" />,
    ));
    const editor = host.querySelector('[contenteditable="true"]');
    if (!editor) throw new Error('Rich editor not found');
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        getData: (type: string) => type === 'text/html'
          ? '<style>.MsoNormal{color:red}</style><table class="MsoTableGrid" style="width:99px"><tr><th>表达</th><th>含义</th></tr><tr><td>as a result</td><td>因此</td></tr></table>'
          : '',
      },
    });

    await act(async () => editor.dispatchEvent(paste));

    const value = onChange.mock.calls.at(-1)?.[0] as string;
    expect(paste.defaultPrevented).toBe(true);
    expect(value).toContain('<table>');
    expect(value).not.toMatch(/class=|style=|mso-/i);

    await act(async () => root.render(<RichReadingContent html={value} />));
    expect([...host.querySelectorAll('th, td')].map((cell) => cell.textContent)).toEqual([
      '表达', '含义', 'as a result', '因此',
    ]);
    await act(async () => root.unmount());
  });
});
