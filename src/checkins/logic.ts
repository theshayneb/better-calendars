/** Pure helpers for check-ins: no Obsidian APIs, so they can be unit-tested. */

export interface LatLng {
	lat: number;
	lng: number;
}

/** A place as Foursquare's Places API returns it (the fields we use). */
export interface FsqPlace {
	id: string;
	name: string;
	lat: number;
	lng: number;
	/** e.g. "71-22 Austin St" */
	street: string;
	/** e.g. "71-22 Austin St, Forest Hills, NY 11375" */
	address: string;
	/** Primary category first. */
	categories: { id: string; name: string }[];
	website: string;
	/** Metres from the search point, when searched near a location. */
	distance: number | null;
}

/** What we know about an existing place note. */
export interface PlaceNoteInfo {
	path: string;
	basename: string;
	/** Foursquare ids (Swarm's old ids and the Places API's can differ). */
	fsq: string[];
	location: LatLng | null;
	visits: number;
}

/** Notes this close to a place (and with its name) are taken to be that place. */
export const SAME_PLACE_METRES = 150;

export function distanceMetres(a: LatLng, b: LatLng): number {
	const rad = (d: number) => (d * Math.PI) / 180;
	const dLat = rad(b.lat - a.lat);
	const dLng = rad(b.lng - a.lng);
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
	return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "40.72, -73.84" (or a ["40.72", "-73.84"] list) -> coordinates. */
export function parseLatLng(value: unknown): LatLng | null {
	const text = Array.isArray(value) ? value.join(",") : value;
	if (typeof text !== "string" && typeof text !== "number") return null;
	const m = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(String(text));
	if (!m) return null;
	const lat = Number(m[1]);
	const lng = Number(m[2]);
	if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
	return { lat, lng };
}

export function formatLatLng(p: LatLng): string {
	return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
}

/** Compare names loosely: case, accents and punctuation don't matter. */
export function nameKey(name: string): string {
	return name
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

/**
 * The note that belongs to a place: the one with its Foursquare id; else a
 * note with the same name (also "Name (street)") within SAME_PLACE_METRES,
 * whatever id it has (Swarm's old ids and the Places API's can differ);
 * else the only same-name note that has neither coordinates nor an id.
 */
export function matchPlaceNote(place: FsqPlace, notes: PlaceNoteInfo[]): PlaceNoteInfo | null {
	const byId = notes.find((n) => n.fsq.includes(place.id));
	if (byId) return byId;
	const key = nameKey(place.name);
	const candidates = notes.filter((n) => {
		const base = n.basename.replace(/\s*\([^)]*\)\s*$/, "");
		return nameKey(base) === key || nameKey(n.basename) === key;
	});
	const near = candidates
		.filter((n) => n.location && distanceMetres(n.location, place) <= SAME_PLACE_METRES)
		.sort((a, b) => distanceMetres(a.location as LatLng, place) - distanceMetres(b.location as LatLng, place));
	if (near.length > 0) return near[0] ?? null;
	const blank = candidates.filter((n) => !n.location && n.fsq.length === 0);
	return blank.length === 1 ? (blank[0] ?? null) : null;
}

/** "71-22 Austin St" -> "Austin St" (the street without the house number). */
export function streetName(street: string): string {
	const s = street.split(",")[0]?.trim() ?? "";
	return s.replace(/^[\d][\w-]*\s+/, "").trim() || s;
}

/**
 * File name for a new place note: the place's name, or "Name (street)" when
 * a note of that name already belongs to another place.
 */
export function placeNoteName(place: FsqPlace, isTaken: (name: string) => boolean): string {
	const name = cleanFileName(place.name) || "Unnamed place";
	if (!isTaken(name)) return name;
	const street = cleanFileName(streetName(place.street || place.address));
	if (street) {
		const withStreet = `${name} (${street})`;
		if (!isTaken(withStreet)) return withStreet;
	}
	for (let i = 2; i < 100; i++) {
		const n = `${name} (${i})`;
		if (!isTaken(n)) return n;
	}
	return `${name} (${place.id})`;
}

/** Characters Windows (\\ / : * ? " < > |) and Obsidian links (# ^ [ ]) don't allow in note names. */
export const NOT_ALLOWED_IN_NAMES = '\\ / : * ? " < > | # ^ [ ]';

/**
 * A name that's safe as a note name on Windows, macOS, Linux, Android and
 * iOS: no forbidden characters, no leading dot, no trailing dots or spaces,
 * and not a name Windows reserves (CON, NUL, COM1, ...).
 */
export function cleanFileName(name: string): string {
	let out = name
		// eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
		.replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 120)
		.replace(/^[.\s]+/, "")
		.replace(/[.\s]+$/, "");
	if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(out)) out = `${out} place`;
	return out;
}

