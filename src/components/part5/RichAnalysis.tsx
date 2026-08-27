'use client';

import { useMemo } from 'react';
import {
  decodeAnalysis,
  encodeAnalysis,
  parseAnalysisClipboardHtml,
  parseAnalysisClipboardText,
  type AnalysisBlock,
} from '@/lib/questionReview/richAnalysis';

function replaceBlock(blocks: AnalysisBlock[], index: number, block: AnalysisBlock) {
  return blocks.map((current, currentIndex) => currentIndex === index ? block : current);
}

export function RichAnalysisEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const blocks = useMemo(() => decodeAnalysis(value), [value]);

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const html = event.clipboardData.getData('text/html');
    const pastedBlocks = /<table[\s>]/i.test(html)
      ? parseAnalysisClipboardHtml(html)
      : parseAnalysisClipboardText(event.clipboardData.getData('text/plain'));
    if (!pastedBlocks.some((block) => block.type === 'table')) return;
    event.preventDefault();
    onChange(encodeAnalysis(pastedBlocks));
  }

  return (
    <div role="group" aria-label="考点分析编辑区" onPaste={handlePaste} className="mt-2 overflow-hidden rounded-md border border-stone-300 bg-white focus-within:border-stone-500 focus-within:ring-1 focus-within:ring-stone-300">
      <div className="space-y-3 p-3">
        {blocks.map((block, blockIndex) => block.type === 'paragraph' ? (
          <textarea
            key={`paragraph-${blockIndex}`}
            aria-label={blocks.length === 1 ? '考点分析' : `考点分析段落 ${blockIndex + 1}`}
            value={block.text}
            onChange={(event) => onChange(encodeAnalysis(replaceBlock(blocks, blockIndex, {
              type: 'paragraph',
              text: event.target.value,
            })))}
            rows={Math.min(6, Math.max(2, block.text.split('\n').length))}
            placeholder="粘贴文字或包含表格的内容"
            className="block w-full resize-y border-0 bg-transparent px-0 py-1 text-sm leading-6 text-stone-900 outline-none"
          />
        ) : (
          <div key={`table-${blockIndex}`} className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm text-stone-800">
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={`row-${rowIndex}`}>
                    {row.cells.map((cell, cellIndex) => {
                      const Cell = row.header ? 'th' : 'td';
                      return (
                        <Cell key={`cell-${cellIndex}`} className="min-w-28 border border-stone-400 p-0 align-top">
                          <input
                            aria-label={`表格第 ${rowIndex + 1} 行第 ${cellIndex + 1} 列`}
                            value={cell}
                            onChange={(event) => {
                              const rows = block.rows.map((currentRow, currentRowIndex) => currentRowIndex === rowIndex
                                ? {
                                  ...currentRow,
                                  cells: currentRow.cells.map((currentCell, currentCellIndex) => currentCellIndex === cellIndex
                                    ? event.target.value
                                    : currentCell),
                                }
                                : currentRow);
                              onChange(encodeAnalysis(replaceBlock(blocks, blockIndex, { type: 'table', rows })));
                            }}
                            className={`block w-full border-0 bg-transparent px-2 py-1.5 text-sm text-stone-900 outline-none ${row.header ? 'text-center font-semibold' : ''}`}
                          />
                        </Cell>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RichAnalysisContent({ value }: { value: string }) {
  const blocks = decodeAnalysis(value);
  return (
    <div className="mt-2 space-y-4 text-sm leading-6 text-stone-700">
      {blocks.map((block, blockIndex) => block.type === 'paragraph' ? (
        <p key={`paragraph-${blockIndex}`} className="whitespace-pre-wrap">{block.text}</p>
      ) : (
        <div key={`table-${blockIndex}`} className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {row.cells.map((cell, cellIndex) => {
                    const Cell = row.header ? 'th' : 'td';
                    return <Cell key={`cell-${cellIndex}`} className={`border border-stone-400 px-3 py-1.5 ${row.header ? 'bg-stone-100 text-center font-semibold text-stone-900' : 'bg-white'}`}>{cell}</Cell>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
