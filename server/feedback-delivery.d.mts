export interface FeedbackReply {
  ticketId: string; messageId: string; author: string; body: string;
  emailPayload: { from: string; to: string[]; subject: string; text: string };
  claimToken?: string;
}
export interface ReplyStore {
  pendingDiscordThreads(): Promise<{ ticketId: string; email: string; threadId: string; lastMessageId?: string | null }[]>;
  markDiscordPoll(ticketId: string): Promise<void>;
  failDiscordPoll(ticketId: string, error: string): Promise<void>;
  advanceDiscordCursor(ticketId: string, messageId: string): Promise<void>;
  claimDiscordReply(reply: FeedbackReply): Promise<{ state: 'claimed'; reply: FeedbackReply } | { state: 'sent' | 'busy' }>;
  finishDiscordReply(reply: FeedbackReply, providerId: string): Promise<boolean>;
  failDiscordReply(reply: FeedbackReply, error: string): Promise<void>;
}
export interface ReplyEnvironment {
  DISCORD_BOT_TOKEN?: string; DISCORD_FEEDBACK_CHANNEL_ID?: string; RESEND_API_KEY?: string;
  FEEDBACK_FROM_EMAIL?: string; RESEND_FROM_EMAIL?: string; DISCORD_REPLY_DELIVERY_ENABLED?: string;
}
export function createReplyStore(database: { query(sql: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }> }): ReplyStore;
export function supportReplyConfiguration(env: ReplyEnvironment): boolean;
export function deliverDiscordReplies(options: { env: ReplyEnvironment; fetchImpl?: typeof fetch; feedbackStore?: ReplyStore; reportError?: (detail: { ticketId: string; code: string }) => void }): Promise<void>;
