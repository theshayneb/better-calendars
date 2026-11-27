import { describe, expect, it } from "vitest";
import { normalizeSettings } from "../src/settings";
import {
	Data,
	META_KEY,
	TOMBSTONE_TTL_MS,
	clone,
	mergeData,
	metaOf,
	sameData,
	syncStep,
} from "../src/sync/merge";
import { SETTLE_AFTER_START_MS, SETTLE_QUIET_MS, isSettled } from "../src/sync/settle";
import { backgroundOn } from "../src/sync/background";
import { importAction } from "../src/events/import-logic";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 18, 12);

/**
 * A device as the plugin runs it: settings in memory, a baseline (last
 * synced copy), and the read-merge-write step of main.ts against a shared
 * data.json. Obsidian Sync is modelled as the worst case: whatever file
 * arrives replaces the other device's file whole.
 */
class Device {
	memory: Data;
	baseline: Data;
	writes = 0;
	constructor(public file: { data: Data | null }) {
		this.memory = normalizeSettings(file.data ?? {}) as unknown as Data;
		this.baseline = clone(this.memory);
	}
	get s() {
		return this.memory as unknown as ReturnType<typeof normalizeSettings>;
	}
	/** saveSettings() / onExternalSettingsChange(). */
	sync(now: number): boolean {
		const disk = normalizeSettings(this.file.data ?? {}) as unknown as Data;
		const { write, merged, memoryChanged } = syncStep(this.memory, this.baseline, disk, now);
		if (write) {
			this.file.data = clone(write);
			this.writes++;
		}
		this.memory = clone(merged);
		this.baseline = clone(merged);
		return memoryChanged;
	}
}

/** Two devices with their own data.json; `deliver` copies one file over the other (Sync). */
function pair(initial: Data = {}) {
	const a = { data: clone(initial) as Data | null };
	const b = { data: clone(initial) as Data | null };
	return {
		desktop: new Device(a),
		phone: new Device(b),
		toPhone: () => (b.data = clone(a.data)),
		toDesktop: () => (a.data = clone(b.data)),
	};
}

