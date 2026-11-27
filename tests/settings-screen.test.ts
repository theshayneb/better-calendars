// @vitest-environment jsdom
import "./dom";
import { describe, expect, it } from "vitest";
import { visibleText } from "./dom";
import { normalizeSettings } from "../src/settings";
import { BetterCalendarsSettingTab } from "../src/settings-tab";

function tab(raw: Record<string, unknown>, background = false) {
	const settings = normalizeSettings(raw);
	const app = {
		vault: { getAllLoadedFiles: () => [], getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
		metadataCache: { getFirstLinkpathDest: () => null },
		internalPlugins: { getPluginById: () => null },
		plugins: { getPlugin: () => null },
	};
	const plugin = {
		app,
		settings,
		manager: { getStatus: () => ({ kind: "idle" }) },
		settle: { describe: () => "sync has settled" },
		backgroundOnThisDevice: () => background,
		lastBackgroundRun: () => 0,
		lastLocation: () => null,
		saveSettings: async () => {},
		refreshViews: () => {},
	};
	return new BetterCalendarsSettingTab(app as never, plugin as never);
}

describe("settings screen", () => {
	it("draws, with the background switch and its status", () => {
		const t = tab({});
		t.display();
		const text = visibleText(t.containerEl);
		expect(text).toContain("Run background tasks on this device");
		expect(text).toContain("Off: this device only shows the calendar");
	});

	it("isn't redrawn when settings arrive from another device; it says so once", () => {
		const t = tab({});
		document.body.appendChild(t.containerEl);
		t.display();
		const before = t.containerEl.querySelectorAll(".setting-item").length;
		t.pwChangedElsewhere();
		t.pwChangedElsewhere();
		expect(t.containerEl.querySelectorAll(".setting-item").length).toBe(before);
		expect(visibleText(t.containerEl).match(/changed on another device/g)).toHaveLength(1);
		// Reopened: drawn fresh, without the note.
		t.display();
		expect(visibleText(t.containerEl)).not.toContain("changed on another device");
		t.containerEl.remove();
	});

	it("closing saves pending changes and lets Obsidian clean up", () => {
		const t = tab({});
		t.hide();
		expect((t as unknown as { hidden: number }).hidden).toBe(1);
	});

	it("draws quickly with a big history", () => {
		const t = tab({
			calendars: [{ id: "1", name: "Work", url: "x" }],
			swarmToken: "t",
			swarmReviewed: Array.from({ length: 40000 }, (_, i) => `c${i}`),
			categoryTags: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`k${i}`, { name: `Cat ${i}`, tag: "food" }])),
			imported: Object.fromEntries(Array.from({ length: 800 }, (_, i) => [`e${i}`, i])),
		}, true);
		const start = performance.now();
		t.display();
		// About 0.2 s in jsdom; generous, so a slow test machine doesn't fail a release.
		expect(performance.now() - start).toBeLessThan(5000);
	});
});
