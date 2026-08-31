import type { TriggerConfigInput } from "@superset/shared/automation-triggers";
import type { TriggerMenuEntry, TriggerProvider } from "./types";

/**
 * The short name of the trigger this config is — "Issue created", "Channel
 * created", "Issue Created" for a nested one.
 *
 * Read off the provider's own Add Trigger menu rather than declared a second
 * time: the menu already names every event, and a label that lived in two
 * places would drift the moment someone renamed one. The provider's own name
 * is left out because the row's icon already says whose trigger this is.
 *
 * Used where the editable sentence would be noise — a row whose integration
 * is not connected has nothing selectable worth showing.
 */
export function triggerEventLabel(
	provider: TriggerProvider,
	config: TriggerConfigInput,
): string {
	const event = (config as { event?: unknown }).event;
	if (typeof event !== "string") return provider.label;

	const walk = (
		entries: TriggerMenuEntry[],
		trail: string[],
	): string | null => {
		for (const entry of entries) {
			// The ellipsis is a menu affordance ("Issue…"), not part of a name.
			const path = [...trail, entry.label.replace(/…$/, "")];
			if ("children" in entry) {
				const found = walk(entry.children, path);
				if (found) return found;
				continue;
			}
			if ((entry.create() as { event?: unknown }).event === event) {
				return path.join(" ");
			}
		}
		return null;
	};

	return walk(provider.menu as TriggerMenuEntry[], []) ?? provider.label;
}
