/**
 * D2D Pipeline Stages — Server-side Source of Truth
 * Mirror of src/lib/d2d-pipeline-stages.ts
 */

export const D2D_STAGES = ['new_lead', 'must_recall', 'quote_sent', 'closed_won', 'closed_lost'] as const;
export type D2DStage = typeof D2D_STAGES[number];

export const DB_TO_D2D_STAGE: Record<string, D2DStage> = {
  'new': 'new_lead',
  'follow_up_1': 'must_recall',
  'follow_up_2': 'quote_sent',
  'follow_up_3': 'quote_sent',
  'closed': 'closed_won',
  'lost': 'closed_lost',
};

export const D2D_TO_DB_STAGE: Record<D2DStage, string> = {
  new_lead: 'new',
  must_recall: 'follow_up_1',
  quote_sent: 'follow_up_2',
  closed_won: 'closed',
  closed_lost: 'lost',
};
