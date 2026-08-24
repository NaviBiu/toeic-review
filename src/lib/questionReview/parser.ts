import type { QuestionOption } from './types';

export type ParsedQuestion = {
  stem: string;
  options: Partial<Record<QuestionOption, string>>;
  complete: boolean;
  warning: string | null;
};

const optionMarker = /^\s*(?:\(([A-D])\)|([A-D])[.)：])\s*(.*)$/;
const incompleteWarning = '未识别出完整的 A/B/C/D，请检查后手动补充';

export function parsePastedQuestion(input: string): ParsedQuestion {
  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  const stemLines: string[] = [];
  const options: Partial<Record<QuestionOption, string>> = {};
  let currentOption: QuestionOption | null = null;

  for (const line of lines) {
    const match = line.match(optionMarker);
    if (match) {
      currentOption = (match[1] ?? match[2]) as QuestionOption;
      options[currentOption] = match[3].trim();
      continue;
    }
    if (currentOption) {
      options[currentOption] = `${options[currentOption] ?? ''}\n${line}`.trim();
    } else {
      stemLines.push(line);
    }
  }

  const complete = (['A', 'B', 'C', 'D'] as const)
    .every((option) => Boolean(options[option]));
  return {
    stem: stemLines.join('\n').trim(),
    options,
    complete,
    warning: complete ? null : incompleteWarning,
  };
}