/** Unique, case-insensitively, keeping the first spelling and order. */
export function uniqueTags(tags: Iterable<string>): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of tags) {
		const t = normalizeTag(raw);
		if (!t || seen.has(t.toLowerCase())) continue;
		seen.add(t.toLowerCase());
		out.push(t);
	}
	return out;
}

/** "#Pizza Place" -> "Pizza-Place"; tags can't contain spaces. */
export function normalizeTag(tag: string): string {
	return tag.trim().replace(/^#+/, "").replace(/\s+/g, "-");
}

/** The tags a check-in gives a place: always-tags, chosen tags, and the tags those bring along. */
export function checkinTags(
	always: string[],
	chosen: string[],
	implied: Record<string, string[]>
): string[] {
	const out = [...always, ...chosen];
	const impliedLower = new Map(
		Object.entries(implied).map(([k, v]) => [k.toLowerCase(), v])
	);
	for (const t of chosen) out.push(...(impliedLower.get(normalizeTag(t).toLowerCase()) ?? []));
	return uniqueTags(out);
}

/** Existing tags first (never removed), then the new ones. */
export function mergeTags(existing: unknown, add: string[]): string[] {
	const list = Array.isArray(existing)
		? existing.filter((t): t is string => typeof t === "string")
		: typeof existing === "string" && existing.trim()
			? existing.split(/[,\s]+/)
			: [];
	return uniqueTags([...list, ...add]);
}

/** A property value as a list of strings. */
export function asList(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((v) => v !== null && v !== undefined && String(v).trim() !== "").map(String);
	}
	if (typeof value === "string" && value.trim()) return [value];
	if (typeof value === "number") return [String(value)];
	return [];
}

/** Add items that aren't in the list yet (compared with `key`). */
export function addMissing(list: string[], items: string[], key = (s: string) => s.trim().toLowerCase()): string[] {
	const out = [...list];
	const keys = new Set(out.map(key));
	for (const item of items) {
		const k = key(item);
		if (!k || keys.has(k)) continue;
		keys.add(k);
		out.push(item);
	}
	return out;
}

/** Compare links and plain names alike: "[[Travel/Prince Tea|Prince]]" ~ "Prince Tea". */
export function linkKey(value: string): string {
	let v = value.trim();
	const link = /^\[\[([^\]]+)\]\]$/.exec(v);
	if (link?.[1]) {
		v = link[1].split("|")[0] ?? "";
		v = v.slice(v.lastIndexOf("/") + 1).replace(/\.md$/i, "");
	}
	return v.trim().toLowerCase();
}

/** "2026-11-11 12:40 · with Sam" (the note on one line). */
export function visitEntry(stamp: string, note: string): string {
	const text = note.replace(/\s+/g, " ").trim();
	return text ? `${stamp} · ${text}` : stamp;
}

export function googleMapsUrl(place: FsqPlace): string {
	const query = place.address ? `${place.name}, ${place.address}` : `${place.lat},${place.lng}`;
	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Swarm shouts are at most 140 characters. */
export function swarmShout(note: string): string {
	const text = note.replace(/\s+/g, " ").trim();
	return text.length <= 140 ? text : `${text.slice(0, 139)}…`;
}

const GUESSES: [RegExp, string][] = [
	[/pizz/i, "pizza"],
	[/\btea\b|bubble tea|boba/i, "tea"],
	[/dessert|ice cream|gelato|frozen yogurt|bakery|donut|doughnut|cake|pastry|chocolate|candy|creperie|cupcake/i, "dessert"],
	[/museum|gallery/i, "museum"],
	[/park|garden|trail|beach|lake|forest|mountain|playground|nature|scenic lookout/i, "outdoors"],
	[/monument|landmark|historic|memorial|castle|church|temple|bridge|plaza|sculpture|lookout/i, "sight"],
	[/shop|store|mall|market|boutique|retail/i, "shopping"],
	[/restaurant|diner|caf[eé]|coffee|food|bar\b|pub|grill|burger|sushi|taco|noodle|bbq|steak|deli|bistro/i, "food"],
	[/theater|theatre|cinema|bowling|arcade|stadium|arena|zoo|aquarium|amusement|escape|gym|climbing|golf|music venue|concert/i, "activity"],
];

/** A suggested tag for a category name, if one of `tags` fits. */
export function guessTag(categoryName: string, tags: string[]): string | null {
	const have = new Map(tags.map((t) => [t.toLowerCase(), t]));
	for (const [re, tag] of GUESSES) {
		if (re.test(categoryName) && have.has(tag)) return have.get(tag) ?? null;
	}
	return null;
}