describe("settings merge between devices", () => {
	it("nothing is written on load or when nothing changed", () => {
		const { desktop } = pair({ autoImport: true, imported: { e1: 1 } });
		expect(desktop.sync(T0)).toBe(false);
		expect(desktop.writes).toBe(0);
	});

	it("a phone's stale copy of a setting it never touched doesn't win", () => {
		const { desktop, phone, toDesktop } = pair();
		desktop.s.eventFolder = "Meetings";
		desktop.sync(T0);
		// The phone, offline, changes something else 8 hours later and its file arrives.
		phone.s.importDaysAhead = 14;
		phone.sync(T0 + 8 * HOUR);
		toDesktop();
		desktop.sync(T0 + 8 * HOUR + 1);
		expect(desktop.s.eventFolder).toBe("Meetings");
		expect(desktop.s.importDaysAhead).toBe(14);
	});

	it("a phone's stale import records don't drop entries the desktop added", () => {
		const { desktop, phone, toDesktop } = pair({ imported: { old: 1 } });
		desktop.s.imported.e1 = 100;
		desktop.s.noteNames.e1 = { name: "2026-11-18 Lunch", title: "Lunch" };
		desktop.sync(T0);
		phone.s.swarmReviewed.push("c1");
		phone.sync(T0 + HOUR);
		toDesktop();
		desktop.sync(T0 + HOUR + 1);
		expect(desktop.s.imported).toEqual({ old: 1, e1: 100 });
		expect(desktop.s.noteNames.e1?.name).toBe("2026-11-18 Lunch");
		expect(desktop.s.swarmReviewed).toEqual(["c1"]);
	});

	it("an old noteNames record from a stale device doesn't replace a newer rename", () => {
		const start = { noteNames: { e1: { name: "2026-11-18 A", title: "A" } }, imported: { e1: 1 } };
		const { desktop, phone, toDesktop } = pair(start);
		desktop.s.noteNames.e1 = { name: "2026-11-18 B", title: "B" };
		desktop.sync(T0);
		// The phone saves its (old) copy for another reason.
		phone.s.weekStart = "monday";
		phone.sync(T0 + 2 * HOUR);
		toDesktop();
		desktop.sync(T0 + 2 * HOUR + 1);
		expect(desktop.s.noteNames.e1).toEqual({ name: "2026-11-18 B", title: "B" });
		expect(desktop.s.weekStart).toBe("monday");
	});

	it("removals are kept as tombstones and beat stale copies", () => {
		const start = { swarmSkippedPlaces: ["v1", "v2"], imported: { e1: 1, e2: 2 } };
		const { desktop, phone, toDesktop } = pair(start);
		// "Bring skipped back" and pruning on the desktop.
		desktop.s.swarmSkippedPlaces = [];
		delete desktop.s.imported.e1;
		desktop.sync(T0);
		phone.s.swarmReviewed.push("c9");
		phone.sync(T0 + DAY);
		toDesktop();
		desktop.sync(T0 + DAY + 1);
		expect(desktop.s.swarmSkippedPlaces).toEqual([]);
		expect(desktop.s.imported).toEqual({ e2: 2 });
		expect(metaOf(desktop.memory).gone.swarmSkippedPlaces?.v1).toBe(T0);
	});

	it("adding an entry again after it was removed wins", () => {
		const { desktop, phone, toDesktop, toPhone } = pair({ swarmSkippedPlaces: ["v1"] });
		desktop.s.swarmSkippedPlaces = [];
		desktop.sync(T0);
		toPhone();
		phone.sync(T0 + 1);
		phone.s.swarmSkippedPlaces.push("v1");
		phone.sync(T0 + HOUR);
		toDesktop();
		desktop.sync(T0 + HOUR + 1);
		expect(desktop.s.swarmSkippedPlaces).toEqual(["v1"]);
	});

	it("edits on both devices to different entries both survive", () => {
		const { desktop, phone, toDesktop, toPhone } = pair();
		desktop.s.categoryTags.a = { name: "Café", tag: "tea" };
		desktop.sync(T0);
		phone.s.categoryTags.b = { name: "Pizza", tag: "pizza" };
		phone.sync(T0 + HOUR);
		// Sync delivers the phone's file to the desktop (overwriting it)...
		toDesktop();
		desktop.sync(T0 + HOUR + 1);
		// ...and the desktop's merge goes back to the phone.
		toPhone();
		phone.sync(T0 + HOUR + 2);
		expect(Object.keys(desktop.s.categoryTags).sort()).toEqual(["a", "b"]);
		expect(Object.keys(phone.s.categoryTags).sort()).toEqual(["a", "b"]);
	});

	it("devices settle: no write bounces back and forth", () => {
		const { desktop, phone, toDesktop, toPhone } = pair();
		desktop.s.imported.e1 = 1;
		desktop.sync(T0);
		phone.s.swarmReviewed.push("c1");
		phone.sync(T0 + 1);
		toDesktop();
		desktop.sync(T0 + 2);
		toPhone();
		phone.sync(T0 + 3);
		const writes = desktop.writes + phone.writes;
		for (let i = 0; i < 3; i++) {
			toDesktop();
			desktop.sync(T0 + 10 + i);
			toPhone();
			phone.sync(T0 + 20 + i);
		}
		expect(desktop.writes + phone.writes).toBe(writes);
		expect(sameData(desktop.memory, phone.memory)).toBe(true);
	});

	it("two unstamped copies that differ don't bounce (ties go to the disk copy)", () => {
		const { desktop, phone, toDesktop, toPhone } = pair();
		desktop.file.data = { eventFolder: "A" };
		desktop.memory = normalizeSettings(desktop.file.data) as unknown as Data;
		desktop.baseline = clone(desktop.memory);
		phone.file.data = { eventFolder: "B" };
		phone.memory = normalizeSettings(phone.file.data) as unknown as Data;
		phone.baseline = clone(phone.memory);
		toDesktop();
		desktop.sync(T0);
		toPhone();
		phone.sync(T0 + 1);
		expect(desktop.writes + phone.writes).toBe(0);
		expect(desktop.s.eventFolder).toBe("B");
	});

	it("edit times travel with the data through other devices", () => {
		const { desktop, phone, toPhone } = pair();
		desktop.s.eventFolder = "Meetings";
		desktop.sync(T0);
		toPhone();
		phone.sync(T0 + HOUR);
		expect(metaOf(phone.memory).keys.eventFolder).toBe(T0);
		// A third, stale copy can't win on the phone either.
		const stale = normalizeSettings({ eventFolder: "Events" }) as unknown as Data;
		expect(mergeData(stale, phone.memory, T0 + 2 * HOUR).eventFolder).toBe("Meetings");
	});

	it("calendars merge per calendar, and a removed one stays removed", () => {
		const cal = (id: string, name: string) => ({ id, name, url: `https://x/${id}` });
		const { desktop, phone, toDesktop } = pair({ calendars: [cal("1", "Work"), cal("2", "Home")] });
		desktop.s.calendars = desktop.s.calendars.filter((c) => c.id !== "2");
		desktop.sync(T0);
		phone.s.calendars[0]!.color = "#ff0000";
		phone.sync(T0 + HOUR);
		toDesktop();
		desktop.sync(T0 + HOUR + 1);
		expect(desktop.s.calendars.map((c) => c.id)).toEqual(["1"]);
		expect(desktop.s.calendars[0]?.color).toBe("#ff0000");
	});

	it("each device's queued Swarm check-ins survive the other's saves", () => {
		const q = (device: string, at: number) => ({
			venueId: "v", placeName: "P", shout: "", at, device, attempts: 1, lastError: "",
		});
		const { desktop, phone, toDesktop } = pair();
		desktop.s.swarmQueue.push(q("desk", 1));
		desktop.sync(T0);
		phone.s.swarmQueue.push(q("phone", 2));
		phone.sync(T0 + HOUR);
		toDesktop();
		desktop.sync(T0 + HOUR + 1);
		expect(desktop.s.swarmQueue.map((x) => x.device).sort()).toEqual(["desk", "phone"]);
		// Posted on the desktop: gone everywhere, even if the phone's copy still has it.
		desktop.s.swarmQueue = desktop.s.swarmQueue.filter((x) => x.device !== "desk");
		desktop.sync(T0 + 2 * HOUR);
		const stale = mergeData(clone(desktop.memory), { ...clone(desktop.memory), swarmQueue: [q("desk", 1), q("phone", 2)] }, T0 + 3 * HOUR);
		expect((stale.swarmQueue as unknown[]).length).toBe(1);
	});

	it("check-ins posted from Obsidian are a union, never trimmed", () => {
		const disk = { swarmPostedIds: Array.from({ length: 5000 }, (_, i) => `d${i}`) };
		const merged = mergeData(disk, { swarmPostedIds: ["new"] }, T0);
		const ids = merged.swarmPostedIds as string[];
		expect(ids).toHaveLength(5001);
		expect(ids[ids.length - 1]).toBe("new");
		expect(ids[0]).toBe("d0");
	});

	it("old-format data (no edit times, from 1.3.x) is kept, and loses to stamped edits", () => {
		const old = { imported: { e1: 1 }, swarmSkippedPlaces: ["v1"], eventFolder: "Old" };
		const { desktop, phone, toDesktop } = pair(old);
		desktop.s.eventFolder = "New";
		desktop.sync(T0);
		// The tablet, still on 1.3.1, saves its whole copy (it keeps _sync as it loaded it).
		phone.file.data = { ...clone(old), [META_KEY]: undefined, imported: { e1: 1, e7: 7 }, swarmSkippedPlaces: ["v1", "v2"] };
		toDesktop();
		desktop.sync(T0 + DAY);
		expect(desktop.s.eventFolder).toBe("New");
		expect(desktop.s.imported).toEqual({ e1: 1, e7: 7 });
		expect(desktop.s.swarmSkippedPlaces).toEqual(["v1", "v2"]);
	});

	it("keys this version doesn't know, and per-device leftovers, are kept as they are on disk", () => {
		const disk = normalizeSettings({ futureThing: 5, lastLocation: { lat: 1, lng: 2 } }) as unknown as Data;
		const mine = { ...clone(disk), lastLocation: { lat: 9, lng: 9 } };
		const merged = mergeData(disk, mine, T0);
		expect(merged.futureThing).toBe(5);
		expect(merged.lastLocation).toEqual({ lat: 1, lng: 2 });
	});

	it("tombstones are forgotten after a long time", () => {
		const disk = { swarmSkippedPlaces: [], [META_KEY]: { keys: {}, items: {}, gone: { swarmSkippedPlaces: { v1: T0 } } } };
		const later = T0 + TOMBSTONE_TTL_MS + DAY;
		expect(metaOf(mergeData(disk, clone(disk), later)).gone.swarmSkippedPlaces).toBeUndefined();
	});

	it("\"Forget import history\" sticks against a stale copy, and re-imports win afterwards", () => {
		const { desktop, phone, toDesktop } = pair({ imported: { e1: 1, e2: 2 } });
		desktop.s.imported = {};
		desktop.sync(T0);
		desktop.s.imported.e2 = 2; // its note still exists, so the next import records it again
		desktop.sync(T0 + 1000);
		phone.s.weekStart = "sunday";
		phone.sync(T0 + HOUR);
		toDesktop();
		desktop.sync(T0 + HOUR + 1);
		expect(desktop.s.imported).toEqual({ e2: 2 });
	});
});

