import { describe, expect, it, vi } from 'vitest';
import type { VercelClient } from '@vercel/postgres';
import {
  createQuestion,
  listQuestions,
  QuestionError,
  updateQuestion,
  type ReviewQuestionInput,
} from '@/lib/questionReview/questions';

const input: ReviewQuestionInput = {
  stem: 'The plan is practical.',
  options: { A: 'practical', B: 'practice', C: 'practiced', D: 'practically' },
  correctOption: 'A',
  analysis: '词性判断',
  categoryId: 12,
};

const activeChild = {
  id: 12,
  section: 'reading',
  part: 5,
  parent_id: 4,
  name: '未细分',
  is_default: true,
  status: 'active',
  sort_order: 0,
  parent_status: 'active',
};

const currentQuestion = {
  id: 34,
  section: 'reading',
  part: 5,
  question_format: 'single_choice',
  stem: input.stem,
  option_a: input.options.A,
  option_b: input.options.B,
  option_c: input.options.C,
  option_d: input.options.D,
  correct_option: input.correctOption,
  analysis: input.analysis,
  notes: null,
  source: null,
  category_id: input.categoryId,
  status: 'deleted',
};

function clientWith(...rows: unknown[][]): VercelClient {
  return {
    query: vi.fn().mockImplementation(async () => ({ rows: rows.shift() ?? [] })),
  } as unknown as VercelClient;
}

describe('question validation', () => {
  it.each([
    [{ ...input, stem: '   ' }, '题干不能为空'],
    [{ ...input, options: { ...input.options, C: ' ' } }, 'A/B/C/D 选项不能为空'],
    [{ ...input, correctOption: 'E' as 'A' }, '正确答案不正确'],
  ])('rejects invalid fields with %s', async (invalidInput, message) => {
    const client = clientWith();
    await expect(createQuestion(client, invalidInput)).rejects.toEqual(
      expect.objectContaining<QuestionError>({ message }),
    );
    expect(client.query).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...activeChild, status: 'inactive' }, '分类已停用'],
    [{ ...activeChild, parent_id: null }, '题目必须归属二级分类'],
    [{ ...activeChild, part: 6 }, '分类范围不一致'],
  ])('rejects an invalid question category with %s', async (category, message) => {
    await expect(createQuestion(clientWith([category]), input)).rejects.toEqual(
      expect.objectContaining<QuestionError>({ message }),
    );
  });

  it('validates an unchanged category before restoring a question', async () => {
    await expect(updateQuestion(clientWith(
      [currentQuestion],
      [{ ...activeChild, status: 'inactive' }],
    ), currentQuestion.id, { status: 'learning' })).rejects.toEqual(
      expect.objectContaining<QuestionError>({ message: '分类已停用' }),
    );
  });
});

describe('question repository', () => {
  it('returns a duplicate result until confirmation is supplied', async () => {
    const duplicate = await createQuestion(clientWith([activeChild], [{ id: 33 }]), input);
    expect(duplicate).toEqual({ duplicate: true, duplicateId: 33 });

    const confirmed = await createQuestion(clientWith(
      [activeChild],
      [{ id: 33 }],
      [{
        id: 34,
        section: 'reading',
        part: 5,
        question_format: 'single_choice',
        stem: input.stem,
        option_a: input.options.A,
        option_b: input.options.B,
        option_c: input.options.C,
        option_d: input.options.D,
        correct_option: input.correctOption,
        analysis: input.analysis,
        notes: null,
        source: null,
        category_id: input.categoryId,
        status: 'learning',
      }],
    ), { ...input, confirmDuplicate: true });
    expect(confirmed).toMatchObject({ duplicate: false, question: { id: 34, status: 'learning' } });
  });

  it('returns paginated list rows with attempt aggregates and the requested sort', async () => {
    const client = clientWith(
      [{ total: 3 }],
      [{
        id: 34,
        section: 'reading',
        part: 5,
        question_format: 'single_choice',
        stem: input.stem,
        option_a: input.options.A,
        option_b: input.options.B,
        option_c: input.options.C,
        option_d: input.options.D,
        correct_option: input.correctOption,
        analysis: input.analysis,
        notes: null,
        source: null,
        category_id: input.categoryId,
        status: 'learning',
        parent_name: '词性判断',
        category_name: '未细分',
        correct_count: 2,
        wrong_count: 1,
        latest_correct: false,
        latest_duration_ms: 1200,
      }],
    );

    await expect(listQuestions(client, {
      page: 2,
      pageSize: 1,
      sort: 'unattempted_first',
    })).resolves.toEqual({
      items: [expect.objectContaining({
        id: 34,
        categoryPath: ['词性判断', '未细分'],
        stats: { correctCount: 2, wrongCount: 1, latestCorrect: false, latestDurationMs: 1200 },
      })],
      total: 3,
      page: 2,
      pageSize: 1,
    });
    expect(vi.mocked(client.query).mock.calls[1][0]).toContain('CASE WHEN latest_attempt.is_correct IS NULL THEN 0 ELSE 1 END');
  });
});
