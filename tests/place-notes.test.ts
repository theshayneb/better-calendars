import { describe, expect, it } from "vitest";
import { TFile, TFolder } from "obsidian";
import { DEFAULT_SETTINGS } from "../src/settings";
import { addPlaceToDailyNote, recordVisit } from "../src/checkins/place-notes";
import type { FsqPlace } from "../src/checkins/logic";

function fakeApp(notes: Record<string, Record<string, unknown>>) {
	const files = new Map<string, TFile>();
	const created: Record<string, string> = {};
	const add = (path: string) => {
		const f = Object.assign(new TFile(), {
			path,
			basename: path.split("/").pop()!.replace(/\.md$/, ""),
		});
		files.set(path, f);
		return f;
	};
	for (const p of Object.keys(notes)) add(p);
	const app = {
		vault: {
			getMarkdownFiles: () => [...files.values()],
			getFileByPath: (p: string) => files.get(p) ?? null,
			getAbstractFileByPath: (p: string) => files.get(p) ?? (p === "Travel" ? new TFolder() : null),
			create: async (p: string, body: string) => {
				created[p] = body;
				return add(p);
			},
			createFolder: async () => {},
		},
		metadataCache: {
			getFileCache: (f: TFile) => (notes[f.path] ? { frontmatter: notes[f.path] } : null),
			fileToLinktext: (f: TFile) => f.basename,
		},
		fileManager: {
			processFrontMatter: async (f: TFile, fn: (fm: Record<string, unknown>) => void) => {
				notes[f.path] ??= {};
				fn(notes[f.path]!);
			},
		},
	};
	return { app: app as never, notes, created };
}

const settings = { ...DEFAULT_SETTINGS, placesFolder: "Travel" };

const prince: FsqPlace = {
	id: "4b8f9c2af964a520a6f533e3",
	name: "Prince Tea House",
	lat: 40.72218,
	lng: -73.84395,
	street: "15 Station Square",
	address: "15 Station Square, Forest Hills, NY 11375",
	categories: [{ id: "cat-tea", name: "Tea Room" }],
	website: "http://princeteahouseorders.com/",
	distance: null,
};

describe("recordVisit", () => {
	it("adopts an existing note: keeps its values, fills only what's missing, appends the visit", async () => {
		const { app, notes } = fakeApp({
			"Travel/Prince Tea House.md": {
				Address: "15 Station Square; Forest Hills, NY 11375",
				Geolink: "40.72217743090846, -73.84394712231544",
				Projects: ["Forest Hills"],
				Link: ["http://princeteahouseorders.com/"],
				Rating: "🩷",
				tags: ["place", "food"],
			},
		});
		const file = await recordVisit(app, settings, {
			place: prince,
			tags: ["place", "tea", "food"],
			projects: [],
			visit: "2026-11-11 12:40 · first time back",
		});
		expect(file.path).toBe("Travel/Prince Tea House.md");
		expect(notes["Travel/Prince Tea House.md"]).toEqual({
			Address: "15 Station Square; Forest Hills, NY 11375",
			Geolink: "40.72217743090846, -73.84394712231544",
			Projects: ["Forest Hills"],
			Link: [
				"http://princeteahouseorders.com/",
				"https://www.google.com/maps/search/?api=1&query=Prince%20Tea%20House%2C%2015%20Station%20Square%2C%20Forest%20Hills%2C%20NY%2011375",
			],
			Rating: "🩷",
			tags: ["place", "food", "tea"],
			Visits: ["2026-11-11 12:40 · first time back"],
			fsq: "4b8f9c2af964a520a6f533e3",
		});
	});

	it("creates a new note, with the street when the name belongs to another place", async () => {
		const { app, created } = fakeApp({
			"Travel/Starbucks.md": { fsq: "someone-else", Geolink: "40.0, -73.0" },
		});
		const file = await recordVisit(app, settings, {
			place: { ...prince, id: "sb2", name: "Starbucks", street: "71-22 Austin St", website: "" },
			tags: ["place", "food"],
			projects: ["Forest Hills"],
			visit: "2026-11-11 08:05",
		});
		expect(file.path).toBe("Travel/Starbucks (Austin St).md");
		const body = created["Travel/Starbucks (Austin St).md"]!;
		expect(body.startsWith("---\ntags: [\"place\",\"food\"]\nAddress:")).toBe(true);
		expect(body).toContain('Geolink: "40.72218, -73.84395"');
		expect(body).toContain('Projects: ["Forest Hills"]');
		expect(body).toContain('Visits: ["2026-11-11 08:05"]');
		expect(body).toContain('fsq: "sb2"');
	});

	it("appends a second visit to the same note", async () => {
		const { app, notes } = fakeApp({ "Travel/Prince Tea House.md": { fsq: prince.id, Visits: ["2026-11-01 10:00"] } });
		await recordVisit(app, settings, { place: prince, tags: [], projects: [], visit: "2026-11-11 12:40" });
		expect(notes["Travel/Prince Tea House.md"]!.Visits).toEqual(["2026-11-01 10:00", "2026-11-11 12:40"]);
	});
});

