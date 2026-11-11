import { describe, expect, it } from "vitest";
import {
	FsqPlace,
	PlaceNoteInfo,
	addMissing,
	cleanFileName,
	checkinTags,
	distanceMetres,
	googleMapsUrl,
	guessTag,
	linkKey,
	matchPlaceNote,
	mergeTags,
	parseLatLng,
	placeNoteName,
	streetName,
	swarmShout,
	visitEntry,
} from "../src/checkins/logic";

const place = (over: Partial<FsqPlace> = {}): FsqPlace => ({
	id: "4b8f9c2af964a520a6f533e3",
	name: "Prince Tea House",
	lat: 40.72218,
	lng: -73.84395,
	street: "15 Station Square",
	address: "15 Station Square, Forest Hills, NY 11375",
	categories: [{ id: "cat-tea", name: "Tea Room" }],
	website: "http://princeteahouseorders.com/",
	distance: 40,
	...over,
});

const note = (over: Partial<PlaceNoteInfo> = {}): PlaceNoteInfo => ({
	path: "Travel/Prince Tea House.md",
	basename: "Prince Tea House",
	fsq: [],
	location: { lat: 40.72217743090846, lng: -73.84394712231544 },
	address: "15 Station Square; Forest Hills, NY 11375",
	visits: 0,
	...over,
});

describe("coordinates", () => {
	it("parses Geolink values", () => {
		expect(parseLatLng("40.72217743090846, -73.84394712231544")).toEqual({
			lat: 40.72217743090846,
			lng: -73.84394712231544,
		});
		expect(parseLatLng(["40.7", "-73.8"])).toEqual({ lat: 40.7, lng: -73.8 });
		expect(parseLatLng("somewhere")).toBeNull();
		expect(parseLatLng("140, 20")).toBeNull();
	});

	it("measures distance in metres", () => {
		const d = distanceMetres({ lat: 40.7222, lng: -73.8439 }, { lat: 40.7231, lng: -73.8439 });
		expect(d).toBeGreaterThan(95);
		expect(d).toBeLessThan(105);
	});
});

describe("matchPlaceNote", () => {
	it("finds a note by its Foursquare id first", () => {
		const n = note({ basename: "Something else", fsq: ["old-id", "4b8f9c2af964a520a6f533e3"] });
		expect(matchPlaceNote(place(), [note(), n])).toBe(n);
	});

	it("adopts an existing note with the same name nearby and no id", () => {
		const existing = note();
		expect(matchPlaceNote(place(), [existing])).toBe(existing);
		expect(matchPlaceNote(place({ name: "PRINCE TEA HOUSE!" }), [existing])).toBe(existing);
	});

	it("matches a same-name note nearby even when it has another Foursquare id", () => {
		// Swarm's old venue ids and the Places API's can differ for the same place.
		const n = note({ fsq: ["places-api-id"] });
		expect(matchPlaceNote(place(), [n])).toBe(n);
	});

	it("doesn't adopt a same-name note far away", () => {
		expect(matchPlaceNote(place(), [note({ location: { lat: 40.8, lng: -73.9 } })])).toBeNull();
		expect(matchPlaceNote(place(), [note({ location: null, fsq: ["other-id"] })])).toBeNull();
	});

	it("adopts a same-name note without coordinates only when its address matches", () => {
		const n = note({ location: null });
		expect(matchPlaceNote(place(), [n])).toBe(n);
		expect(matchPlaceNote(place(), [n, note({ path: "b.md", location: null })])).toBeNull();
		expect(matchPlaceNote(place(), [note({ location: null, address: "" })])).toBeNull();
		expect(matchPlaceNote(place(), [note({ location: null, address: "1 Main St, Reno, NV 89501" })])).toBeNull();
	});

	it("keeps chain locations apart (Chili's in Queens is not Chili's in Reno)", () => {
		const queens = place({
			id: "chilis-queens",
			name: "Chili's",
			lat: 40.7108,
			lng: -73.8659,
			street: "80-40 Cooper Ave",
			address: "80-40 Cooper Ave, Glendale, NY 11385",
		});
		const reno = place({
			id: "chilis-reno",
			name: "Chili's",
			lat: 39.4708,
			lng: -119.7866,
			street: "5980 S Virginia St",
			address: "5980 S Virginia St, Reno, NV 89502",
		});
		const queensNote = note({
			path: "Travel/Chili's.md",
			basename: "Chili's",
			fsq: ["chilis-queens"],
			location: { lat: 40.7108, lng: -73.8659 },
			address: "80-40 Cooper Ave, Glendale, NY 11385",
		});
		expect(matchPlaceNote(queens, [queensNote])).toBe(queensNote);
		expect(matchPlaceNote(reno, [queensNote])).toBeNull();
		// A bare "Chili's" note (no coordinates, id or address) is nobody's.
		const bare = note({ path: "Travel/Chili's.md", basename: "Chili's", location: null, address: "" });
		expect(matchPlaceNote(queens, [bare])).toBeNull();
		expect(matchPlaceNote(reno, [bare])).toBeNull();
	});
});

