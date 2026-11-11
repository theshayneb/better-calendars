import { App, TFile, normalizePath, stringifyYaml } from "obsidian";
import type { BetterCalendarsSettings } from "../settings";
import { ensureFolder, joinPath } from "../util/vault";
import {
	FsqPlace,
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

/** Every note in the places folder, with what we need to recognise places. */
export function listPlaceNotes(app: App, settings: BetterCalendarsSettings): PlaceNoteInfo[] {
	const folder = folderOf(settings);
	const out: PlaceNoteInfo[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		if (!inFolder(file, folder)) continue;
		const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const fsq: unknown = fm[FM_FSQ];
		out.push({
			path: file.path,
			basename: file.basename,
			fsq: typeof fsq === "string" ? fsq : "",
			location: parseLatLng(fm[settings.geolinkProperty]),
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

export interface CheckinWrite {
	place: FsqPlace;
	/** Tags to add (existing tags are kept). */
	tags: string[];
	/** Projects values to add. */
	projects: string[];
	/** The new Visits entry. */
	visit: string;
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
	const recentFile = recent ? app.vault.getFileByPath(recent) : null;
	const match = recentFile ? null : matchPlaceNote(w.place, listPlaceNotes(app, settings));
	const existing = recentFile ?? (match ? app.vault.getFileByPath(match.path) : null);
	if (existing) {
		await app.fileManager.processFrontMatter(existing, (fm: Record<string, unknown>) => {
			applyVisit(fm, settings, w);
		});
		return existing;
	}

	const folder = folderOf(settings);
	const taken = (name: string) => app.vault.getFileByPath(joinPath(folder, `${name}.md`)) !== null;
	const name = placeNoteName(w.place, taken);
	const fm: Record<string, unknown> = {};
	applyVisit(fm, settings, w);
	if (folder) await ensureFolder(app, folder);
	// Written in one go (not empty first), so Templater's new-file trigger has nothing to fill in.
	const file = await app.vault.create(joinPath(folder, `${name}.md`), `---\n${stringifyYaml(fm)}---\n`);
	justCreated.set(w.place.id, file.path);
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
	// The same visit (same date and time) is never recorded twice.
	const visits = asList(fm[VISITS]);
	const stamp = w.visit.slice(0, 16);
	fm[VISITS] = visits.some((v) => v.slice(0, 16) === stamp) ? visits : [...visits, w.visit];
	if (typeof fm[FM_FSQ] !== "string" || !fm[FM_FSQ]) fm[FM_FSQ] = place.id;
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
	placeNote: TFile | string
): Promise<boolean> {
	const prop = settings.dailyPlacesProperty.trim() || "Places";
	const link =
		typeof placeNote === "string"
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
