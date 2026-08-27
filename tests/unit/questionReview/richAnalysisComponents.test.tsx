// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { RichAnalysisContent, RichAnalysisEditor } from '@/components/part5/RichAnalysis';
import { decodeAnalysis, encodeAnalysis } from '@/lib/questionReview/richAnalysis';

describe('rich analysis components', () => {
  it('renders saved analysis as text and a real table', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const value = encodeAnalysis([
      { type: 'paragraph', text: '连接词需要表达因果。' },
      {
        type: 'table',
        rows: [
          { header: true, cells: ['选项', '逻辑'] },
          { header: false, cells: ['as a result', '因果'] },
        ],
      },
    ]);

    await act(async () => root.render(<RichAnalysisContent value={value} />));

    expect(host.querySelector('p')?.textContent).toBe('连接词需要表达因果。');
    expect(host.querySelectorAll('table')).toHaveLength(1);
    expect([...host.querySelectorAll('th, td')].map((cell) => cell.textContent)).toEqual([
      '选项', '逻辑', 'as a result', '因果',
    ]);
    await act(async () => root.unmount());
  });

  it('turns a rich table paste into structured analysis', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const onChange = vi.fn();
    await act(async () => root.render(<RichAnalysisEditor value="" onChange={onChange} />));
    const editor = host.querySelector('[aria-label="考点分析编辑区"]');
    if (!editor) throw new Error('Analysis editor not found');
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        getData: (type: string) => type === 'text/html'
          ? '<p>选项辨析</p><table><tr><th>选项</th><th>意思</th></tr><tr><td>thus</td><td>因此</td></tr></table>'
          : '',
      },
    });

    await act(async () => editor.dispatchEvent(paste));

    expect(paste.defaultPrevented).toBe(true);
    expect(decodeAnalysis(onChange.mock.calls[0][0])).toEqual([
      { type: 'paragraph', text: '选项辨析' },
      {
        type: 'table',
        rows: [
          { header: true, cells: ['选项', '意思'] },
          { header: false, cells: ['thus', '因此'] },
        ],
      },
    ]);
    await act(async () => root.unmount());
  });
});
