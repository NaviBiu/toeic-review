import { describe, expect, it } from 'vitest';
import { parsePastedQuestion } from '@/lib/questionReview/parser';

describe('parsePastedQuestion', () => {
  const markerCases = ['A.', 'A)', '(A)', 'A：'];

  it.each(markerCases)('parses %s option markers', (aMarker) => {
    const marker = (option: 'A' | 'B' | 'C' | 'D') => aMarker.replace('A', option);
    expect(parsePastedQuestion([
      'The plan is ___.' ,
      `${marker('A')} practical`,
      `${marker('B')} practice`,
      `${marker('C')} practiced`,
      `${marker('D')} practically`,
    ].join('\r\n'))).toEqual({
      stem: 'The plan is ___.',
      options: { A: 'practical', B: 'practice', C: 'practiced', D: 'practically' },
      complete: true,
      warning: null,
    });
  });

  it('keeps detected text and warns when an option is missing', () => {
    expect(parsePastedQuestion('The plan is ___.\n(A) practical\n(B) practice\n(C) practiced'))
      .toEqual({
        stem: 'The plan is ___.',
        options: { A: 'practical', B: 'practice', C: 'practiced' },
        complete: false,
        warning: '未识别出完整的 A/B/C/D，请检查后手动补充',
      });
  });

  it('keeps the entire paste as the stem when it has no line-start option markers', () => {
    expect(parsePastedQuestion('Choose A. when it is practical.')).toEqual({
      stem: 'Choose A. when it is practical.',
      options: {},
      complete: false,
      warning: '未识别出完整的 A/B/C/D，请检查后手动补充',
    });
  });
});
