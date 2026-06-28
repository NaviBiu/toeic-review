import { describe, it, expect } from 'vitest';
import { withTestClient } from './setup';
import { applyConfirmedImportItem } from '../../src/lib/importConfirm';
import { insertKnowledgePoint, applyReviewResult } from '../../src/lib/knowledgePoints';

const BASE = {
  term: 'workshop', meaning: '研讨会', example: 'ex', notes: null, part: 2,
  scenarioMajor: '一般商务', scenarioMinor: '会议', dateAdded: '2026-06-26', skill: 'listening',
};

describe('applyConfirmedImportItem', () => {
  it('inserts a new record for action insert_new', async () => {
    await withTestClient(async (client) => {
      const result = await applyConfirmedImportItem(
        client, { ...BASE, decision: { action: 'insert_new' }, existingId: null }, '2026-06-26'
      );
      expect(result.action).toBe('inserted');
      expect(result.id).toBeGreaterThan(0);
    });
  });

  it('skips for action skip_duplicate without writing anything', async () => {
    await withTestClient(async (client) => {
      const kp = await insertKnowledgePoint(client, BASE);
      const result = await applyConfirmedImportItem(
        client, { ...BASE, decision: { action: 'skip_duplicate' }, existingId: kp.id }, '2026-06-26'
      );
      expect(result.action).toBe('skipped');
    });
  });

  it('applies a wrong-again update to an active record and keeps existing text when keepVersion is existing', async () => {
    await withTestClient(async (client) => {
      const kp = await insertKnowledgePoint(client, BASE);
      await applyReviewResult(client, kp.id, true, '2026-06-20');
      const result = await applyConfirmedImportItem(
        client,
        { ...BASE, meaning: '新释义', decision: { action: 'wrong_again', reviveFromMastered: false, textConflict: true }, existingId: kp.id, keepVersion: 'existing' },
        '2026-06-26'
      );
      expect(result.action).toBe('wrong_again');
    });
  });

  it('revives a mastered record to active and applies new text when keepVersion is new', async () => {
    await withTestClient(async (client) => {
      const kp = await insertKnowledgePoint(client, BASE);
      let state = kp;
      for (let i = 0; i < 7; i++) state = await applyReviewResult(client, kp.id, true, '2026-06-20');
      expect(state.status).toBe('mastered');
      const result = await applyConfirmedImportItem(
        client,
        { ...BASE, meaning: '新释义', decision: { action: 'wrong_again', reviveFromMastered: true, textConflict: true }, existingId: kp.id, keepVersion: 'new' },
        '2026-06-26'
      );
      expect(result.action).toBe('wrong_again');
    });
  });

  it('rejects action insert_new with an invalid scenarioMajor/scenarioMinor pair', async () => {
    await withTestClient(async (client) => {
      await expect(
        applyConfirmedImportItem(
          client,
          { ...BASE, scenarioMajor: '股票', scenarioMinor: '投资', decision: { action: 'insert_new' }, existingId: null },
          '2026-06-26'
        )
      ).rejects.toThrow('场景分类不在允许的列表内');
    });
  });
});
