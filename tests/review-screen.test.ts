// @vitest-environment jsdom
import "./dom";
import { describe, expect, it } from "vitest";
import { visibleText } from "./dom";
import { TFile, opened } from "obsidian";
import { DEFAULT_SETTINGS } from "../src/settings";
import { ReviewModal } from "../src/checkins/review-modal";
import type { SwarmCheckin } from "../src/checkins/history-logic";

const place = {
	id: "venue-1",
	name: "Prince Tea House",
	lat: 40.7222,
	lng: -73.8439,
	street: "15 Station Square",
	address: "15 Station Square, Forest Hills, NY 11375",
	categories: [{ id: "cat-tea", name: "Tea Room" }],
	website: "",
	distance: null,
};

function visit(id: string, isoUtc: string, shout = ""): SwarmCheckin {
	return { id, at: Date.parse(isoUtc), tz: -240, shout, place };
}

function screen(history: SwarmCheckin[], notes: Record<string, Record<string, unknown>> = {}) {
	const files = Object.keys(notes).map((path) =>
		Object.assign(new TFile(), { path, basename: path.split("/").pop()!.replace(/\.md$/, "") })
	);
	const byPath = new Map(files.map((f) => [f.path, f]));
	const app = {
		vault: {
			getMarkdownFiles: () => files,
			getFileByPath: (p: string) => byPath.get(p) ?? null,
			getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
		},
		metadataCache: { getFileCache: (f: TFile) => (notes[f.path] ? { frontmatter: notes[f.path] } : null) },
	};
	const plugin = {
		app,
		settings: {
			...DEFAULT_SETTINGS,
			placesFolder: "Travel",
			swarmToken: "token",
			categoryTags: { "cat-tea": { name: "Tea Room", tag: "tea" } },
		},
		saveSettings: async () => {},
	};
	const modal = new ReviewModal(plugin as never);
	const m = modal as unknown as { pwHistory: SwarmCheckin[]; pwNext(): void; contentEl: HTMLElement };
	m.pwHistory = history;
	m.pwNext();
	return m.contentEl;
}

describe("the history review screen", () => {
	it("offers 'Apply to all' and lists those visits when ticked", () => {
		const el = screen([
			visit("a", "2018-02-11T23:05:00Z", "again"),
			visit("b", "2017-06-03T18:22:00Z", "first time"),
		]);
		const text = visibleText(el);
		expect(text).toContain("Prince Tea House");
		expect(text).toContain("1 of 2");
		expect(text).toContain("Apply to all 2 visits here");
		expect(text).not.toContain("first time"); // the list is hidden until ticked

		const box = Array.from(el.querySelectorAll("label")).find((l) =>
			l.textContent?.includes("Apply to all")
		)!.querySelector("input")!;
		box.checked = true;
		box.dispatchEvent(new Event("change"));
		const after = visibleText(el);
		expect(after).toContain("Sun 2018-02-11 19:05");
		expect(after).toContain("Sat 2017-06-03 14:22");
		expect(after).toContain("“first time”");
		expect(after).toContain("Add to the daily notes of all 2 visits");
	});

	it("shows the plain-text option only while the daily note box is ticked", () => {
		const el = screen([visit("a", "2018-02-11T23:05:00Z")]);
		expect(visibleText(el)).not.toContain("Apply to all");
		const dailyBox = Array.from(el.querySelectorAll("label")).find((l) =>
			l.textContent?.includes("Add to daily note")
		)!.querySelector("input")!;
		expect(dailyBox.checked).toBe(false); // that day has no daily note
		expect(visibleText(el)).not.toContain("plain text");
		dailyBox.checked = true;
		dailyBox.dispatchEvent(new Event("change"));
		expect(visibleText(el)).toContain("Add the name as plain text (not a link)");
	});

	it("lets you edit the name of a new place note, showing how it will be saved", () => {
		const el = screen([visit("a", "2018-02-11T23:05:00Z")]);
		const label = Array.from(el.querySelectorAll("label")).find((l) => l.textContent === "Note name")!;
		const input = el.querySelector<HTMLInputElement>(`#${label.getAttribute("for")}`)!;
		expect(input.value).toBe("Prince Tea House");
		input.value = "Prince Tea: House?";
		input.dispatchEvent(new Event("input"));
		expect(visibleText(el)).toContain('Will be saved as "Prince Tea House"');
	});

	it("offers the ratings already used in the vault, starting on the note's own", () => {
		const el = screen([visit("a", "2018-02-11T23:05:00Z")], {
			"Travel/Prince Tea House.md": { Geolink: "40.7222, -73.8439", Rating: "🩷🩷" },
			"Travel/A.md": { Rating: "🩷" },
			"Travel/B.md": { Rating: "🩷" },
		});
		const label = Array.from(el.querySelectorAll("p")).find((p) => p.textContent === "Rating")!;
		const chips = Array.from(label.nextElementSibling!.querySelectorAll("button")).map((b) => [
			b.textContent,
			b.getAttribute("aria-pressed"),
		]);
		expect(chips).toEqual([
			["🩷", "false"],
			["🩷🩷", "true"],
			["+ new", null],
		]);
		expect(visibleText(el)).toContain("Note exists: Prince Tea House");
	});

	it("can link the visit to a note found by search", () => {
		opened.length = 0;
		const el = screen([visit("a", "2018-02-11T23:05:00Z")], {
			"Other/Prince Tea (Forest Hills).md": {},
			"Travel/Something.md": {},
		});
		expect(visibleText(el)).toContain("No note yet");
		expect(visibleText(el)).toContain("Note name");
		const find = Array.from(el.querySelectorAll("button")).find((b) =>
			b.textContent?.startsWith("Link to an existing note")
		)!;
		find.click();
		const search = opened[opened.length - 1] as unknown as {
			getItems(): TFile[];
			onChooseItem(f: TFile): void;
		};
		// Places folder first.
		expect(search.getItems().map((f) => f.path)).toEqual(["Travel/Something.md", "Other/Prince Tea (Forest Hills).md"]);
		search.onChooseItem(search.getItems()[1]!);
		const text = visibleText(el);
		expect(text).toContain("Linking to: Prince Tea (Forest Hills)");
		expect(text).not.toContain("Note name");
		expect(text).toContain("Undo");
	});

	it("has Later, Skip and Save and next", () => {
		const text = visibleText(screen([visit("a", "2018-02-11T23:05:00Z")]));
		expect(text).toContain("Later");
		expect(text).toContain("Skip");
		expect(text).toContain("Save and next");
	});
});
