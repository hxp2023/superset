import { homedir } from "node:os";
import { join } from "node:path";
// better-sqlite3, not `bun:sqlite`: the host service runs under Electron's
// Node. Tests never import this module — the bridge takes a `readChatDb` dep.
import Database from "better-sqlite3";
import { extractTextFromAttributedBody } from "./attributed-body";
import type { ChatDbSnapshot, InboundMessage } from "./types";

/** Apple epoch (2001-01-01) → Unix epoch, and chat.db dates are nanoseconds. */
const APPLE_EPOCH_OFFSET_S = 978_307_200;

const MAX_ROWS_PER_READ = 50;

export function defaultChatDbPath(): string {
	return join(homedir(), "Library", "Messages", "chat.db");
}

interface RawRow {
	rowId: number;
	guid: string;
	chatIdentifier: string;
	senderHandle: string | null;
	isFromMe: number;
	itemType: number;
	text: string | null;
	attributedBody: Uint8Array | null;
	date: number;
}

/**
 * One-shot read of everything the bridge needs. Opens read-only and closes
 * before returning: Messages.app owns this database, and a lingering handle
 * has nothing to gain. NOT `immutable` — that flag ignores the write-ahead
 * log, so a text received moments ago would read as absent.
 *
 * Throws when the file is unreadable — most commonly missing Full Disk
 * Access, which the caller surfaces as a remedy rather than a crash.
 */
export function readChatDb(
	sinceRowId: number,
	chatIdentifiers: string[],
	dbPath: string = defaultChatDbPath(),
): ChatDbSnapshot {
	const db = new Database(dbPath, { readonly: true, fileMustExist: true });
	try {
		const maxRowId =
			(
				db.prepare("SELECT COALESCE(MAX(ROWID), 0) AS m FROM message").get() as
					| { m: number }
					| undefined
			)?.m ?? 0;

		const ownAccounts = (
			db
				.prepare(
					"SELECT DISTINCT account_login AS login FROM chat WHERE account_login IS NOT NULL",
				)
				.all() as { login: string }[]
		)
			.map(({ login }) => login.replace(/^[EP]:/, ""))
			.filter((login) => login.length > 0);

		let rows: InboundMessage[] = [];
		if (chatIdentifiers.length > 0) {
			const placeholders = chatIdentifiers.map(() => "?").join(", ");
			const raw = db
				.prepare(
					`SELECT m.ROWID AS rowId, m.guid AS guid, m.is_from_me AS isFromMe,
						m.item_type AS itemType, m.text AS text,
						m.attributedBody AS attributedBody, m.date AS date,
						c.chat_identifier AS chatIdentifier, h.id AS senderHandle
					FROM message m
					JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
					JOIN chat c ON c.ROWID = cmj.chat_id
					LEFT JOIN handle h ON h.ROWID = m.handle_id
					WHERE m.ROWID > ? AND c.chat_identifier IN (${placeholders})
					ORDER BY m.ROWID ASC
					LIMIT ${MAX_ROWS_PER_READ}`,
				)
				.all(sinceRowId, ...chatIdentifiers) as RawRow[];

			rows = raw.map((row) => ({
				rowId: row.rowId,
				guid: row.guid,
				chatIdentifier: row.chatIdentifier,
				senderHandle: row.senderHandle,
				isFromMe: row.isFromMe === 1,
				itemType: row.itemType,
				text:
					row.text ?? extractTextFromAttributedBody(row.attributedBody ?? null),
				sentAt: Math.floor(row.date / 1_000_000) + APPLE_EPOCH_OFFSET_S * 1000,
			}));
		}

		return { rows, maxRowId, ownAccounts };
	} finally {
		db.close();
	}
}