describe("Sync settling", () => {
	const base = { now: T0, startedAt: T0 - SETTLE_AFTER_START_MS, lastChange: 0, syncing: null };
	it("waits after startup", () => {
		expect(isSettled({ ...base, startedAt: T0 - 1000 })).toBe(false);
		expect(isSettled(base)).toBe(true);
	});
	it("waits for a quiet minute", () => {
		expect(isSettled({ ...base, lastChange: T0 - SETTLE_QUIET_MS + 1000 })).toBe(false);
		expect(isSettled({ ...base, lastChange: T0 - SETTLE_QUIET_MS })).toBe(true);
	});
	it("waits while the core Sync plugin says it's syncing", () => {
		expect(isSettled({ ...base, syncing: true })).toBe(false);
		expect(isSettled({ ...base, syncing: false })).toBe(true);
	});
});

describe("Run background tasks on this device", () => {
	it("defaults on for desktop, off for phones and tablets", () => {
		expect(backgroundOn(null, null, true)).toBe(true);
		expect(backgroundOn(null, null, false)).toBe(false);
	});
	it("keeps a device's own choice, including the old \"Import on this device\" off", () => {
		expect(backgroundOn("on", null, false)).toBe(true);
		expect(backgroundOn("off", null, true)).toBe(false);
		expect(backgroundOn(null, "off", true)).toBe(false);
		expect(backgroundOn("on", "off", true)).toBe(true);
	});
});

