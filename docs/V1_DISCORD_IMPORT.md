# Discord community snapshot import

Apply migration 0029 before deploying the platform. It allows `discord` batch
sources and indexes workspace/external-message lookup; existing sources remain
valid. No automatic imports, messages, classification backfills or charges run
on deployment.

Configure these server-side platform environment variables:

- `DISCORD_IMPORT_BOT_TOKEN`: a dedicated bot token (never a VITE variable).
- `DISCORD_IMPORT_CHANNELS`: JSON mapping authorized workspace UUIDs to channel
  ID arrays, e.g. `{"11111111-1111-4111-8111-111111111111":["123456789012345678"]}`.

The operator must verify workspace ownership/permission with the community owner
before adding a mapping. A bot's ability to see a channel is NOT tenant consent.
No fallback to the support bot or feedback channel is allowed. Keep the bot's
permissions limited to approved channels and follow your community's data notice.
Removing a mapping prevents new reads, but does not delete already imported data.

Discord requires View Channel and Read Message History, plus Message Content
intent to receive normal message bodies. See the official
[message API documentation](https://docs.discord.com/developers/resources/message#get-channel-messages).
Enable that intent in the Discord Developer Portal; don't grant Administrator
or Send Messages for this connector. Empty results can mean missing permission
or an empty channel; the API does not distinguish these reliably.

In Platform → Imports, enter a batch label, choose the AI band, enter the
authorized channel ID and choose **Import Discord messages**. It scans at most
five pages / 500 recent messages (not 500 guaranteed imported items). Only human
normal messages/replies with nonblank text are stored. Bots, webhook messages,
system events, attachments and nested thread history are excluded. Approved
individual thread IDs can be mapped explicitly. This is a bounded manual
snapshot, not full-history export or continuous synchronization.

The source message ID, stable author ID, original body, channel ID and timestamp
are preserved. Messages over the existing 2,000-character classification limit
fail the snapshot explicitly rather than being silently truncated. No arbitrary
URLs, redirects or attachment fetches are followed. API timeout is 15 seconds
across all pages. Rate limits/provider failures return a safe error without
persisting a partial batch or classification job; retry later.

Role, subscription and credit gates apply before fetching. A transaction-scoped
workspace/channel lock and tenant-scoped message-ID lookup exclude previously
imported messages, including concurrent snapshots. All-new rows and one
classification job commit together; worker billing is unchanged. No new messages
returns 409, not another paid job. Previously imported edits/deletions are not
synchronized. Failed classification retains its source IDs: recover the existing
job through admin replay, rather than reimporting and paying again.

Tests cover 500-message pagination, permission isolation, exact source text,
filtering, malformed results, rate limits, billing gates and UI submission/error
retention. Disposable PostgreSQL CI covers migration, concurrent snapshot dedup,
single-job persistence and cross-tenant rejection. No production Discord fetches
or external messages are used during tests. Live staging acceptance remains open.

Remaining V1 gates include Google Sheets import, full-dataset theme counts,
historical/activity-based scheduled weekly review, and staging/model acceptance.
