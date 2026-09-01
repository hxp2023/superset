# Superset over iMessage

Text your Superset agents from your phone. The bridge (macOS only) polls
`~/Library/Messages/chat.db` for new texts in allowlisted conversations,
routes them to the most recent live agent terminal as framed input, and the
agent texts back with `superset imessage reply`.

## Setup

```bash
superset imessage enable --handle +15551234567   # or your own iMessage email
superset imessage status
```

Texting your **own** iMessage address watches the "Messages to yourself"
chat, so a second Apple ID is not required. Two self-chat facts drive the
implementation (both observed live, not documented by Apple):

- Messages keys the self-chat by whichever of your own addresses the sending
  device picked — a text from your phone can land in a chat identified by
  your phone number even though you allowlisted your email. Allowlisting any
  own address therefore watches **all** of the Mac's own accounts
  (`effectiveWatchList`).
- Every device writes `is_from_me = 1` in the self-chat, which is why every
  message the bridge sends starts with an invisible U+2063 marker — that
  marker, not the sender column, is the loop guard (`selectInbound`).

## Message flow

- Free text → delivered to the conversation's bound agent session, or the
  most recently active live agent when none is bound (first routing sends a
  one-time ack naming the agent and workspace).
- `status` → per-agent summary (workspace, working/idle, recency).
- `help` → usage.

Agents reply through the `imessage.reply` procedure, which only ever sends
to allowlisted conversations and is rate-limited to
`MAX_SENDS_PER_MINUTE`. Inbound text is control-character-stripped before it
touches a PTY (same reasoning as `page-watch/buildPrompt.ts`).

## Requirements and failure modes

- **Full Disk Access** for Superset — chat.db is TCC-protected. Read
  failures surface in `superset imessage status` (state `error`) and stop
  the poll loop after `MAX_CONSECUTIVE_FAILURES`.
- **Automation permission** for Messages.app — the first send triggers the
  TCC prompt (`osascript` sends via `applescript.ts`; text rides in argv, so
  a message body can never inject AppleScript).
- Sends target the 1:1 `participant` — group chats are not supported yet.

State: allowlist and enablement live on `host_settings`
(`imessage_enabled`, `imessage_handles`); `imessage_cursor` is the last
processed chat.db ROWID, so restarts never replay history. Conversation →
terminal bindings are in-memory and re-resolve after a restart.
