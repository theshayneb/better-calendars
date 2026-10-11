import { describe, expect, it } from "vitest";
import moment from "moment";
import { renderDailyTemplate, renderEventTemplate, sanitizeFilename } from "../src/util/template";
import { findIsoDate, withEventFrontmatter } from "../src/events/with-frontmatter";
import { CalEvent } from "../src/types";

describe("renderDailyTemplate", () => {
	const date = moment("2026-12-24", "YYYY-MM-DD");

	it("uses the note's own date, not today", () => {
		expect(renderDailyTemplate("# {{date}}", date, "YYYY-MM-DD", "2026-12-24")).toBe(
			"# 2026-12-24"
		);
		expect(renderDailyTemplate("{{date:dddd, MMMM D}}", date, "YYYY-MM-DD", "t")).toBe(
			"Thursday, December 24"
		);
	});

	it("handles title, offsets, yesterday and tomorrow", () => {
		const out = renderDailyTemplate(
			"{{title}}|{{yesterday}}|{{tomorrow}}|{{date+1w:YYYY-MM-DD}}|{{date-1M:YYYY-MM}}",
			date,
			"YYYY-MM-DD",
			"My title"
		);
		expect(out).toBe("My title|2026-12-23|2026-12-25|2026-12-31|2026-11");
	});

	it("formats {{time}} as HH:mm", () => {
		expect(renderDailyTemplate("{{time}}", date, "YYYY-MM-DD", "t")).toMatch(/^\d\d:\d\d$/);
	});
});

describe("renderEventTemplate", () => {
	const event: CalEvent = {
		id: "abc",
		uid: "abc",
		recurring: false,
		calendarId: "c1",
		title: "Team sync",
		start: new Date(2026, 9, 12, 9, 30),
		end: new Date(2026, 9, 12, 10, 15),
		allDay: false,
		location: "Room 1",
		description: "Agenda",
		organizer: "a@b.c",
		attendees: ["Ann", "Bob"],
		meetingUrl: "https://meet.google.com/xyz",
	};
	const ctx = { event, calendarName: "Work", dailyNoteLink: "[[2026-10-12]]" };

	it("fills the variables", () => {
		expect(
			renderEventTemplate(
				"{{date}} {{title}} {{start}}-{{end}} {{duration}} {{calendar}} {{daily_note}} {{attendees_wikilinks}} {{start:h:mm A}}",
				ctx
			)
		).toBe("2026-10-12 Team sync 09:30-10:15 45 Work [[2026-10-12]] [[Ann]], [[Bob]] 9:30 AM");
	});

	it("leaves unknown variables alone (e.g. for other plugins)", () => {
		expect(renderEventTemplate("{{nope}} {{title}}", ctx)).toBe("{{nope}} Team sync");
	});
});

describe("sanitizeFilename", () => {
	it("removes characters that are not allowed in note names", () => {
		expect(sanitizeFilename('2026-10-12 a/b: "c" [d] #e')).toBe("2026-10-12 a b c d e");
	});
});

describe("withEventFrontmatter", () => {
	it("adds the id and keeps the template's own Date", () => {
		expect(withEventFrontmatter("---\nDate: 2026-10-12\n---\nbody", "u::1", "Date", "2026-10-12")).toBe(
			'---\nevent_id: "u::1"\nDate: 2026-10-12\n---\nbody'
		);
	});

	it("adds the date property when the template has none", () => {
		expect(withEventFrontmatter("---\ntags: x\n---\nbody", "u", "Date", "2026-10-12")).toBe(
			'---\nevent_id: "u"\nDate: 2026-10-12\ntags: x\n---\nbody'
		);
	});

	it("creates frontmatter when there is none", () => {
		expect(withEventFrontmatter("# Hi\n", "u", "Date", "2026-10-12")).toBe(
			'---\nevent_id: "u"\nDate: 2026-10-12\n---\n# Hi\n'
		);
	});

	it("does not treat a lone horizontal rule as frontmatter", () => {
		expect(withEventFrontmatter("---\nno end", "u", "", "2026-10-12")).toBe(
			'---\nevent_id: "u"\n---\n---\nno end'
		);
	});
});

describe("findIsoDate", () => {
	it("finds the date in plain and linked values", () => {
		expect(findIsoDate("2026-10-12")).toBe("2026-10-12");
		expect(findIsoDate("[[2026-10-12]]")).toBe("2026-10-12");
		expect(findIsoDate(undefined)).toBeNull();
	});
});
