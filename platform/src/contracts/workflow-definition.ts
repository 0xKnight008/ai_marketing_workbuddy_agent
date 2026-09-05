/** Only this workflow currently has an execution implementation. */
export function isAnnouncementWorkflow(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const steps = (value as { steps?: unknown }).steps;
  if (!Array.isArray(steps) || steps.length !== 3) return false;
  return steps[0]?.type === 'ai.prepare_announcement'
    && steps[1]?.type === 'approval'
    && ['social.schedule_post', 'social.create_post'].includes(steps[2]?.type);
}