describe("placeNoteName", () => {
	it("uses the name, then adds the street when the name is taken", () => {
		expect(placeNoteName(place({ name: "Starbucks", street: "71-22 Austin St" }), () => false)).toBe("Starbucks");
		expect(
			placeNoteName(place({ name: "Starbucks", street: "71-22 Austin St" }), (n) => n === "Starbucks")
		).toBe("Starbucks (Austin St)");
	});

	it("removes characters not allowed in file names", () => {
		expect(placeNoteName(place({ name: "Joe's: Pizza / Bar" }), () => false)).toBe("Joe's Pizza Bar");
	});

	it("makes names safe for Windows and Obsidian", () => {
		expect(cleanFileName('Café "Le Bon" <Paris>?')).toBe("Café Le Bon Paris");
		expect(cleanFileName("...hidden name. ")).toBe("hidden name");
		expect(cleanFileName("CON")).toBe("CON place");
		expect(cleanFileName("Tab\there")).toBe("Tab here");
	});

	it("gets the street without the house number", () => {
		expect(streetName("71-22 Austin St")).toBe("Austin St");
		expect(streetName("15 Station Square, Forest Hills")).toBe("Station Square");
		expect(streetName("Main St")).toBe("Main St");
	});
});

describe("tags", () => {
	it("adds the always-tags and the tags a chosen tag brings along", () => {
		expect(checkinTags(["place"], ["pizza"], { pizza: ["food"], tea: ["food"] })).toEqual([
			"place",
			"pizza",
			"food",
		]);
		expect(checkinTags(["place"], ["tea", "pizza"], { pizza: ["food"], tea: ["food"] })).toEqual([
			"place",
			"tea",
			"pizza",
			"food",
		]);
	});

	it("keeps existing tags and adds new ones without duplicates", () => {
		expect(mergeTags(["place", "food"], ["place", "food", "tea"])).toEqual(["place", "food", "tea"]);
		expect(mergeTags("place", ["#Tea"])).toEqual(["place", "Tea"]);
		expect(mergeTags(undefined, ["outdoors"])).toEqual(["outdoors"]);
	});

	it("suggests a tag from the category name", () => {
		const tags = ["dessert", "pizza", "tea", "food", "shopping", "sight", "museum", "activity", "outdoors"];
		expect(guessTag("Pizzeria", tags)).toBe("pizza");
		expect(guessTag("Bubble Tea Shop", tags)).toBe("tea");
		expect(guessTag("Ice Cream Parlor", tags)).toBe("dessert");
		expect(guessTag("History Museum", tags)).toBe("museum");
		expect(guessTag("Park", tags)).toBe("outdoors");
		expect(guessTag("Gas Station", tags)).toBeNull();
	});
});

describe("lists and links", () => {
	it("adds missing items only", () => {
		expect(addMissing(["Forest Hills"], ["forest hills", "[[Fort Greene]]"])).toEqual([
			"Forest Hills",
			"[[Fort Greene]]",
		]);
	});

	it("compares links and names alike", () => {
		expect(linkKey("[[Travel/Prince Tea House|Prince]]")).toBe("prince tea house");
		expect(linkKey("Prince Tea House")).toBe("prince tea house");
	});
});

describe("visits and Swarm", () => {
	it("writes the visit with the note on one line", () => {
		expect(visitEntry("2026-11-11 12:40", "")).toBe("2026-11-11 12:40");
		expect(visitEntry("2026-11-11 12:40", " with Sam\nafter the game ")).toBe(
			"2026-11-11 12:40 · with Sam after the game"
		);
	});

	it("keeps shouts within 140 characters", () => {
		expect(swarmShout("x".repeat(200))).toHaveLength(140);
		expect(swarmShout("hi")).toBe("hi");
	});

	it("links to Google Maps by name and address", () => {
		expect(googleMapsUrl(place())).toBe(
			"https://www.google.com/maps/search/?api=1&query=Prince%20Tea%20House%2C%2015%20Station%20Square%2C%20Forest%20Hills%2C%20NY%2011375"
		);
	});
});
