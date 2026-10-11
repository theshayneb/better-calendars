import { describe, expect, it } from "vitest";
import { parseICS } from "../src/events/parser";
import { CalendarSource } from "../src/types";

const calendar: CalendarSource = {
	id: "c1",
	name: "Work",
	url: "",
	color: "#000",
	enabled: true,
	autoImport: true,
	folder: "",
	template: "",
	titlePattern: "",
	excludeAllDay: true,
};

const ics = (body: string) =>
	`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n${body.trim().split("\n").map((l) => l.trim()).join("\r\n")}\r\nEND:VCALENDAR\r\n`;

const window = {
	calendar,
	windowStart: new Date(Date.UTC(2026, 9, 1)),
	windowEnd: new Date(Date.UTC(2026, 10, 1)),
};

describe("parseICS", () => {
	it("parses a single event with uid as id", () => {
		const events = parseICS(
			ics(`
				BEGIN:VEVENT
				UID:one@test
				DTSTART:20261012T090000Z
				DTEND:20261012T100000Z
				SUMMARY:Dentist
				LOCATION:https://meet.google.com/abc-defg-hij
				END:VEVENT
			`),
			window
		);
		expect(events).toHaveLength(1);
		expect(events[0]!.id).toBe("one@test");
		expect(events[0]!.title).toBe("Dentist");
		expect(events[0]!.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
	});

	it("expands recurrences and applies moved and cancelled occurrences", () => {
		const events = parseICS(
			ics(`
				BEGIN:VEVENT
				UID:weekly@test
				DTSTART:20261005T150000Z
				DTEND:20261005T160000Z
				RRULE:FREQ=WEEKLY;COUNT=4
				SUMMARY:Standup
				END:VEVENT
				BEGIN:VEVENT
				UID:weekly@test
				RECURRENCE-ID:20261012T150000Z
				DTSTART:20261013T170000Z
				DTEND:20261013T180000Z
				SUMMARY:Standup (moved)
				END:VEVENT
				BEGIN:VEVENT
				UID:weekly@test
				RECURRENCE-ID:20261019T150000Z
				DTSTART:20261019T150000Z
				DTEND:20261019T160000Z
				STATUS:CANCELLED
				SUMMARY:Standup
				END:VEVENT
			`),
			window
		);
		expect(events.map((e) => e.title)).toEqual(["Standup", "Standup (moved)", "Standup"]);
		const moved = events[1]!;
		expect(moved.start.toISOString()).toBe("2026-10-13T17:00:00.000Z");
		// The moved occurrence keeps the id of its original slot.
		const slot = new Date(Date.UTC(2026, 9, 12, 15));
		const pad = (n: number) => String(n).padStart(2, "0");
		expect(moved.id).toBe(
			`weekly@test::${slot.getFullYear()}-${pad(slot.getMonth() + 1)}-${pad(slot.getDate())}`
		);
		expect(new Set(events.map((e) => e.id)).size).toBe(3);
	});

	it("skips cancelled and all-day events when asked", () => {
		const events = parseICS(
			ics(`
				BEGIN:VEVENT
				UID:x@test
				DTSTART:20261012T090000Z
				DTEND:20261012T100000Z
				STATUS:CANCELLED
				SUMMARY:Gone
				END:VEVENT
				BEGIN:VEVENT
				UID:bday@test
				DTSTART;VALUE=DATE:20261014
				DTEND;VALUE=DATE:20261015
				SUMMARY:Birthday
				END:VEVENT
			`),
			window
		);
		expect(events).toHaveLength(0);
		const withAllDay = parseICS(
			ics(`
				BEGIN:VEVENT
				UID:bday@test
				DTSTART;VALUE=DATE:20261014
				DTEND;VALUE=DATE:20261015
				SUMMARY:Birthday
				END:VEVENT
			`),
			{ ...window, calendar: { ...calendar, excludeAllDay: false } }
		);
		expect(withAllDay).toHaveLength(1);
		expect(withAllDay[0]!.allDay).toBe(true);
	});

	it("drops events outside the window", () => {
		const events = parseICS(
			ics(`
				BEGIN:VEVENT
				UID:old@test
				DTSTART:20250101T090000Z
				DTEND:20250101T100000Z
				SUMMARY:Old
				END:VEVENT
			`),
			window
		);
		expect(events).toHaveLength(0);
	});
});
