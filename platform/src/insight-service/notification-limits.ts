/** Validate the frozen payload; never shorten it during delivery. */
export function notificationContentError(channel: string, content: string): string | null {
  if (channel === 'discord' && content.length > 1900) return 'notification_discord_content_too_long_use_email';
  if (channel === 'email' && content.length > 12000) return 'notification_email_content_too_long';
  return null;
}
