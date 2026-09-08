import { randomUUID } from 'node:crypto';

// No process/database ownership here: both servers inject their existing pool.
export function createReplyStore(database) {
  return {
    async pendingDiscordThreads() {
      const result = await database.query(`SELECT ticket_no AS "ticketId", email,
          discord_thread_id AS "threadId", discord_last_message_id AS "lastMessageId"
        FROM feedback_message WHERE status IN ('new', 'replied') AND discord_thread_id IS NOT NULL
        ORDER BY discord_polled_at ASC NULLS FIRST, created_at LIMIT 20`);
      return result.rows;
    },
    async markDiscordPoll(ticketId) {
      await database.query('UPDATE feedback_message SET discord_polled_at = now(), discord_poll_error = NULL WHERE ticket_no = $1', [ticketId]);
    },
    async failDiscordPoll(ticketId, error) {
      await database.query('UPDATE feedback_message SET discord_poll_error = $2 WHERE ticket_no = $1', [ticketId, error]);
    },
    async advanceDiscordCursor(ticketId, messageId) {
      await database.query(`UPDATE feedback_message SET discord_last_message_id = $2::text
        WHERE ticket_no = $1 AND (discord_last_message_id IS NULL OR discord_last_message_id::numeric < $2::numeric)`, [ticketId, messageId]);
    },
    async claimDiscordReply(reply) {
      const token = randomUUID();
      const result = await database.query(`INSERT INTO feedback_reply
          (ticket_no, direction, author, body, provider_message_id, delivery_status,
           delivery_claim_token, delivery_locked_until, delivery_first_attempt_at, delivery_payload)
        VALUES ($1, 'outbound', $2, $3, $4, 'pending', $5, now() + interval '2 minutes', now(), $6)
        ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL
        DO UPDATE SET delivery_status = 'pending', delivery_error = NULL,
          delivery_claim_token = EXCLUDED.delivery_claim_token,
          delivery_locked_until = EXCLUDED.delivery_locked_until,
          delivery_payload = COALESCE(feedback_reply.delivery_payload, EXCLUDED.delivery_payload)
        WHERE feedback_reply.ticket_no = EXCLUDED.ticket_no
          AND feedback_reply.delivery_status <> 'sent'
          AND (feedback_reply.delivery_locked_until IS NULL OR feedback_reply.delivery_locked_until < now())
          AND feedback_reply.delivery_first_attempt_at > now() - interval '23 hours'
        RETURNING author, body, delivery_payload AS "emailPayload"`,
      [reply.ticketId, reply.author, reply.body, reply.messageId, token, reply.emailPayload]);
      const row = result.rows[0];
      if (row) return { state: 'claimed', reply: { ...reply, ...row, claimToken: token } };
      const existing = await database.query(`SELECT ticket_no, delivery_status,
          (delivery_first_attempt_at <= now() - interval '23 hours') AS expired
        FROM feedback_reply WHERE provider_message_id = $1`, [reply.messageId]);
      const previous = existing.rows[0];
      if (previous?.ticket_no !== reply.ticketId) throw new Error('discord_reply_ticket_mismatch');
      if (previous.delivery_status === 'sent') return { state: 'sent' };
      if (previous.expired) throw new Error('resend_delivery_reconciliation_required');
      return { state: 'busy' };
    },
    async finishDiscordReply(reply, providerId) {
      const result = await database.query(`WITH delivered AS (
          UPDATE feedback_reply SET delivery_status = 'sent', delivery_error = NULL,
            provider_delivery_id = $5, sent_at = now(), delivery_locked_until = NULL
          WHERE provider_message_id = $1 AND delivery_claim_token = $6 AND delivery_status = 'pending'
          RETURNING ticket_no
        ) UPDATE feedback_message SET status = CASE WHEN status = 'closed' THEN 'closed' ELSE $4 END,
            replied_by = $3, replied_at = now()
          WHERE ticket_no = $2 AND EXISTS (SELECT 1 FROM delivered WHERE delivered.ticket_no = feedback_message.ticket_no)
          RETURNING ticket_no`, [reply.messageId, reply.ticketId, reply.author, reply.body.toLowerCase() === '/close' ? 'closed' : 'replied', providerId, reply.claimToken]);
      return result.rows.length === 1;
    },
    async failDiscordReply(reply, error) {
      await database.query(`UPDATE feedback_reply SET delivery_status = 'failed', delivery_error = $3,
          delivery_locked_until = NULL
        WHERE provider_message_id = $1 AND delivery_claim_token = $2 AND delivery_status = 'pending'`,
      [reply.messageId, reply.claimToken, error]);
    },
  };
}

