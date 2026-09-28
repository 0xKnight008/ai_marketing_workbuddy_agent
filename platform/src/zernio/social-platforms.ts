/** Dependency-free V1 capabilities shared by UI, AI planning and the CommonJS server. */
export const CONNECTION_PLATFORMS = [
  ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'],
  ['pinterest', 'Pinterest'], ['googlebusiness', 'Google Business'],
  ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['twitter', 'X / Twitter'],
  ['threads', 'Threads'], ['bluesky', 'Bluesky'], ['reddit', 'Reddit'],
  ['discord', 'Discord'], ['slack', 'Slack'], ['telegram', 'Telegram'],
] as const;
export const ANNOUNCEMENT_PLATFORMS = ['linkedin', 'x'] as const;
export function announcementPlatform(platform: string): string { return platform === 'twitter' ? 'x' : platform; }
export function supportsAnnouncement(platform: string): boolean {
  return (ANNOUNCEMENT_PLATFORMS as readonly string[]).includes(announcementPlatform(platform));
}
export function supportsPostAction(platform: string): boolean {
  // Discord is a separate approved report/notification delivery path, not a pipeline destination.
  return supportsAnnouncement(platform) || platform === 'discord';
}
export function publicationAvailability(platform: string): string {
  if (supportsAnnouncement(platform)) return 'V1: text-only pipeline publishing';
  if (platform === 'discord') return 'V1: report and notification delivery only; pipeline publishing unavailable';
  if (['instagram', 'tiktok', 'youtube', 'pinterest'].includes(platform)) return 'Connection available; media publishing is not supported in V1';
  return 'Connection available; pipeline publishing is not supported in V1';
}
