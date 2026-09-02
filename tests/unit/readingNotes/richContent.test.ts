// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  normalizeReadingText,
  sanitizeReadingHtml,
} from '@/lib/readingNotes/richContent';
import {
  hashReadingText,
  sanitizeReadingHtmlServer,
} from '@/lib/readingNotes/richContent.server';

describe('reading rich content', () => {
  it('keeps semantic content and table spans while stripping Word CSS and scripts', () => {
    const result = sanitizeReadingHtmlServer(`
      <style>p.MsoNormal { mso-style-name: 正文 }</style>
      <!-- office metadata -->
      <p class="MsoNormal" style="color:red" onclick="alert(1)"><strong>结果关系</strong></p>
      <ul><li>as a result</li></ul>
      <table class="MsoTableGrid"><tr><th colspan="2">表达</th></tr>
      <tr><td rowspan="2">therefore</td><td>因此</td></tr></table>
      <script>alert(1)</script>`);

    expect(result.html).toContain('<strong>结果关系</strong>');
    expect(result.html).toContain('<ul><li>as a result</li></ul>');
    expect(result.html).toContain('colspan="2"');
    expect(result.html).toContain('rowspan="2"');
    expect(result.html).not.toMatch(/style=|class=|onclick=|<script|MsoNormal/);
    expect(result.text).toContain('结果关系 as a result 表达 therefore 因此');
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('unwraps unknown formatting, removes forbidden elements, and clamps table spans', () => {
    const result = sanitizeReadingHtml(
      '<div><span>Keep me</span><iframe>drop me</iframe>' +
        '<table><tr><td colspan="99" rowspan="0" data-x="x">Cell</td></tr></table></div>',
    );

    expect(result.html).toBe(
      'Keep me<table><tbody><tr><td colspan="20" rowspan="1">Cell</td></tr></tbody></table>',
    );
    expect(result.text).toBe('keep me cell');
  });

  it('normalizes Unicode, whitespace, and case before hashing', () => {
    expect(normalizeReadingText('  ＡS\nA\tRESULT  ')).toBe('as a result');
    expect(hashReadingText('ＡS A RESULT')).toBe(hashReadingText('as   a result'));
  });

  it('rejects content without normalized text', () => {
    expect(() => sanitizeReadingHtmlServer('<p><br></p>')).toThrow('知识点不能为空');
  });
});