describe("recordVisit with different Foursquare ids", () => {
	it("uses the existing note and keeps both ids", async () => {
		const { app, notes, created } = fakeApp({
			"Travel/Prince Tea House.md": {
				Geolink: "40.72217743090846, -73.84394712231544",
				fsq: "places-api-id",
				Visits: ["2026-11-11 12:40"],
			},
		});
		const file = await recordVisit(app, settings, {
			place: { ...prince, id: "old-swarm-id" },
			tags: [],
			projects: [],
			visit: "2017-09-13 14:52",
		});
		expect(file.path).toBe("Travel/Prince Tea House.md");
		expect(Object.keys(created)).toEqual([]);
		expect(notes["Travel/Prince Tea House.md"]!.fsq).toEqual(["places-api-id", "old-swarm-id"]);
		expect(notes["Travel/Prince Tea House.md"]!.Visits).toEqual(["2026-11-11 12:40", "2017-09-13 14:52"]);
	});

	it("finds place notes outside the places folder by their coordinates", async () => {
		const { app, created } = fakeApp({
			"Somewhere/Prince Tea House.md": { Geolink: "40.72217743090846, -73.84394712231544" },
		});
		const file = await recordVisit(app, settings, { place: prince, tags: [], projects: [], visit: "2017-09-13 14:52" });
		expect(file.path).toBe("Somewhere/Prince Tea House.md");
		expect(Object.keys(created)).toEqual([]);
	});
});

describe("recordVisit with your own note name", () => {
	it("uses the edited name, cleaned", async () => {
		const { app, created } = fakeApp({});
		const file = await recordVisit(app, settings, {
			place: prince,
			tags: [],
			projects: [],
			visit: "2026-11-11 12:40",
			noteName: "Prince Tea: Forest Hills?",
		});
		expect(file.path).toBe("Travel/Prince Tea Forest Hills.md");
		expect(Object.keys(created)).toEqual(["Travel/Prince Tea Forest Hills.md"]);
	});

	it("adds the street when the edited name belongs to another note", async () => {
		const { app } = fakeApp({ "Travel/Tea.md": { fsq: "other", Geolink: "10, 10" } });
		const file = await recordVisit(app, settings, {
			place: { ...prince, id: "new-id" },
			tags: [],
			projects: [],
			visit: "2026-11-11 12:40",
			noteName: "Tea",
		});
		expect(file.path).toBe("Travel/Tea (Station Square).md");
	});
});

