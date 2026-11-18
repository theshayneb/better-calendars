import { normalizePath } from "obsidian";
import type BetterCalendarsPlugin from "../main";
import { swarmCheckinsPage } from "./foursquare";
import { SwarmCheckin, fromRaw, mergeHistory } from "./history-logic";
import { idbGet, idbSet } from "../util/idb";

const PAGE = 250;
/** Safety stop: 400 pages = 100,000 check-ins. */
const MAX_PAGES = 400;

/**
 * The Swarm history is a per-device cache in IndexedDB (never synced): it's
 * large, and only the reviewed ids need to sync. Before 1.4.0 it was the file
 * swarm-history.json in the plugin folder; that is moved over and removed.
 */
const IDB_KEY = "swarm-history";

function legacyPath(plugin: BetterCalendarsPlugin): string {
	return normalizePath(
		`${plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`}/swarm-history.json`
	);
}

/** One database per vault on this device. */
function dbName(plugin: BetterCalendarsPlugin): string {
	const appId = (plugin.app as unknown as { appId?: unknown }).appId;
	return `better-calendars/${typeof appId === "string" && appId ? appId : plugin.app.vault.getName()}`;
}

let memory: SwarmCheckin[] | null = null;

export async function loadHistory(plugin: BetterCalendarsPlugin): Promise<SwarmCheckin[]> {
	if (memory) return memory;
	try {
		const stored = await idbGet<{ checkins?: SwarmCheckin[] }>(dbName(plugin), IDB_KEY);
		if (stored && Array.isArray(stored.checkins)) {
			memory = stored.checkins;
			return memory;
		}
	} catch (e) {
		console.warn("[Better Calendars] Swarm history cache unreadable, fetching again", e);
	}
	memory = (await moveLegacyFile(plugin)) ?? [];
	return memory;
}

/** Bring the pre-1.4.0 cache file over to IndexedDB and delete it. */
async function moveLegacyFile(plugin: BetterCalendarsPlugin): Promise<SwarmCheckin[] | null> {
	const adapter = plugin.app.vault.adapter;
	const path = legacyPath(plugin);
	try {
		if (!(await adapter.exists(path))) return null;
		const data = JSON.parse(await adapter.read(path)) as { checkins?: SwarmCheckin[] };
		const checkins = Array.isArray(data.checkins) ? data.checkins : [];
		await idbSet(dbName(plugin), IDB_KEY, { v: 1, checkins });
		await adapter.remove(path);
		return checkins;
	} catch (e) {
		console.warn("[Better Calendars] could not move the old Swarm history cache", e);
		return null;
	}
}

async function saveHistory(plugin: BetterCalendarsPlugin, history: SwarmCheckin[]): Promise<void> {
	memory = history;
	try {
		await idbSet(dbName(plugin), IDB_KEY, { v: 1, checkins: history });
	} catch (e) {
		// Kept in memory for this session; fetched again next time.
		console.warn("[Better Calendars] could not save the Swarm history cache", e);
	}
}

/**
 * Fetch check-ins newer than the cache (everything, the first time) and
 * add them to it. Returns the whole history and how many were new.
 */
export async function refreshHistory(
	plugin: BetterCalendarsPlugin,
	onProgress?: (fetched: number, total: number) => void
): Promise<{ history: SwarmCheckin[]; added: number }> {
	const token = plugin.settings.swarmToken;
	const cached = await loadHistory(plugin);
	if (!token) return { history: cached, added: 0 };
	const known = new Set(cached.map((c) => c.id));
	const fresh: SwarmCheckin[] = [];
	let total = 0;
	for (let page = 0; page < MAX_PAGES; page++) {
		const { items, count } = await swarmCheckinsPage(token, page * PAGE, PAGE);
		total = count;
		let reachedKnown = false;
		for (const raw of items) {
			if (raw.id && known.has(raw.id)) {
				reachedKnown = true;
				continue;
			}
			const c = fromRaw(raw);
			if (c) fresh.push(c);
		}
		onProgress?.(fresh.length + cached.length, total);
		if (reachedKnown || items.length < PAGE) break;
	}
	if (fresh.length === 0) return { history: cached, added: 0 };
	const history = mergeHistory(cached, fresh);
	await saveHistory(plugin, history);
	return { history, added: fresh.length };
}
