import { App, TFile, normalizePath, stringifyYaml } from "obsidian";
import type { BetterCalendarsSettings } from "../settings";
import { ensureFolder, joinPath } from "../util/vault";
import {
	cleanFileName,
	FsqPlace,
	LatLng,
	PlaceNoteInfo,
	addMissing,
	asList,
	formatLatLng,
	googleMapsUrl,
	linkKey,
	matchPlaceNote,
	mergeTags,
	parseLatLng,
	placeNoteName,
} from "./logic";

/** Frontmatter key holding the Foursquare place id. */
export const FM_FSQ = "fsq";
const ADDRESS = "Address";
const PROJECTS = "Projects";
const LINK = "Link";
const VISITS = "Visits";

function folderOf(settings: BetterCalendarsSettings): string {
	return normalizePath(settings.placesFolder.trim() || "/").replace(/^\/$/, "");
}

function inFolder(file: TFile, folder: string): boolean {
	return !folder || file.path.startsWith(`${folder}/`);
}

/**
 * Every note in the places folder, plus notes elsewhere that look like
 * places (they have an fsq or coordinates property).
 */
export function listPlaceNotes(app: App, settings: BetterCalendarsSettings): PlaceNoteInfo[] {
	const folder = folderOf(settings);
	const geo = settings.geolinkProperty.trim() || "Geolink";
	const out: PlaceNoteInfo[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const location = parseLatLng(fm[geo]);
		const fsq = asList(fm[FM_FSQ]);
		if (!inFolder(file, folder) && !location && fsq.length === 0) continue;
		// What we just wrote counts even before Obsidian has re-read the note.
		const recent = recentWrites.get(file.path);
		out.push({
			path: file.path,
			basename: file.basename,
			fsq: recent ? [...new Set([...fsq, ...recent.fsq])] : fsq,
			location: location ?? recent?.location ?? null,
			address: asList(fm[ADDRESS]).join(", ") || recent?.address || "",
			visits: asList(fm[VISITS]).length,
		});
	}
	return out;
}

/** Values already used in a property anywhere in the vault, most used first (for suggestions). */
export function propertyValues(app: App, property: string): string[] {
	const counts = new Map<string, { value: string; n: number }>();
	for (const file of app.vault.getMarkdownFiles()) {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm) continue;
		for (const v of asList(fm[property])) {
			const k = v.trim().toLowerCase();
			const hit = counts.get(k);
			if (hit) hit.n++;
			else counts.set(k, { value: v.trim(), n: 1 });
		}
	}
	return [...counts.values()].sort((a, b) => b.n - a.n).map((c) => c.value);
}

/**
 * Notes created in this session, by Foursquare id. Obsidian reads a new
 * note's properties a moment after it's written, so without this a second
 * visit right after the first (e.g. "apply to all visits") wouldn't find
 * the note and would create a duplicate.
 */
const justCreated = new Map<string, string>();

/**
 * The ids, coordinates and address the plugin last wrote to a note, by
 * path. Used by listPlaceNotes until Obsidian has re-read the note, so a
 * note adopted a moment ago doesn't look blank and get adopted by another
 * place with the same name.
 */
const recentWrites = new Map<string, { fsq: string[]; location: LatLng | null; address: string }>();

function remember(path: string, fm: Record<string, unknown>, settings: BetterCalendarsSettings): void {
	recentWrites.set(path, {
		fsq: asList(fm[FM_FSQ]),
		location: parseLatLng(fm[settings.geolinkProperty.trim() || "Geolink"]),
		address: asList(fm[ADDRESS]).join(", "),
	});
}

export interface CheckinWrite {
	place: FsqPlace;
	/** Tags to add (existing tags are kept). */
	tags: string[];
	/** Projects values to add. */
	projects: string[];
	/** The new Visits entry. */
	visit: string;
	/** File name for a new note, as edited by the owner (cleaned before use). */
	noteName?: string;
	/** A note the owner picked to link this place to (instead of the matching one). */
	target?: TFile | null;
	/** Rating chosen at check-in or review; written only when not empty. */
	rating?: string;
}

/** Frontmatter key for the owner's own rating of a place (e.g. 🩷). */
export const RATING = "Rating";

/** The name a new note for this place would get. */
export function suggestedNoteName(app: App, settings: BetterCalendarsSettings, place: FsqPlace): string {
	const folder = folderOf(settings);
	return placeNoteName(place, (name) => app.vault.getFileByPath(joinPath(folder, `${name}.md`)) !== null);
}

