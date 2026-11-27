/**
 * Merging the plugin's settings (data.json) between devices, by edit time.
 *
 * Obsidian Sync merges data.json per top-level key, and since every device
 * writes every key, the device that saved last wins whole keys. A phone or
 * tablet that syncs every few hours or days would then put back its stale
 * copy of everything it never touched. So every save (and every external
 * change) re-reads the file and merges it with what's in memory here:
 *
 * - Plain settings: each key carries the time it was last edited (on any
 *   device); the newer edit wins.
 * - Collections (calendars, the import records, skipped places, ...): the
 *   same per entry, and removed entries are kept as tombstones, so a stale
 *   copy can neither undo a removal nor drop entries it never had.
 * - Append-only id lists (reviewed check-ins, check-ins posted from
 *   Obsidian): union.
 *
 * Edit times are assigned by comparing memory with the copy last read from
 * or written to disk (`stampEdits`), so callers just change the settings and
 * save. Data without edit times (older plugin versions) counts as time 0:
 * it is kept, and loses to any stamped edit.
 *
 * Pure: no Obsidian APIs, so it is unit-tested.
 */

export const META_KEY = "_sync";

export interface SyncMeta {
	/** Edit time (ms) per plain setting. */
	keys: Record<string, number>;
	/** Per collection: edit time (ms) per entry id. */
	items: Record<string, Record<string, number>>;
	/** Per collection: removal time (ms) per entry id (tombstones). */
	gone: Record<string, Record<string, number>>;
}

export type Data = Record<string, unknown>;

type Kind =
	| { kind: "map" }
	| { kind: "set" }
	| { kind: "list"; idOf: (item: unknown) => string };

const field = (item: unknown, name: string): string => {
	const v = (item as Record<string, unknown> | null)?.[name];
	return typeof v === "string" || typeof v === "number" ? String(v) : "";
};

/** Settings merged entry by entry. */
export const COLLECTIONS: Record<string, Kind> = {
	calendars: { kind: "list", idOf: (c) => field(c, "id") },
	imported: { kind: "map" },
	noteNames: { kind: "map" },
	peopleAdded: { kind: "map" },
	categoryTags: { kind: "map" },
	impliedTags: { kind: "map" },
	swarmSkipped: { kind: "set" },
	swarmSkippedPlaces: { kind: "set" },
	swarmQueue: {
		kind: "list",
		idOf: (q) => `${field(q, "device")}|${field(q, "at")}|${field(q, "venueId")}`,
	},
};

/**
 * Append-only id lists, merged as unions. No cap: two devices trimming a
 * capped list differently rewrote each other's file forever (1.4.0–1.4.1).
 */
export const UNIONS: Record<string, number> = {
	swarmReviewed: Infinity,
	swarmPostedIds: Infinity,
};

/** Keys that are never merged: whatever is on disk stays (old versions may still write them). */
export const LOCAL_ONLY = new Set(["lastLocation"]);

/** Tombstones older than this are forgotten. */
export const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export function emptyMeta(): SyncMeta {
	return { keys: {}, items: {}, gone: {} };
}

/** Read the meta from data, tolerating anything (missing, old, damaged). */
export function metaOf(data: Data): SyncMeta {
	const raw = data[META_KEY] as Partial<SyncMeta> | undefined;
	const nums = (o: unknown): Record<string, number> => {
		const out: Record<string, number> = {};
		if (o && typeof o === "object") {
			for (const [k, v] of Object.entries(o)) if (typeof v === "number" && isFinite(v)) out[k] = v;
		}
		return out;
	};
	const nested = (o: unknown): Record<string, Record<string, number>> => {
		const out: Record<string, Record<string, number>> = {};
		if (o && typeof o === "object") {
			for (const [k, v] of Object.entries(o)) out[k] = nums(v);
		}
		return out;
	};
	return { keys: nums(raw?.keys), items: nested(raw?.items), gone: nested(raw?.gone) };
}

const json = (v: unknown): string => JSON.stringify(v) ?? "undefined";

