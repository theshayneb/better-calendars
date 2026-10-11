import { describe, expect, it } from "vitest";
import moment from "moment";
import { renderDailyTemplate, renderEventTemplate, sanitizeFilename } from "../src/util/template";
import { findIsoDate, withEventFrontmatter } from "../src/events/with-frontmatter";
import { CalEvent } from "../src/types";
import { buildPeopleIndex, selectAttendees } from "../src/util/attendees";

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
		attendees: [
			{ name: "Ann", email: "ann@x.com", status: "accepted" },
			{ name: "Bob", email: "bob@x.com", status: "accepted" },
		],
		meetingUrl: "https://meet.google.com/xyz",
	};
	const ctx = { event, calendarName: "Work", attendees: [
			{ text: "Ann", link: "[[Ann]]" },
			{ text: "bob@x.com", link: "bob@x.com" },
		],
		dailyNoteLink: "[[2026-10-12]]" };

	it("fills the variables", () => {
		expect(
			renderEventTemplate(
				"{{date}} {{title}} {{start}}-{{end}} {{duration}} {{calendar}} {{daily_note}} {{attendees_wikilinks}} {{start:h:mm A}}",
				ctx
			)
		).toBe("2026-10-12 Team sync 09:30-10:15 45 Work [[2026-10-12]] [[Ann]], bob@x.com 9:30 AM");
	});

	it("gives the inclusive end date, also for all-day events", () => {
		expect(renderEventTemplate("{{end_date}}", ctx)).toBe("2026-10-12");
		const allDay = {
			...event,
			allDay: true,
			start: new Date(2026, 9, 12),
			end: new Date(2026, 9, 15),
		};
		expect(renderEventTemplate("{{end_date}} {{end_date:D MMM}}", { ...ctx, event: allDay })).toBe(
			"2026-10-14 14 Oct"
		);
		expect(
			renderEventTemplate("{{end_date}}", {
				...ctx,
				event: { ...allDay, end: new Date(2026, 9, 13) },
			})
		).toBe("2026-10-12");
	});

	it("writes attendees as a list property", () => {
		expect(renderEventTemplate("Attendees: {{attendees_property}}", ctx)).toBe(
			'Attendees: ["[[Ann]]", "bob@x.com"]'
		);
		expect(renderEventTemplate("{{attendees_property}}", { ...ctx, attendees: [] })).toBe("[]");
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

describe("selectAttendees", () => {
	const list = [
		{ name: "Ann Lee", email: "ann@x.com", status: "accepted" as const },
		{ name: "", email: "bob@x.com", status: "accepted" as const },
		{ name: "Cat", email: "cat@x.com", status: "tentative" as const },
		{ name: "Dan", email: "dan@x.com", status: "declined" as const },
		{ name: "Me", email: "me@x.com", status: "needs-action" as const },
	];
	const opts = { filter: "accepted" as const, format: "name" as const, exclude: "", linkUnmatched: false };

	it("keeps accepted guests as plain text without person notes", () => {
		expect(selectAttendees(list, opts, null)).toEqual([
			{ text: "Ann Lee", link: "Ann Lee" },
			{ text: "bob@x.com", link: "bob@x.com" },
		]);
	});

	it("links guests to person notes by email, name or alias", () => {
		const people = buildPeopleIndex([
			{ linktext: "Ann", basename: "Ann", aliases: ["Ann Lee"], emails: [] },
			{ linktext: "People/Robert", basename: "Robert", aliases: [], emails: ["BOB@x.com"] },
			{ linktext: "Cat", basename: "Cat", aliases: [], emails: [] },
		]);
		expect(selectAttendees(list, { ...opts, filter: "accepted-maybe" }, people)).toEqual([
			{ text: "Ann", link: "[[Ann]]" },
			{ text: "Robert", link: "[[People/Robert]]" },
			{ text: "Cat", link: "[[Cat]]" },
		]);
	});

	it("filters by reply, leaves out excluded people, can link unmatched guests", () => {
		expect(
			selectAttendees(
				list,
				{ ...opts, filter: "not-declined", format: "email", exclude: "ME@x.com, Cat", linkUnmatched: true },
				null
			).map((a) => a.link)
		).toEqual(["[[ann@x.com]]", "[[bob@x.com]]"]);
		expect(selectAttendees(list, { ...opts, filter: "all" }, null)).toHaveLength(5);
	});
});
