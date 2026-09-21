import { getLocale } from './locale';
import messages from './messages.json';
/** Translates UI copy only. Never pass evidence, drafts, or user-entered text here. */
export function t(text: string): string {
  const locale = getLocale();
  const translated = (messages as Record<string, string[]>)[text];
  return translated ? locale.startsWith('es') ? translated[0] : locale.startsWith('zh') ? translated[1] : text : text;
}
