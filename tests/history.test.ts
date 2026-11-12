import { describe, expect, it } from "vitest";
import {
	SwarmCheckin,
	fromRaw,
	localDate,
	localStamp,
	mergeHistory,
	pendingCheckins,
	reviewTotal,
	visitsHere,
} from "../src/checkins/history-logic";

const raw = {
	id: "59b97e6cf79faa0d5e23abeb",
	createdAt: 1505328748, // 2017-09-13 18:52:28 UTC
	type: "checkin",
	shout: " Monday monday! ",
	timeZoneOffset: -240,
	venue: {
		id: "4f0de7267bebfc146005dcc0",
		name: "Prince Tea House",
		location: {
			address: "15 Station Square",
			lat: 40.7222,
			lng: -73.8439,
			formattedAddress: ["15 Station Square", "Forest Hills, NY 11375", "United States"],
		},
		categories: [
			{ id: "cat-cafe", name: "Café" },
			{ id: "cat-tea", name: "Tea Room", primary: true },
		],
	},
};

const c = (id: string, at: number, venueId = "v1"): SwarmCheckin => ({
	id,
	at,
	tz: 0,
	shout: "",
	place: { id: venueId, name: "P", lat: 0, lng: 0, street: "", address: "", categories: [], website: "", distance: null },
});

describe("fromRaw", () => {
	it("turns a Swarm check-in into a place and local time", () => {
		const r = fromRaw(raw)!;
		expect(r.id).toBe("59b97e6cf79faa0d5e23abeb");
		expect(r.shout).toBe("Monday monday!");
		expect(r.place?.id).toBe("4f0de7267bebfc146005dcc0");
		expect(r.place?.address).toBe("15 Station Square, Forest Hills, NY 11375, United States");
		expect(r.place?.categories[0]?.name).toBe("Tea Room");
		// 18:52 UTC at UTC-4 is 14:52 local.
		expect(localStamp(r)).toBe("2017-09-13 14:52");
		expect(localDate(r)).toBe("2017-09-13");
	});

	it("uses the place's local day, not UTC's", () => {
		// 2017-09-14 02:30 UTC at UTC-4 is still the 13th locally.
		expect(localDate(fromRaw({ ...raw, createdAt: 1505356200 })!)).toBe("2017-09-13");
	});

	it("keeps check-ins whose venue is gone, without a place", () => {
		expect(fromRaw({ ...raw, venue: undefined })!.place).toBeNull();
		expect(fromRaw({ ...raw, id: undefined })).toBeNull();
		expect(fromRaw({ ...raw, type: "shout" })).toBeNull();
	});
});

describe("the review queue", () => {
	const history = mergeHistory([c("a", 1000), c("b", 3000)], [c("c", 2000), c("b", 3000)]);

	it("merges without duplicates, newest first", () => {
		expect(history.map((x) => x.id)).toEqual(["b", "c", "a"]);
	});

	it("leaves out reviewed check-ins and those made from Obsidian", () => {
		expect(pendingCheckins(history, ["c"], ["b"]).map((x) => x.id)).toEqual(["a"]);
		expect(reviewTotal(history, ["b"])).toBe(2);
	});

	it("leaves out every visit to a skipped place", () => {
		const h = [c("1", 3, "x"), c("2", 2, "y"), c("3", 1, "x")];
		expect(pendingCheckins(h, [], [], ["x"]).map((x) => x.id)).toEqual(["2"]);
	});

	it("finds the other visits to the same place", () => {
		const h = [c("1", 3, "x"), c("2", 2, "y"), c("3", 1, "x")];
		expect(visitsHere(h, "x").map((x) => x.id)).toEqual(["1", "3"]);
	});
});