/**
 * Record a visit in the place's note: create it, or update the matching (or
 * adopted) note. Existing values are kept; only empty properties are
 * filled, lists only grow. Returns the note.
 */
export async function recordVisit(
	app: App,
	settings: BetterCalendarsSettings,
	w: CheckinWrite
): Promise<TFile> {
	const recent = justCreated.get(w.place.id);
	const recentFile = w.target ?? (recent ? app.vault.getFileByPath(recent) : null);
	const match = recentFile ? null : matchPlaceNote(w.place, listPlaceNotes(app, settings));
	const existing = recentFile ?? (match ? app.vault.getFileByPath(match.path) : null);
	if (existing) {
		await app.fileManager.processFrontMatter(existing, (fm: Record<string, unknown>) => {
			applyVisit(fm, settings, w);
			remember(existing.path, fm, settings);
		});
		return existing;
	}

	const folder = folderOf(settings);
	const taken = (name: string) => app.vault.getFileByPath(joinPath(folder, `${name}.md`)) !== null;
	const wanted = cleanFileName(w.noteName ?? "");
	// The owner's own name, unless another note already has it (then the street is added, as usual).
	const name = wanted && !taken(wanted) ? wanted : placeNoteName({ ...w.place, name: wanted || w.place.name }, taken);
	const fm: Record<string, unknown> = {};
	applyVisit(fm, settings, w);
	if (folder) await ensureFolder(app, folder);
	// Written in one go (not empty first), so Templater's new-file trigger has nothing to fill in.
	const file = await app.vault.create(joinPath(folder, `${name}.md`), `---\n${stringifyYaml(fm)}---\n`);
	justCreated.set(w.place.id, file.path);
	remember(file.path, fm, settings);
	return file;
}

function applyVisit(fm: Record<string, unknown>, settings: BetterCalendarsSettings, w: CheckinWrite): void {
	const { place } = w;
	const empty = (k: string) => asList(fm[k]).length === 0;
	fm.tags = mergeTags(fm.tags, w.tags);
	if (empty(ADDRESS) && place.address) fm[ADDRESS] = place.address;
	const geo = settings.geolinkProperty.trim();
	if (geo && empty(geo)) fm[geo] = formatLatLng(place);
	fm[PROJECTS] = addMissing(asList(fm[PROJECTS]), w.projects, linkKey);
	let links = asList(fm[LINK]);
	if (place.website) links = addMissing(links, [place.website], normalizeUrl);
	if (!links.some((l) => /google\.[a-z.]+\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl/i.test(l))) {
		links.push(googleMapsUrl(place));
	}
	fm[LINK] = links;
	const rating = (w.rating ?? "").trim();
	if (rating) fm[RATING] = /^\d+(\.\d+)?$/.test(rating) ? Number(rating) : rating;
	// The same visit (same date and time) is never recorded twice.
	const visits = asList(fm[VISITS]);
	const stamp = w.visit.slice(0, 16);
	fm[VISITS] = visits.some((v) => v.slice(0, 16) === stamp) ? visits : [...visits, w.visit];
	// One place can have several Foursquare ids (Swarm's old one, the Places API's).
	const ids = asList(fm[FM_FSQ]);
	if (!ids.includes(place.id)) ids.push(place.id);
	fm[FM_FSQ] = ids.length === 1 ? ids[0] : ids;
}

function normalizeUrl(u: string): string {
	return u.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
}

/** Add the place to the daily note's Places list (once per day). */
export async function addPlaceToDailyNote(
	app: App,
	settings: BetterCalendarsSettings,
	daily: TFile,
	/** The place note, or just the place's name when it has no note. */
	placeNote: TFile | string,
	/** Write the name as plain text instead of a link (by choice). */
	asText = false
): Promise<boolean> {
	const prop = settings.dailyPlacesProperty.trim() || "Places";
	const link = asText
		? typeof placeNote === "string"
			? placeNote
			: placeNote.basename
		: typeof placeNote === "string"
			? `[[${placeNote}]]`
			: `[[${app.metadataCache.fileToLinktext(placeNote, daily.path, true)}]]`;
	const basename = typeof placeNote === "string" ? placeNote : placeNote.basename;
	let added = false;
	await app.fileManager.processFrontMatter(daily, (fm: Record<string, unknown>) => {
		const list = asList(fm[prop]);
		const keys = new Set(list.map(linkKey));
		if (keys.has(linkKey(link)) || keys.has(basename.toLowerCase())) return;
		fm[prop] = [...list, link];
		added = true;
	});
	return added;
}
