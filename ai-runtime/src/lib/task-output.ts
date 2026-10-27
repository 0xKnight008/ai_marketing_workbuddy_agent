import { taskStepResultSchema } from '../agents/task-agent';
import { markTaskFailure } from './request-trace';
export class TaskOutputError extends Error {
  constructor(readonly code: string) { super(code); }
}
export function parseTaskOutput(text: string, finishReason?: string) {
  const fail = (code: string): never => { markTaskFailure(code); throw new TaskOutputError(code); };
  if (finishReason === 'length') return fail('task_output_truncated');
  if (finishReason === 'content-filter' || finishReason === 'content_filter') return fail('task_output_filtered');
  if (finishReason === 'error' || finishReason === 'tool-calls') return fail('task_output_incomplete');
  let value: unknown;
  // Accept a single complete JSON fence. Do not invent missing fields or repair truncated JSON.
  const clean = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
  if (!clean) return fail('task_output_empty');
  try { value = JSON.parse(clean); } catch { return fail('task_output_invalid_json'); }
  const parsed = taskStepResultSchema.safeParse(value);
  if (!parsed.success) {
    const allowed = new Set(['action', 'query', 'markdown', 'citations', 'ref', 'snippet']);
    const issues = parsed.error.issues.map(i => i.path.filter(p => typeof p === 'number' || allowed.has(String(p))).join('.') + ':' + i.code);
    markTaskFailure('task_output_invalid_schema', issues);
    throw new TaskOutputError('task_output_invalid_schema');
  }
  if (parsed.data.action === 'search' ? !parsed.data.query.trim() : !parsed.data.markdown.trim()) return fail('task_output_missing_content');
  return parsed.data;
}
export const taskJsonInstruction = `Return exactly one JSON object, with no prose outside it or Markdown fence. Required fields: action ("ask", "search", or "answer"), query (string, max 200 characters; empty unless searching), markdown (string, max 20000 characters; required for ask/answer), citations (array, max 30 objects each with ref string max 80 characters and snippet string of 1-1000 characters). Use citations: [] when there is no source evidence. Markdown belongs inside the markdown string. Escape JSON strings correctly. Never include reasoning outside the JSON object.`;