describe("import decisions", () => {
	const o = { hasNote: false, recorded: false, background: true, settled: true };
	it("never creates a note another device already recorded", () => {
		expect(importAction({ ...o, recorded: true })).toBe("skip");
	});
	it("waits instead of creating while Sync is busy", () => {
		expect(importAction({ ...o, settled: false })).toBe("wait");
		expect(importAction({ ...o, background: false, settled: false })).toBe("create");
	});
	it("follows existing notes", () => {
		expect(importAction({ ...o, hasNote: true })).toBe("follow");
		expect(importAction(o)).toBe("create");
	});
});

describe("saving stays cheap with a big Swarm history (1.4.1: settings froze on mobile)", () => {
	const big = () =>
		normalizeSettings({
			swarmReviewed: Array.from({ length: 40000 }, (_, i) => `checkin-${i}`),
			swarmPostedIds: Array.from({ length: 5000 }, (_, i) => `posted-${i}`),
			swarmSkippedPlaces: Array.from({ length: 2000 }, (_, i) => `venue-${i}`),
			imported: Object.fromEntries(Array.from({ length: 800 }, (_, i) => [`e${i}`, i])),
		}) as unknown as Data;

	it("a save after typing in a settings field writes just that change, and its echo writes nothing", () => {
		const disk = big();
		const mine = clone(disk);
		const baseline = clone(disk);
		(mine as { eventFolder?: string }).eventFolder = "Meetings";
		const { write, merged } = syncStep(mine, baseline, disk, T0);
		expect(write?.eventFolder).toBe("Meetings");
		expect(write?.swarmReviewed).toBe(disk.swarmReviewed); // the big list is reused, not rebuilt
		// Our own write coming back as an external change: nothing to do.
		const echo = syncStep(mine, clone(merged), clone(write as Data), T0 + 1);
		expect(echo.write).toBeNull();
		expect(echo.memoryChanged).toBe(false);
	});

	it("long id lists still merge correctly through the fast path", () => {
		const disk = { swarmReviewed: ["a", "b", "c"] };
		expect(mergeData(disk, { swarmReviewed: ["a", "b"] }, T0).swarmReviewed).toEqual(["a", "b", "c"]);
		expect(mergeData(disk, { swarmReviewed: ["a", "b", "c", "d"] }, T0).swarmReviewed).toEqual(["a", "b", "c", "d"]);
		expect(mergeData(disk, { swarmReviewed: ["x", "b"] }, T0).swarmReviewed).toEqual(["a", "b", "c", "x"]);
		expect(mergeData({ swarmReviewed: ["1"] }, { swarmReviewed: [1] }, T0).swarmReviewed).toEqual(["1", 1]);
	});

	it("comparing copies ignores key order, undefined values and empty edit records", () => {
		expect(sameData({ a: { x: 1, y: [1, 2] }, b: 2 }, { b: 2, a: { y: [1, 2], x: 1 } })).toBe(true);
		expect(sameData({ a: 1, c: undefined }, { a: 1 })).toBe(true);
		expect(sameData({ a: 1, [META_KEY]: { keys: {}, items: { imported: {} }, gone: {} } }, { a: 1 })).toBe(true);
		expect(sameData({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
		expect(sameData({ a: { x: 1 } }, { a: { x: 1, y: 0 } })).toBe(false);
		expect(sameData({ a: 1, [META_KEY]: { keys: { a: 5 }, items: {}, gone: {} } }, { a: 1 })).toBe(false);
	});
});

describe("no endless back-and-forth (1.4.2: settings froze on mobile)", () => {
	it("a full list of check-ins posted from Obsidian doesn't make devices rewrite each other forever", () => {
		const ids = Array.from({ length: 5000 }, (_, i) => `a${i}`);
		const { desktop, phone, toDesktop, toPhone } = pair({ swarmPostedIds: ids });
		phone.s.swarmPostedIds.push("p1");
		phone.s.swarmPostedIds.splice(0, 1); // the phone trims to the cap, as rememberPosted does
		phone.sync(T0);
		let rounds = 0;
		for (; rounds < 10; rounds++) {
			const before = desktop.writes + phone.writes;
			toDesktop();
			desktop.sync(T0 + 10 * rounds + 1);
			toPhone();
			phone.sync(T0 + 10 * rounds + 2);
			if (desktop.writes + phone.writes === before) break;
		}
		expect(rounds).toBeLessThan(3);
		expect(desktop.s.swarmPostedIds).toContain("p1");
	});
});
