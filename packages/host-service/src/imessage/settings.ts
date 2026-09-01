import { eq } from "drizzle-orm";
import type { HostDb } from "../db";
import { hostSettings } from "../db/schema";
import type { ImessageSettings } from "./types";

const HOST_SETTINGS_ID = 1;

function parseHandles(raw: string | null | undefined): string[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((entry): entry is string => typeof entry === "string");
	} catch {
		return [];
	}
}

export function getImessageSettings(db: HostDb): ImessageSettings {
	const row = db
		.select({
			enabled: hostSettings.imessageEnabled,
			handles: hostSettings.imessageHandles,
		})
		.from(hostSettings)
		.where(eq(hostSettings.id, HOST_SETTINGS_ID))
		.get();
	return {
		enabled: row?.enabled === 1,
		handles: parseHandles(row?.handles),
	};
}

export function setImessageSettings(
	db: HostDb,
	settings: ImessageSettings,
): void {
	const values = {
		imessageEnabled: settings.enabled ? 1 : 0,
		imessageHandles: JSON.stringify(settings.handles),
	};
	db.insert(hostSettings)
		.values({ id: HOST_SETTINGS_ID, ...values })
		.onConflictDoUpdate({ target: hostSettings.id, set: values })
		.run();
}

export function loadImessageCursor(db: HostDb): number | null {
	const row = db
		.select({ cursor: hostSettings.imessageCursor })
		.from(hostSettings)
		.where(eq(hostSettings.id, HOST_SETTINGS_ID))
		.get();
	return row?.cursor ?? null;
}

export function saveImessageCursor(db: HostDb, cursor: number): void {
	db.insert(hostSettings)
		.values({ id: HOST_SETTINGS_ID, imessageCursor: cursor })
		.onConflictDoUpdate({
			target: hostSettings.id,
			set: { imessageCursor: cursor },
		})
		.run();
}
