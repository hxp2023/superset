import type { TriggerOptionSource } from "../trigger-options";
import {
	findTeamsConnection,
	getGraphAccessToken,
	isGraphAuthError,
} from "./graph";
import { listChannels, listTeams, listUsers } from "./resources";

/** How many teams' channel lists are fetched at once when building the
 * channel picker. Graph throttles per app per tenant; a tenant with hundreds
 * of teams is walked in batches rather than all at once. */
const CHANNEL_FETCH_CONCURRENCY = 5;

async function accessTokenFor(organizationId: string): Promise<string | null> {
	const connection = await findTeamsConnection(organizationId);
	if (!connection) return null;
	return getGraphAccessToken(connection.id);
}

function byLabel<T extends { label: string }>(a: T, b: T) {
	return a.label.localeCompare(b.label);
}

const teams: TriggerOptionSource = async ({ organizationId }) => {
	const accessToken = await accessTokenFor(organizationId);
	if (!accessToken) return [];
	const list = await listTeams(accessToken);
	return list
		.map((team) => ({ id: team.id, label: team.displayName ?? team.id }))
		.sort(byLabel);
};

const channels: TriggerOptionSource = async ({ organizationId }) => {
	const accessToken = await accessTokenFor(organizationId);
	if (!accessToken) return [];
	const list = await listTeams(accessToken);
	const options: Array<{ id: string; label: string }> = [];
	for (let i = 0; i < list.length; i += CHANNEL_FETCH_CONCURRENCY) {
		const batch = list.slice(i, i + CHANNEL_FETCH_CONCURRENCY);
		const results = await Promise.allSettled(
			batch.map(async (team) => {
				const teamChannels = await listChannels(accessToken, team.id);
				return teamChannels.map((channel) => ({
					id: channel.id,
					// Channel names repeat across teams ("General" is in every
					// one), so the picker shows which team a channel belongs to.
					label: `${team.displayName ?? team.id} › ${channel.displayName ?? channel.id}`,
				}));
			}),
		);
		for (const result of results) {
			if (result.status === "fulfilled") options.push(...result.value);
			else {
				console.error(
					"[microsoft-teams] listing channels failed for a team",
					result.reason,
				);
			}
		}
	}
	return options.sort(byLabel);
};

const people: TriggerOptionSource = async ({ organizationId }) => {
	const accessToken = await accessTokenFor(organizationId);
	if (!accessToken) return [];
	try {
		const users = await listUsers(accessToken);
		return users
			.map((user) => ({
				id: user.id,
				label:
					user.displayName ?? user.mail ?? user.userPrincipalName ?? user.id,
			}))
			.sort(byLabel);
	} catch (error) {
		// The tenant consented before User.ReadBasic.All was asked for: an
		// empty picker, not a red editor.
		if (!isGraphAuthError(error)) throw error;
		console.warn("[microsoft-teams] listing people refused:", error);
		return [];
	}
};

export const microsoftTeamsTriggerOptions = { teams, channels, people };