/** The entries of a collection value, in order, keyed by id. */
function entriesOf(kind: Kind, value: unknown): Map<string, unknown> {
	const out = new Map<string, unknown>();
	if (kind.kind === "map") {
		if (value && typeof value === "object" && !Array.isArray(value)) {
			for (const [k, v] of Object.entries(value)) out.set(k, v);
		}
	} else if (Array.isArray(value)) {
		for (const item of value) {
			const id = kind.kind === "set" ? (typeof item === "string" ? item : "") : kind.idOf(item);
			if (id && !out.has(id)) out.set(id, kind.kind === "set" ? true : item);
		}
	}
	return out;
}

function build(kind: Kind, entries: Map<string, unknown>): unknown {
	if (kind.kind === "map") return Object.fromEntries(entries);
	if (kind.kind === "set") return [...entries.keys()];
	return [...entries.values()];
}

const isMerged = (key: string) =>
	key !== META_KEY && !LOCAL_ONLY.has(key) && !(key in UNIONS);

/**
 * Record the edits made in `current` since `baseline` (the copy last read
 * from or written to disk) with time `now`, in `current`'s meta.
 */
export function stampEdits(current: Data, baseline: Data, now: number): void {
	const meta = metaOf(current);
	const keys = new Set([...Object.keys(current), ...Object.keys(baseline)]);
	for (const key of keys) {
		if (!isMerged(key)) continue;
		const kind = COLLECTIONS[key];
		if (!kind) {
			if (key in current && json(current[key]) !== json(baseline[key])) meta.keys[key] = now;
			continue;
		}
		const mine = entriesOf(kind, current[key]);
		const before = entriesOf(kind, baseline[key]);
		const items = (meta.items[key] ??= {});
		const gone = (meta.gone[key] ??= {});
		for (const [id, v] of mine) {
			if (!before.has(id) || json(before.get(id)) !== json(v)) {
				items[id] = now;
				delete gone[id];
			}
		}
		for (const id of before.keys()) {
			if (!mine.has(id)) {
				gone[id] = now;
				delete items[id];
			}
		}
	}
	current[META_KEY] = tidyMeta(meta);
}

/** Drop empty sub-objects so an unchanged meta serializes the same way. */
function tidyMeta(meta: SyncMeta): SyncMeta {
	for (const part of [meta.items, meta.gone]) {
		for (const k of Object.keys(part)) if (Object.keys(part[k] ?? {}).length === 0) delete part[k];
	}
	return meta;
}

/**
 * Merge this device's copy (`mine`) into what's on disk (`disk`). The result
 * starts from the disk copy (so keys this version doesn't know are kept) and
 * takes, per setting and per entry, whichever side was edited last. Ties go
 * to the disk copy, so two devices never bounce saves back and forth.
 */
