import { Notice } from "obsidian";
import type BetterCalendarsPlugin from "../main";
import type { QueuedSwarmCheckin } from "../settings";
import {
	FoursquareError,
	swarmAuthorizeUrl,
	swarmCheckIn,
	swarmExchangeCode,
	swarmUserName,
} from "./foursquare";

const DEVICE_KEY = "better-calendars-device-id";
/** How many Swarm check-in ids made from Obsidian are remembered. */
const MAX_POSTED_IDS = 5000;

/** A random id for this device, kept in its local storage (not synced). */
export function deviceId(plugin: BetterCalendarsPlugin): string {
	const stored: unknown = plugin.app.loadLocalStorage(DEVICE_KEY);
	if (typeof stored === "string" && stored) return stored;
	const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	plugin.app.saveLocalStorage(DEVICE_KEY, id);
	return id;
}

/** Open Foursquare's sign-in page; it comes back through the obsidian:// link. */
export function startSwarmConnect(plugin: BetterCalendarsPlugin): void {
	const s = plugin.settings;
	if (!s.swarmClientId.trim() || !s.swarmClientSecret.trim()) {
		new Notice("Better Calendars: enter the client ID and client secret first.");
		return;
	}
	window.open(swarmAuthorizeUrl(s.swarmClientId.trim()));
}

/** Handles obsidian://better-calendars-swarm?code=… */
export async function finishSwarmConnect(
	plugin: BetterCalendarsPlugin,
	params: Record<string, string>
): Promise<void> {
	const s = plugin.settings;
	if (params.error) {
		new Notice(`Better Calendars: Swarm sign-in was cancelled (${params.error}).`);
		return;
	}
	const code = params.code;
	if (!code) {
		new Notice("Better Calendars: Swarm sign-in came back without a code.");
		return;
	}
	try {
		const token = await swarmExchangeCode(s.swarmClientId.trim(), s.swarmClientSecret.trim(), code);
		s.swarmToken = token;
		s.swarmUser = await swarmUserName(token).catch(() => "Swarm user");
		await plugin.saveSettings();
		plugin.refreshSettingsTab();
		new Notice(`Better Calendars: connected to Swarm as ${s.swarmUser}.`);
	} catch (e) {
		new Notice(`Better Calendars: Swarm sign-in failed. ${e instanceof Error ? e.message : String(e)}`, 10_000);
	}
}

export async function disconnectSwarm(plugin: BetterCalendarsPlugin): Promise<void> {
	plugin.settings.swarmToken = "";
	plugin.settings.swarmUser = "";
	await plugin.saveSettings();
}

function rememberPosted(plugin: BetterCalendarsPlugin, id: string): void {
	const ids = plugin.settings.swarmPostedIds;
	ids.push(id);
	if (ids.length > MAX_POSTED_IDS) ids.splice(0, ids.length - MAX_POSTED_IDS);
}

/** True when the error means "try again later" rather than "this will never work". */
function isTransient(e: unknown): boolean {
	return !(e instanceof FoursquareError) || e.status === 0 || e.status === 429 || e.status >= 500;
}

/**
 * Post a check-in to Swarm. If that fails for a passing reason (no signal,
 * Foursquare down), queue it for the next refresh. Returns a short status.
 */
export async function postToSwarm(
	plugin: BetterCalendarsPlugin,
	item: Omit<QueuedSwarmCheckin, "device" | "attempts" | "lastError">,
	at: { lat: number; lng: number } | null
): Promise<"posted" | "queued" | "failed"> {
	const s = plugin.settings;
	if (!s.swarmToken) return "failed";
	try {
		const id = await swarmCheckIn(s.swarmToken, item.venueId, item.shout, at);
		rememberPosted(plugin, id);
		return "posted";
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		if (isTransient(e)) {
			s.swarmQueue.push({ ...item, device: deviceId(plugin), attempts: 1, lastError: message });
			return "queued";
		}
		new Notice(`Better Calendars: Swarm check-in failed. ${message}`, 10_000);
		return "failed";
	}
}

/** Retry this device's queued Swarm check-ins. Returns how many went through. */
export async function retrySwarmQueue(plugin: BetterCalendarsPlugin): Promise<number> {
	const s = plugin.settings;
	if (!s.swarmToken || s.swarmQueue.length === 0) return 0;
	const me = deviceId(plugin);
	let posted = 0;
	let changed = false;
	for (const item of [...s.swarmQueue]) {
		if (item.device !== me) continue;
		try {
			const id = await swarmCheckIn(s.swarmToken, item.venueId, item.shout, null);
			rememberPosted(plugin, id);
			s.swarmQueue.splice(s.swarmQueue.indexOf(item), 1);
			posted++;
		} catch (e) {
			item.attempts++;
			item.lastError = e instanceof Error ? e.message : String(e);
			if (!isTransient(e)) {
				s.swarmQueue.splice(s.swarmQueue.indexOf(item), 1);
				new Notice(
					`Better Calendars: gave up posting ${item.placeName} to Swarm. ${item.lastError}`,
					10_000
				);
			}
		}
		changed = true;
	}
	if (changed) await plugin.saveSettings();
	if (posted > 0) {
		new Notice(`Better Calendars: posted ${posted} queued check-in${posted === 1 ? "" : "s"} to Swarm.`);
	}
	return posted;
}
