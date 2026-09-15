import { z } from 'zod';
import { HttpError } from '../http/errors';
import type { ParsedItem } from './csv';

export const discordId = z.string().regex(/^\d{17,20}$/);
export interface DiscordImportConfig {
  DISCORD_IMPORT_BOT_TOKEN?: string;
  DISCORD_IMPORT_CHANNELS?: string;
}

export function authorizeDiscordImport(config: DiscordImportConfig, workspaceId: string, channelId: string) {
  if (!config.DISCORD_IMPORT_BOT_TOKEN || !config.DISCORD_IMPORT_CHANNELS) throw new HttpError(503, 'discord_import_not_configured');
  let channels: Record<string, string[]>;
  try {
    channels = z.record(z.string().uuid(), z.array(discordId).max(100)).parse(JSON.parse(config.DISCORD_IMPORT_CHANNELS));
  } catch { throw new HttpError(503, 'discord_import_configuration_invalid'); }
  if (!channels[workspaceId]?.includes(channelId)) throw new HttpError(403, 'discord_import_channel_not_allowed');
}

const messageSchema = z.object({
  id: discordId, channel_id: discordId, content: z.string(), timestamp: z.string().datetime({ offset: true }),
  type: z.number().int(), webhook_id: z.string().optional(),
  author: z.object({ id: discordId, bot: z.boolean().optional() }),
});

/** Bounded snapshot only. Never follow arbitrary URLs, redirects, attachments or threads. */
export async function readDiscordMessages(config: DiscordImportConfig, workspaceId: string, channelId: string, fetcher: typeof fetch = fetch): Promise<ParsedItem[]> {
  authorizeDiscordImport(config, workspaceId, channelId);
  const items = new Map<string, ParsedItem>();
  const signal = AbortSignal.timeout(15_000);
  let before: string | undefined;
  try {
    for (let page = 0; page < 5; page++) {
      const url = new URL(`https://discord.com/api/v10/channels/${channelId}/messages`);
      url.searchParams.set('limit', '100');
      if (before) url.searchParams.set('before', before);
      const response = await fetcher(url, { headers: { Authorization: `Bot ${config.DISCORD_IMPORT_BOT_TOKEN}` }, redirect: 'error', signal });
      if (response.status === 429) throw new HttpError(429, 'discord_import_rate_limited_retry_later');
      if ([401, 403, 404].includes(response.status)) throw new HttpError(502, 'discord_import_check_bot_channel_permissions');
      if (!response.ok) throw new HttpError(502, 'discord_import_provider_unavailable');
      const parsed = z.array(messageSchema).max(100).safeParse(await response.json());
      if (!parsed.success) throw new HttpError(502, 'discord_import_invalid_response');
      const messages = parsed.data;
      if (!messages.length) break;
      for (const message of messages) {
        if (message.channel_id !== channelId) throw new HttpError(502, 'discord_import_invalid_response');
        if (before && BigInt(message.id) >= BigInt(before)) throw new HttpError(502, 'discord_import_invalid_pagination');
        if (message.author.bot || message.webhook_id || ![0, 19].includes(message.type) || !message.content.trim()) continue;
        if (message.content.length > 2000) throw new HttpError(422, 'discord_import_message_exceeds_2000_characters');
        items.set(message.id, { platform: 'discord', externalId: message.id, author: message.author.id,
          text: message.content, metrics: { publishedAt: message.timestamp, channelId } });
      }
      before = messages.reduce((min, m) => BigInt(m.id) < BigInt(min) ? m.id : min, messages[0]!.id);
      if (messages.length < 100) break;
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'discord_import_provider_unavailable');
  }
  if (!items.size) throw new HttpError(422, 'discord_import_no_text_check_message_content_intent');
  return [...items.values()].sort((a, b) => BigInt(a.externalId!) < BigInt(b.externalId!) ? -1 : 1);
}
