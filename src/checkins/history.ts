import { normalizePath } from "obsidian";
import type BetterCalendarsPlugin from "../main";
import { swarmCheckinsPage } from "./foursquare";
import { SwarmCheckin, fromRaw, mergeHistory } from "./history-logic";

const PAGE = 250;
/** Safety stop: 400 pages = 100,000 check-ins. */
const MAX_PAGES = 400;

/**
 * The Swarm history lives in a cache file next to the plugin, per device,
 * not in the synced settings: it's large, and every save would otherwise
 * upload all of it again. Only the reviewed ids sync.
 */
function cachePath(plugin: BetterCalendarsPlugin): string {
	return normalizePath(
		`${plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`}/swarm-history.json`
	);
}

let memory: SwarmCheckin[] | null = null;

export async function loadHistory(plugin: BetterCalendarsPlugin): Promise<SwarmCheckin[]> {
	if (memory) return memory;
	const path = cachePath(plugin);
	try {
		if (await plugin.app.vault.adapter.exists(path)) {
			const data = JSON.parse(await plugin.app.vault.adapter.read(path)) as { checkins?: SwarmCheckin[] };
			memory = Array.isArray(data.checkins) ? data.checkins : [];
			return memory;
		}
	} catch (e) {
		console.warn("[Better Calendars] Swarm history cache unreadable, fetching again", e);
	}
	memory = [];
	return memory;
}

async function saveHistory(plugin: BetterCalendarsPlugin, history: SwarmCheckin[]): Promise<void> {
	memory = history;
	await plugin.app.vault.adapter.write(cachePath(plugin), JSON.stringify({ v: 1, checkins: history }));
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
