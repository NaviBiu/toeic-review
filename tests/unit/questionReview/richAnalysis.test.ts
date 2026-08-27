// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  analysisHasContent,
  decodeAnalysis,
  encodeAnalysis,
  parseAnalysisClipboardHtml,
  parseAnalysisClipboardText,
} from '@/lib/questionReview/richAnalysis';

describe('rich Part 5 analysis', () => {
  it('preserves paragraphs and table headers from pasted document HTML', () => {
    const blocks = parseAnalysisClipboardHtml(`
      <p>分析：预约的人很少。</p>
      <table>
        <thead><tr><th>表达</th><th>脑内翻译</th></tr></thead>
        <tbody>
          <tr><td>as a result</td><td>因此，所以</td></tr>
          <tr><td>therefore</td><td>因此</td></tr>
        </tbody>
      </table>
    `);

    expect(blocks).toEqual([
      { type: 'paragraph', text: '分析：预约的人很少。' },
      {
        type: 'table',
        rows: [
          { header: true, cells: ['表达', '脑内翻译'] },
          { header: false, cells: ['as a result', '因此，所以'] },
          { header: false, cells: ['therefore', '因此'] },
        ],
      },
    ]);

  });

  it('drops Word and Tencent document CSS from rich clipboard HTML', () => {
    const blocks = parseAnalysisClipboardHtml(`
      <style><!--
        p.MsoNormal { mso-style-name: 正文; margin: 0pt; mso-pagination: none; }
        table.MsoTableGrid { border-collapse: collapse; }
      --></style>
      <div>&lt;!--p.MsoNormal{ mso-style-name: 正文; mso-style-parent: ""; margin: 0pt; mso-pagination: none; }--&gt;</div>
      <p class="MsoNormal">分析：预约的人很少。</p>
      <table class="MsoTableGrid">
        <tr><td>表达</td><td>脑内翻译</td></tr>
        <tr><td>therefore</td><td>因此</td></tr>
      </table>
    `);

    expect(blocks).toEqual([
      { type: 'paragraph', text: '分析：预约的人很少。' },
      {
        type: 'table',
        rows: [
          { header: true, cells: ['表达', '脑内翻译'] },
          { header: false, cells: ['therefore', '因此'] },
        ],
      },
    ]);

    const previouslySaved = `toeic-rich-analysis:v1:${JSON.stringify([
      { type: 'paragraph', text: '<!--p.MsoNormal{ mso-style-name: 正文; mso-pagination: none; }-->' },
      { type: 'paragraph', text: '分析：预约的人很少。' },
    ])}`;
    expect(decodeAnalysis(previouslySaved)).toEqual([
      { type: 'paragraph', text: '分析：预约的人很少。' },
    ]);
  });

  it('round-trips table analysis while keeping legacy plain text readable', () => {
    const blocks = [
      { type: 'paragraph' as const, text: '连接词辨析' },
      { type: 'table' as const, rows: [{ header: true, cells: ['选项', '逻辑'] }] },
    ];
    const encoded = encodeAnalysis(blocks);

    expect(encoded).toContain('toeic-rich-analysis:v1:');
    expect(decodeAnalysis(encoded)).toEqual(blocks);
    expect(decodeAnalysis('旧版纯文字\n仍需保留')).toEqual([
      { type: 'paragraph', text: '旧版纯文字\n仍需保留' },
    ]);
  });

  it('recognizes tab-separated tables when the clipboard has no HTML', () => {
    expect(parseAnalysisClipboardText('分析：考查逻辑\n选项\t意思\t逻辑\nas a result\t因此\t因果')).toEqual([
      { type: 'paragraph', text: '分析：考查逻辑' },
      {
        type: 'table',
        rows: [
          { header: true, cells: ['选项', '意思', '逻辑'] },
          { header: false, cells: ['as a result', '因此', '因果'] },
        ],
      },
    ]);
  });

  it('rejects visually empty rich analysis', () => {
    expect(analysisHasContent(encodeAnalysis([
      { type: 'table', rows: [{ header: false, cells: ['', '  '] }] },
    ]))).toBe(false);
    expect(analysisHasContent('普通分析')).toBe(true);
  });
});
