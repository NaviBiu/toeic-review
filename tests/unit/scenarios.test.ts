import { describe, it, expect } from 'vitest';
import { isValidScenario, sanitizeScenario, SCENARIOS } from '../../src/lib/scenarios';

describe('SCENARIOS', () => {
  it('has exactly 14 majors (13 ETS categories + 未分类)', () => {
    expect(Object.keys(SCENARIOS)).toHaveLength(14);
    expect(SCENARIOS['未分类']).toEqual([]);
  });
});

describe('isValidScenario', () => {
  it('accepts a real major+minor pair from the whitelist', () => {
    expect(isValidScenario('金融/预算', '投资')).toBe(true);
  });
  it('accepts the universal 未分类 minor under any valid major', () => {
    expect(isValidScenario('金融/预算', '未分类')).toBe(true);
  });
  it('rejects a minor that does not belong to the given major', () => {
    expect(isValidScenario('金融/预算', '股票交易')).toBe(false);
  });
  it('rejects a major that is not in the whitelist at all', () => {
    expect(isValidScenario('股票', '投资')).toBe(false);
  });
  it('only accepts 未分类 as the minor for the 未分类 major', () => {
    expect(isValidScenario('未分类', '未分类')).toBe(true);
    expect(isValidScenario('未分类', '投资')).toBe(false);
  });
});

describe('sanitizeScenario', () => {
  it('passes through an already-valid pair unchanged', () => {
    expect(sanitizeScenario('金融/预算', '投资')).toEqual({ major: '金融/预算', minor: '投资' });
  });
  it('downgrades only the minor to 未分类 when the major is valid but the minor is hallucinated', () => {
    expect(sanitizeScenario('金融/预算', '股票交易')).toEqual({ major: '金融/预算', minor: '未分类' });
  });
  it('downgrades both major and minor to 未分类 when the major itself is invalid', () => {
    expect(sanitizeScenario('股票', '投资')).toEqual({ major: '未分类', minor: '未分类' });
  });
});