describe("chains", () => {
	const chilis = (id: string, lat: number, lng: number, street: string, address: string) => ({
		...prince,
		id,
		name: "Chili's",
		lat,
		lng,
		street,
		address,
		website: "",
	});
	const queens = chilis("chilis-queens", 40.7108, -73.8659, "80-40 Cooper Ave", "80-40 Cooper Ave, Glendale, NY 11385");
	const reno = chilis("chilis-reno", 39.4708, -119.7866, "5980 S Virginia St", "5980 S Virginia St, Reno, NV 89502");

	it("gives each location its own note, even right after adopting one", async () => {
		// An existing note for the Queens Chili's, written by hand: name and address only.
		const { app, notes, created } = fakeApp({
			"Travel/Chili's.md": { Address: "80-40 Cooper Ave, Glendale, NY 11385" },
		});
		const first = await recordVisit(app, settings, { place: queens, tags: [], projects: [], visit: "2019-01-01 12:00" });
		expect(first.path).toBe("Travel/Chili's.md");
		// The fake metadata cache shows the note as it was (no fsq, no Geolink), like Obsidian
		// right after a write. Reno must still not land in it.
		notes["Travel/Chili's.md"] = { Address: "80-40 Cooper Ave, Glendale, NY 11385" };
		const second = await recordVisit(app, settings, { place: reno, tags: [], projects: [], visit: "2019-06-01 18:00" });
		expect(second.path).toBe("Travel/Chili's (S Virginia St).md");
		expect(Object.keys(created)).toEqual(["Travel/Chili's (S Virginia St).md"]);
	});
});

describe("recordVisit for past check-ins", () => {
	it("doesn't record the same visit twice", async () => {
		const { app, notes } = fakeApp({ "Travel/Prince Tea House.md": { fsq: prince.id, Visits: ["2017-09-13 14:52 · tea"] } });
		await recordVisit(app, settings, { place: prince, tags: [], projects: [], visit: "2017-09-13 14:52 · tea" });
		expect(notes["Travel/Prince Tea House.md"]!.Visits).toEqual(["2017-09-13 14:52 · tea"]);
	});

	it("finds a note it just created, before Obsidian has read it", async () => {
		const { app, created } = fakeApp({});
		const place = { ...prince, id: "fresh-1", name: "Brand New Cafe" };
		const first = await recordVisit(app, settings, { place, tags: [], projects: [], visit: "2017-01-01 10:00" });
		// The fake metadata cache doesn't know the new note, like Obsidian right after a write.
		const second = await recordVisit(app, settings, { place, tags: [], projects: [], visit: "2017-02-01 10:00" });
		expect(second.path).toBe(first.path);
		expect(Object.keys(created)).toEqual(["Travel/Brand New Cafe.md"]);
	});
});

describe("addPlaceToDailyNote", () => {
	it("adds the place once per day, creating the Places property when needed", async () => {
		const { app, notes } = fakeApp({ "Daily/2026-11-11.md": {}, "Travel/Prince Tea House.md": {} });
		const files = (app as { vault: { getFileByPath(p: string): TFile } }).vault;
		const daily = files.getFileByPath("Daily/2026-11-11.md");
		const placeNote = files.getFileByPath("Travel/Prince Tea House.md");
		expect(await addPlaceToDailyNote(app, settings, daily, placeNote)).toBe(true);
		expect(await addPlaceToDailyNote(app, settings, daily, placeNote)).toBe(false);
		expect(notes["Daily/2026-11-11.md"]).toEqual({ Places: ["[[Prince Tea House]]"] });
	});

	it("writes the plain name when asked", async () => {
		const { app, notes } = fakeApp({ "Daily/2017-09-13.md": { Places: ["Riverside Park"] } });
		const daily = (app as { vault: { getFileByPath(p: string): TFile } }).vault.getFileByPath("Daily/2017-09-13.md");
		expect(await addPlaceToDailyNote(app, settings, daily, "Prince Tea House", true)).toBe(true);
		expect(await addPlaceToDailyNote(app, settings, daily, "Prince Tea House")).toBe(false);
		expect(notes["Daily/2017-09-13.md"]).toEqual({ Places: ["Riverside Park", "Prince Tea House"] });
	});

	it("links by name when the place has no note", async () => {
		const { app, notes } = fakeApp({ "Daily/2017-09-13.md": { Places: ["[[Riverside Park]]"] } });
		const daily = (app as { vault: { getFileByPath(p: string): TFile } }).vault.getFileByPath("Daily/2017-09-13.md");
		expect(await addPlaceToDailyNote(app, settings, daily, "Prince Tea House")).toBe(true);
		expect(notes["Daily/2017-09-13.md"]).toEqual({ Places: ["[[Riverside Park]]", "[[Prince Tea House]]"] });
	});
});
