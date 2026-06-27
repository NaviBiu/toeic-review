import type { VercelClient } from '@vercel/postgres';
import { insertKnowledgePoint, applyReviewResult, reviveFromImport, updateKnowledgePointFields } from './knowledgePoints';
import type { DedupDecision } from './importDedup';

export type ConfirmItem = {
  term: string;
  meaning: string;
  example: string;
  notes: string | null;
  part: number;
  dateAdded: string;
  scenarioMajor: string;
  scenarioMinor: string;
  decision: DedupDecision;
  existingId: number | null;
  keepVersion?: 'new' | 'existing';
};

export async function applyConfirmedImportItem(
  client: VercelClient,
  item: ConfirmItem,
  today: string
): Promise<{ action: string; id: number | null }> {
  if (item.decision.action === 'skip_duplicate') {
    return { action: 'skipped', id: item.existingId };
  }
  if (item.decision.action === 'insert_new') {
    const kp = await insertKnowledgePoint(client, {
      term: item.term, meaning: item.meaning, example: item.example, notes: item.notes,
      part: item.part, scenarioMajor: item.scenarioMajor, scenarioMinor: item.scenarioMinor,
      skill: 'listening', dateAdded: item.dateAdded,
    });
    return { action: 'inserted', id: kp.id };
  }
  if (!item.existingId) {
    throw new Error('缺少要更新的现有记录 id');
  }
  if (item.decision.reviveFromMastered) {
    await reviveFromImport(client, item.existingId, today);
  } else {
    await applyReviewResult(client, item.existingId, false, today);
  }
  if (item.decision.textConflict && item.keepVersion === 'new') {
    await updateKnowledgePointFields(client, item.existingId, {
      meaning: item.meaning, example: item.example, notes: item.notes,
    });
  }
  return { action: 'wrong_again', id: item.existingId };
}