export function mergeData(disk: Data, mine: Data, now: number): Data {
	const dm = metaOf(disk);
	const mm = metaOf(mine);
	const meta = emptyMeta();
	const result: Data = { ...disk };
	const keys = [...new Set([...Object.keys(disk), ...Object.keys(mine)])];

	for (const key of keys) {
		if (key === META_KEY || LOCAL_ONLY.has(key)) continue;

		if (key in UNIONS) {
			const cap = UNIONS[key] ?? Infinity;
			const d = Array.isArray(disk[key]) ? (disk[key] as unknown[]) : [];
			const m = Array.isArray(mine[key]) ? (mine[key] as unknown[]) : [];
			// Usual case: the same list on both sides (or this side is a prefix of the disk's).
			if (key in disk && m.length <= d.length && m.every((x, i) => x === d[i])) continue;
			const have = new Set(d.map(unionKey));
			const extra = m.filter((x) => !have.has(unionKey(x)));
			if (extra.length === 0 && key in disk) continue;
			let list = [...d, ...extra];
			if (list.length > cap) list = list.slice(list.length - cap);
			result[key] = list;
			continue;
		}

		const kind = COLLECTIONS[key];
		if (!kind) {
			const sd = dm.keys[key] ?? 0;
			const sm = mm.keys[key] ?? 0;
			if (!(key in disk) || (key in mine && sm > sd)) {
				result[key] = mine[key];
				if (sm > 0) meta.keys[key] = sm;
			} else if (sd > 0) {
				meta.keys[key] = sd;
			}
			continue;
		}

		const d = entriesOf(kind, disk[key]);
		const m = entriesOf(kind, mine[key]);
		const items: Record<string, number> = {};
		const gone: Record<string, number> = {};
		const out = new Map<string, unknown>();
		const ids = [...new Set([...d.keys(), ...m.keys()])];
		for (const id of [...ids, ...Object.keys(dm.gone[key] ?? {}), ...Object.keys(mm.gone[key] ?? {})]) {
			if (out.has(id) || id in gone) continue;
			const td = dm.items[key]?.[id] ?? 0;
			const tm = mm.items[key]?.[id] ?? 0;
			let put: { value: unknown; at: number } | null = null;
			if (d.has(id)) put = { value: d.get(id), at: td };
			if (m.has(id) && (!put || tm > put.at)) put = { value: m.get(id), at: tm };
			let tomb = Math.max(dm.gone[key]?.[id] ?? 0, mm.gone[key]?.[id] ?? 0);
			if (tomb > 0 && now - tomb > TOMBSTONE_TTL_MS) tomb = 0;
			if (put && (tomb === 0 || put.at > tomb)) {
				out.set(id, put.value);
				if (put.at > 0) items[id] = put.at;
			} else if (tomb > 0) {
				gone[id] = tomb;
			}
		}
		if (Object.keys(items).length > 0) meta.items[key] = items;
		if (Object.keys(gone).length > 0) meta.gone[key] = gone;
		const built = build(kind, out);
		// Keep the disk value itself when nothing changed (same order, same object).
		if (!(key in disk) || json(built) !== json(disk[key])) result[key] = built;
	}

	result[META_KEY] = meta;
	return result;
}

/** Union entries are id strings; anything else is compared as JSON. */
const unionKey = (x: unknown): string => (typeof x === "string" ? `s${x}` : `j${json(x)}`);

/**
 * Whether two data copies are the same (what would be written). Key order,
 * undefined values and empty meta parts don't count as differences.
 * Compares in place, without copying: settings can hold tens of thousands
 * of ids, and this runs on every save, also on phones.
 */
export function sameData(a: Data, b: Data): boolean {
	const keys = (o: Data) => Object.keys(o).filter((k) => k !== META_KEY && o[k] !== undefined);
	const ka = keys(a);
	if (ka.length !== keys(b).length) return false;
	for (const k of ka) if (!(k in b) || !equal(a[k], b[k])) return false;
	return equal(tidyMeta(metaOf(a)), tidyMeta(metaOf(b)));
}

function equal(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false;
		return true;
	}
	if (a && b && typeof a === "object" && typeof b === "object") {
		const x = a as Record<string, unknown>;
		const y = b as Record<string, unknown>;
		const kx = Object.keys(x).filter((k) => x[k] !== undefined);
		if (kx.length !== Object.keys(y).filter((k) => y[k] !== undefined).length) return false;
		for (const k of kx) if (y[k] === undefined || !equal(x[k], y[k])) return false;
		return true;
	}
	return false;
}

export function clone<T>(v: T): T {
	return JSON.parse(JSON.stringify(v)) as T;
}

export interface SyncStep {
	/** What to write to data.json, or null when the disk copy is already right. */
	write: Data | null;
	/** The merged settings: the new memory and the new baseline. */
	merged: Data;
	/** Whether memory differs from the merged settings (other devices' edits came in). */
	memoryChanged: boolean;
}

/**
 * One read-merge-write round: stamp this device's edits since `baseline`,
 * merge with the (normalized) disk copy, and say whether to write.
 */
export function syncStep(mine: Data, baseline: Data, disk: Data, now: number): SyncStep {
	stampEdits(mine, baseline, now);
	const merged = mergeData(disk, mine, now);
	return {
		write: sameData(merged, disk) ? null : merged,
		merged,
		memoryChanged: !sameData(merged, mine),
	};
}
