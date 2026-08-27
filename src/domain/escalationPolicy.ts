export type EscalationStage = 'initial' | 'followup_30m' | 'followup_2h' | 'daily';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function nextEscalationTime(
  stage: EscalationStage,
  from: Date,
): { stage: EscalationStage; at: Date } {
  switch (stage) {
    case 'initial':
      return { stage: 'followup_30m', at: new Date(from.getTime() + 30 * MINUTE) };
    case 'followup_30m':
      return { stage: 'followup_2h', at: new Date(from.getTime() + 2 * HOUR) };
    case 'followup_2h':
    case 'daily':
      return { stage: 'daily', at: new Date(from.getTime() + DAY) };
  }
}