export function supportReplyConfiguration(env) {
  if (env.DISCORD_REPLY_DELIVERY_ENABLED === 'false') return false;
  // Resend may be configured for activation without any Discord integration.
  if (!env.DISCORD_BOT_TOKEN && !env.DISCORD_FEEDBACK_CHANNEL_ID) return false;
  const required = {
    DISCORD_BOT_TOKEN: env.DISCORD_BOT_TOKEN,
    DISCORD_FEEDBACK_CHANNEL_ID: env.DISCORD_FEEDBACK_CHANNEL_ID,
    RESEND_API_KEY: env.RESEND_API_KEY,
    'FEEDBACK_FROM_EMAIL or RESEND_FROM_EMAIL': env.FEEDBACK_FROM_EMAIL || env.RESEND_FROM_EMAIL,
  };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`Discord reply delivery missing configuration: ${missing.join(', ')}`);
  return true;
}

const snowflake = (id) => typeof id === 'string' && /^\d{1,20}$/.test(id);
function replyText(value) {
  return typeof value === 'string' ? value.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 5000) : '';
}
function errorCode(error) {
  // Never persist/log raw provider response bodies, tokens or message content.
  return error instanceof Error && /^(discord_|resend_|feedback_)[a-z_0-9]+$/.test(error.message) ? error.message : 'feedback_delivery_failed';
}

export async function deliverDiscordReplies({ env, fetchImpl = fetch, feedbackStore, reportError = (detail) => console.error('Discord reply delivery failed', detail) }) {
  if (!supportReplyConfiguration(env)) return;
  if (!feedbackStore) throw new Error('feedback_database_not_configured');
  tickets: for (const ticket of await feedbackStore.pendingDiscordThreads()) {
    try {
      await feedbackStore.markDiscordPoll(ticket.ticketId);
      let cursor = ticket.lastMessageId || ticket.threadId;
      if (!snowflake(cursor) || !snowflake(ticket.threadId)) throw new Error('discord_thread_id_invalid');
      // Bound work per ticket; persistent cursors resume remaining pages later.
      for (let page = 0; page < 5; page++) {
        const response = await fetchImpl(`https://discord.com/api/v10/channels/${ticket.threadId}/messages?limit=100&after=${cursor}`, {
          headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }, signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`discord_thread_messages_failed_${response.status}`);
        const messages = await response.json();
        if (!Array.isArray(messages) || messages.some((message) => !snowflake(message?.id))) throw new Error('discord_messages_invalid');
        const ordered = messages.filter((message) => BigInt(message.id) > BigInt(cursor)).sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
        if (!ordered.length) break;
        for (const message of ordered) {
          // Bots/webhooks/system messages must not become customer emails.
          if (message.author?.bot || message.webhook_id || (message.type !== undefined && ![0, 19].includes(message.type))) {
            await feedbackStore.advanceDiscordCursor(ticket.ticketId, message.id); cursor = message.id; continue;
          }
          const body = replyText(message.content);
          // Empty human content can mean MESSAGE_CONTENT is disabled. Keep the
          // cursor so granting the intent later can recover the unseen reply.
          if (!body) throw new Error('discord_reply_content_missing');
          const emailBody = body.toLowerCase() === '/close' ? 'Your Piggybot support ticket has been closed.' : body;
          const reply = { ticketId: ticket.ticketId, messageId: message.id, author: `discord:${message.author?.id ?? 'operator'}`, body,
            emailPayload: { from: env.FEEDBACK_FROM_EMAIL || env.RESEND_FROM_EMAIL, to: [ticket.email], subject: `[${ticket.ticketId}] Piggybot support reply`, text: `${emailBody}\n\nPlease include ticket ${ticket.ticketId} when contacting support.` } };
          const claimed = await feedbackStore.claimDiscordReply(reply);
          if (claimed.state === 'busy') throw new Error('feedback_reply_claim_busy');
          if (claimed.state === 'claimed') {
            try {
              const email = await fetchImpl('https://api.resend.com/emails', {
                method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `feedback-reply/${message.id}` },
                body: JSON.stringify(claimed.reply.emailPayload), signal: AbortSignal.timeout(10_000),
              });
              if (!email.ok) throw new Error(`resend_delivery_failed_${email.status}`);
              const accepted = await email.json();
              if (typeof accepted?.id !== 'string' || !accepted.id) throw new Error('resend_delivery_missing_id');
              if (!(await feedbackStore.finishDiscordReply(claimed.reply, accepted.id))) throw new Error('feedback_reply_claim_lost');
            } catch (error) {
              await feedbackStore.failDiscordReply(claimed.reply, errorCode(error));
              throw error;
            }
          }
          await feedbackStore.advanceDiscordCursor(ticket.ticketId, message.id); cursor = message.id;
          if ((claimed.state === 'claimed' ? claimed.reply.body : body).toLowerCase() === '/close') continue tickets;
        }
        if (messages.length < 100) break;
      }
    } catch (error) {
      const code = errorCode(error);
      await feedbackStore.failDiscordPoll(ticket.ticketId, code);
      if (code !== 'feedback_reply_claim_busy') reportError({ ticketId: ticket.ticketId, code });
      // One inaccessible thread or failed email must not block other tickets.
    }
  }
}
