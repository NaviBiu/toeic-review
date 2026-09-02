import { readFileSync } from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import { describe, expect, it, vi } from 'vitest';
import {
  parseReadingDocx,
  validateReadingDocx,
} from '@/lib/readingNotes/docxParser';

const fixtureBuffer = readFileSync(
  path.join(process.cwd(), 'tests', 'fixtures', 'reading-notes.docx'),
);

describe('reading Word parser', () => {
  it('inherits dates and categories while preserving rich knowledge content', async () => {
    const items = await parseReadingDocx(fixtureBuffer, '2026-09-02');

    expect(
      items.map(({ categoryName, noteDate, notes }) => ({ categoryName, noteDate, notes })),
    ).toEqual([
      { categoryName: '高频商务词汇', noteDate: '2026-08-31', notes: '优先建立直接反应。' },
      { categoryName: '固定搭配', noteDate: '2026-08-31', notes: null },
      { categoryName: '动词 + 名词搭配', noteDate: '2026-09-01', notes: null },
    ]);
    expect(items.map((item) => item.sourceIndex)).toEqual([0, 1, 2]);
    expect(items[1].contentHtml).toContain('<table>');
    expect(items[1].contentHtml).toContain('rowspan="2"');
    expect(items[1].contentText).toContain('as a result');
    expect(items.filter((item) => item.confidence === 'low')).toHaveLength(1);
    expect(items.find((item) => item.confidence === 'low')?.contentText).toContain(
      '待人工确认的孤立内容',
    );
  });

  it('uses the import date until a document date marker appears', async () => {
    vi.spyOn(mammoth, 'convertToHtml').mockResolvedValueOnce({
      value: '<p>分类：默认分类</p><p>知识点：fallback date</p>',
      messages: [],
    });

    const items = await parseReadingDocx(Buffer.from('local fixture'), '2026-09-02');

    expect(items).toHaveLength(1);
    expect(items[0].noteDate).toBe('2026-09-02');
  });

  it('marks knowledge content before any category as low confidence', async () => {
    vi.spyOn(mammoth, 'convertToHtml').mockResolvedValueOnce({
      value: '<p>知识点：uncategorized content</p>',
      messages: [],
    });

    const items = await parseReadingDocx(Buffer.from('local fixture'), '2026-09-02');

    expect(items[0]).toMatchObject({
      categoryName: '未分类',
      confidence: 'low',
      issue: '内容出现在分类之前',
    });
  });

  it('preserves blank semantic blocks inside active knowledge content', async () => {
    const buffer = Buffer.from('local fixture');
    const convertToHtml = vi.spyOn(mammoth, 'convertToHtml').mockResolvedValueOnce({
      value:
        '\n  <p>分类：版式</p><p>知识点：line one</p><p><br></p><br><p>line two</p>  \n',
      messages: [],
    });

    const items = await parseReadingDocx(buffer, '2026-09-02');

    expect(items).toHaveLength(1);
    expect(items[0].contentHtml).toBe(
      '<p>line one</p><p><br></p><br><p>line two</p>',
    );
    expect(convertToHtml).toHaveBeenCalledWith({ buffer }, { ignoreEmptyParagraphs: false });
  });

  it('preserves a calendar-invalid date marker as low-confidence content', async () => {
    vi.spyOn(mammoth, 'convertToHtml').mockResolvedValueOnce({
      value:
        '<p>分类：日期</p><p>日期：2026年13月40日</p><p>知识点：calendar validation</p>',
      messages: [],
    });

    const items = await parseReadingDocx(Buffer.from('local fixture'), '2026-09-02');

    expect(items[0]).toMatchObject({
      categoryName: '日期',
      noteDate: '2026-09-02',
      confidence: 'low',
    });
    expect(items[0].contentHtml).toContain('<p>日期：2026年13月40日</p>');
    expect(items[0].issue).toContain('无法识别标记：日期：2026年13月40日');
  });

  it.each(['   ', '\u200B'])('preserves a whitespace-only category marker (%j)', async (space) => {
    vi.spyOn(mammoth, 'convertToHtml').mockResolvedValueOnce({
      value: `<p>分类：${space}</p><p>知识点：category validation</p>`,
      messages: [],
    });

    const items = await parseReadingDocx(Buffer.from('local fixture'), '2026-09-02');

    expect(items[0]).toMatchObject({
      categoryName: '未分类',
      confidence: 'low',
    });
    expect(items[0].contentHtml).toContain('<p>分类：');
    expect(items[0].issue).toContain('无法识别标记：分类：');
  });

  it('accepts a valid docx filename, size, and ZIP signature', () => {
    expect(() =>
      validateReadingDocx({ name: 'NOTES.DOCX', size: fixtureBuffer.length, buffer: fixtureBuffer }),
    ).not.toThrow();
  });

  it('rejects an oversized unsupported file with the file-type message', () => {
    expect(() =>
      validateReadingDocx({
        name: 'notes.pdf',
        size: 5 * 1024 * 1024 + 1,
        buffer: Buffer.from([0x50, 0x4b]),
      }),
    ).toThrow('阅读笔记批量导入仅支持 Word(.docx) 文件');
  });

  it('rejects unsupported, empty, oversized, and non-ZIP files with approved messages', () => {
    const invalidTypeMessage = '阅读笔记批量导入仅支持 Word(.docx) 文件';

    expect(() =>
      validateReadingDocx({ name: 'notes.pdf', size: 100, buffer: Buffer.from('x') }),
    ).toThrow(invalidTypeMessage);
    expect(() =>
      validateReadingDocx({ name: 'notes.docx', size: 0, buffer: Buffer.alloc(0) }),
    ).toThrow(invalidTypeMessage);
    expect(() =>
      validateReadingDocx({ name: 'notes.docx', size: 1, buffer: Buffer.from('x') }),
    ).toThrow(invalidTypeMessage);
    expect(() =>
      validateReadingDocx({
        name: 'notes.docx',
        size: 5 * 1024 * 1024 + 1,
        buffer: Buffer.from([0x50, 0x4b]),
      }),
    ).toThrow('文件超过 5MB 上限');
  });
});
