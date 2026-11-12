/** Pure helpers for the Swarm history review (no Obsidian APIs). */
import type { RawSwarmCheckin } from "./foursquare";
import type { FsqPlace } from "./logic";

/** A past check-in, stored compactly in the device's history cache. */
export interface SwarmCheckin {
	id: string;
	/** When it happened (ms since epoch). */
	at: number;
	/** The place's UTC offset at the time, in minutes. */
	tz: number;
	shout: string;
	/** Null when Swarm no longer has the venue. */
	place: FsqPlace | null;
}

export function fromRaw(raw: RawSwarmCheckin): SwarmCheckin | null {
	if (!raw.id || typeof raw.createdAt !== "number") return null;
	if (raw.type && raw.type !== "checkin") return null;
	const v = raw.venue;
	let place: FsqPlace | null = null;
	const lat = v?.location?.lat;
	const lng = v?.location?.lng;
	if (v?.id && v.name && typeof lat === "number" && typeof lng === "number") {
		const cats = (v.categories ?? []).filter((c) => c.id && c.name);
		cats.sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)));
		place = {
			id: v.id,
			name: v.name,
			lat,
			lng,
			street: v.location?.address ?? "",
			address: (v.location?.formattedAddress ?? []).join(", "),
			categories: cats.map((c) => ({ id: c.id as string, name: c.name as string })),
			website: v.url ?? "",
			distance: null,
		};
	}
	return {
		id: raw.id,
		at: raw.createdAt * 1000,
		tz: typeof raw.timeZoneOffset === "number" ? raw.timeZoneOffset : 0,
		shout: (raw.shout ?? "").trim(),
		place,
	};
}

/** The check-in's local date and time at the place: "2017-06-03 14:22". */
export function localStamp(c: SwarmCheckin): string {
	const d = new Date(c.at + c.tz * 60_000);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** The check-in's local date: "2017-06-03". */
export function localDate(c: SwarmCheckin): string {
	return localStamp(c).slice(0, 10);
}

/**
 * Merge freshly fetched check-ins into the cache: newest first, no
 * duplicates.
 */
export function mergeHistory(cached: SwarmCheckin[], fresh: SwarmCheckin[]): SwarmCheckin[] {
	const byId = new Map<string, SwarmCheckin>();
	for (const c of [...fresh, ...cached]) if (!byId.has(c.id)) byId.set(c.id, c);
	return [...byId.values()].sort((a, b) => b.at - a.at);
}

/**
 * What's left to review, newest first: everything except check-ins already
 * reviewed (saved or skipped), those made from Obsidian, and every visit to
 * a skipped place.
 */
export function pendingCheckins(
	history: SwarmCheckin[],
	reviewed: Iterable<string>,
	postedFromObsidian: Iterable<string>,
	skippedPlaces: Iterable<string> = []
): SwarmCheckin[] {
	const done = new Set([...reviewed, ...postedFromObsidian]);
	const places = new Set(skippedPlaces);
	return history
		.filter((c) => !done.has(c.id) && !(c.place && places.has(c.place.id)))
		.sort((a, b) => b.at - a.at);
}

/** How many check-ins count toward the progress bar (Obsidian's own excluded). */
export function reviewTotal(history: SwarmCheckin[], postedFromObsidian: Iterable<string>): number {
	const posted = new Set(postedFromObsidian);
	return history.filter((c) => !posted.has(c.id)).length;
}

/** Pending check-ins at the same place (by venue id). */
export function visitsHere(pending: SwarmCheckin[], venueId: string): SwarmCheckin[] {
	return pending.filter((c) => c.place?.id === venueId);
}
