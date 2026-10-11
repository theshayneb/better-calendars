import ICAL from "ical.js";
import { CalendarSource, CalEvent } from "../types";

const MEETING_URL_PATTERNS: RegExp[] = [
	/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"'<>]+/i,
	/https:\/\/[a-z0-9.-]*zoom\.us\/j\/[^\s"'<>]+/i,
	/https:\/\/meet\.google\.com\/[a-z0-9-]+(?:\?[^\s"'<>]*)?/i,
	/https:\/\/[a-z0-9.-]*webex\.com\/(?:meet|wbxmjs|join)\/[^\s"'<>]+/i,
];

const GENERIC_URL = /https?:\/\/[^\s"'<>]+/i;

const MAX_RECURRENCE_OCCURRENCES = 500;
// Unseeded iterators start at DTSTART, so a years-old daily event can have
// thousands of pre-window occurrences to skip. Skips are bounded separately
// from emitted occurrences so old events don't exhaust the budget (PR #9).
const MAX_RECURRENCE_ITERATIONS = 10_000;

/**
 * Microsoft/Outlook uses proprietary timezone labels that ical.js does not
 * recognize. The accompanying VTIMEZONE blocks define correct DST rules; we
 * just rewrite the label so ical.js can register them under an IANA name and
 * resolve recurrences properly.
 */
const MS_TZID_MAP: Record<string, string> = {
	"W. Europe Standard Time": "Europe/Berlin",
	"Central Europe Standard Time": "Europe/Budapest",
	"Central European Standard Time": "Europe/Warsaw",
	"Romance Standard Time": "Europe/Paris",
	"GMT Standard Time": "Europe/London",
	"Greenwich Standard Time": "Atlantic/Reykjavik",
	"FLE Standard Time": "Europe/Helsinki",
	"E. Europe Standard Time": "Europe/Bucharest",
	"GTB Standard Time": "Europe/Athens",
	"Russian Standard Time": "Europe/Moscow",
	"Turkey Standard Time": "Europe/Istanbul",
	"Israel Standard Time": "Asia/Jerusalem",
	"Egypt Standard Time": "Africa/Cairo",
	"South Africa Standard Time": "Africa/Johannesburg",
	"UTC": "UTC",
	"Pacific Standard Time": "America/Los_Angeles",
	"Mountain Standard Time": "America/Denver",
	"Central Standard Time": "America/Chicago",
	"Eastern Standard Time": "America/New_York",
	"Atlantic Standard Time": "America/Halifax",
	"Newfoundland Standard Time": "America/St_Johns",
	"SA Pacific Standard Time": "America/Bogota",
	"SA Eastern Standard Time": "America/Cayenne",
	"Hawaiian Standard Time": "Pacific/Honolulu",
	"Alaskan Standard Time": "America/Anchorage",
	"China Standard Time": "Asia/Shanghai",
	"Tokyo Standard Time": "Asia/Tokyo",
	"Korea Standard Time": "Asia/Seoul",
	"India Standard Time": "Asia/Kolkata",
	"Singapore Standard Time": "Asia/Singapore",
	"Taipei Standard Time": "Asia/Taipei",
	"AUS Eastern Standard Time": "Australia/Sydney",
	"AUS Central Standard Time": "Australia/Darwin",
	"E. Australia Standard Time": "Australia/Brisbane",
	"W. Australia Standard Time": "Australia/Perth",
	"New Zealand Standard Time": "Pacific/Auckland",
	"Arabian Standard Time": "Asia/Dubai",
	"Arab Standard Time": "Asia/Riyadh",
	"Iran Standard Time": "Asia/Tehran",
};

function rewriteOutlookTzids(ics: string): string {
	let out = ics;
	for (const [ms, iana] of Object.entries(MS_TZID_MAP)) {
		const escaped = ms.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		// VTIMEZONE block header: "TZID:W. Europe Standard Time"
		out = out.replace(
			new RegExp(`^TZID:${escaped}\\s*$`, "gm"),
			`TZID:${iana}`
		);
		// Property parameter, quoted or unquoted: TZID="W. Europe Standard Time"
		out = out.replace(
			new RegExp(`TZID="${escaped}"`, "g"),
			`TZID="${iana}"`
		);
		out = out.replace(
			new RegExp(`TZID=${escaped}(?=[:;])`, "g"),
			`TZID=${iana}`
		);
	}
	return out;
}

interface AttendeeProperty {
	name: string;
	getFirstValue(): unknown;
	getParameter(name: string): string | undefined;
}

interface MinimalComponent {
	getFirstPropertyValue<T>(name: string): T | null;
	getAllProperties(name?: string): AttendeeProperty[];
}

interface MinimalTime {
	toJSDate(): Date;
	isDate: boolean;
}

interface MinimalEvent {
	uid: string;
	summary: string;
	location: string;
	description: string;
	organizer: string;
	startDate: MinimalTime;
	endDate: MinimalTime;
	component: MinimalComponent;
	isRecurring(): boolean;
	relateException(ex: MinimalEvent): void;
	iterator(start?: MinimalTime): { next(): MinimalTime | null };
	getOccurrenceDetails(time: MinimalTime): {
		startDate: MinimalTime;
		endDate: MinimalTime;
		item: MinimalEvent;
	};
}

export interface ParseOptions {
	calendar: CalendarSource;
	windowStart: Date;
	windowEnd: Date;
}

export function parseICS(ics: string, opts: ParseOptions): CalEvent[] {
	const { calendar, windowStart, windowEnd } = opts;

	const jcal = ICAL.parse(rewriteOutlookTzids(ics));
	const root = new ICAL.Component(jcal);

	for (const vtz of root.getAllSubcomponents("vtimezone")) {
		const tzid = vtz.getFirstPropertyValue<string>("tzid");
		if (tzid && !ICAL.TimezoneService.has(tzid)) {
			try {
				ICAL.TimezoneService.register(vtz);
			} catch {
				/* ignore */
			}
		}
	}

	// A moved or cancelled single occurrence of a recurring event is a
	// separate VEVENT with the same UID and a RECURRENCE-ID. It has to be
	// attached to its series, or the original slot would still show up.
	const vevents = root.getAllSubcomponents("vevent");
	const masters = new Map<string, MinimalEvent>();
	const exceptions: MinimalEvent[] = [];
	for (const vevent of vevents) {
		const event = new ICAL.Event(vevent) as unknown as MinimalEvent;
		if (vevent.getFirstPropertyValue("recurrence-id")) {
			exceptions.push(event);
		} else {
			masters.set(event.uid, event);
		}
	}
	const orphans: MinimalEvent[] = [];
	for (const ex of exceptions) {
		const master = masters.get(ex.uid);
		if (master && master.isRecurring()) {
			master.relateException(ex);
		} else {
			orphans.push(ex);
		}
	}

	const meetings: CalEvent[] = [];
	const seen = new Set<string>();
	const push = (
		source: MinimalEvent,
		start: Date,
		end: Date,
		id: string,
		recurring: boolean
	) => {
		if (end <= windowStart || start >= windowEnd) return;
		const meeting = buildMeeting(source, start, end, calendar, id, recurring);
		if (acceptable(meeting, calendar, seen)) meetings.push(meeting);
	};

	for (const event of masters.values()) {
		if (isCancelled(event)) continue;

		if (!event.isRecurring()) {
			push(
				event,
				event.startDate.toJSDate(),
				event.endDate.toJSDate(),
				event.uid,
				false
			);
			continue;
		}

		const masterStart = event.startDate.toJSDate();
		const masterEnd = event.endDate.toJSDate();
		const masterAllDay = event.startDate.isDate;
		const masterHours = masterStart.getHours();
		const masterMinutes = masterStart.getMinutes();
		const masterDurationMs = masterEnd.getTime() - masterStart.getTime();

		// Do not seed the iterator with windowStart: that resets the
		// recurrence epoch and breaks INTERVAL>1 patterns.
		const iter = event.iterator();
		let emitted = 0;
		let iterations = 0;
		while (
			emitted < MAX_RECURRENCE_OCCURRENCES &&
			iterations < MAX_RECURRENCE_ITERATIONS
		) {
			iterations++;
			const next = iter.next();
			if (!next) break;
			// The occurrence keeps the id of its original slot, so moving
			// one occurrence keeps its note.
			const id = `${event.uid}::${localDate(next.toJSDate())}`;
			let start: Date;
			let end: Date;
			let source = event;
			try {
				const details = event.getOccurrenceDetails(next);
				start = details.startDate.toJSDate();
				end = details.endDate.toJSDate();
				source = details.item;
			} catch {
				start = next.toJSDate();
				end = new Date(start.getTime() + masterDurationMs);
			}
			if (source !== event && isCancelled(source)) continue;
			// Safety net: if the iterator dropped the time of day (unmapped
			// timezone labels), restore the master's start time.
			if (
				source === event &&
				!masterAllDay &&
				start.getHours() === 0 &&
				start.getMinutes() === 0 &&
				(masterHours !== 0 || masterMinutes !== 0)
			) {
				const fixed = next.isDate
					? new Date(
							start.getFullYear(),
							start.getMonth(),
							start.getDate()
						)
					: new Date(
							start.getUTCFullYear(),
							start.getUTCMonth(),
							start.getUTCDate()
						);
				fixed.setHours(masterHours, masterMinutes, 0, 0);
				const shiftMs = fixed.getTime() - start.getTime();
				start = fixed;
				end = new Date(end.getTime() + shiftMs);
			}
			if (start >= windowEnd && next.toJSDate() >= windowEnd) break;
			if (end > windowStart) emitted++;
			push(source, start, end, id, true);
		}
	}

	// Overrides whose series is not in the feed: treat as single events.
	for (const ex of orphans) {
		if (isCancelled(ex)) continue;
		const rid = ex.component.getFirstPropertyValue<MinimalTime>("recurrence-id");
		const slot = rid ? rid.toJSDate() : ex.startDate.toJSDate();
		push(
			ex,
			ex.startDate.toJSDate(),
			ex.endDate.toJSDate(),
			`${ex.uid}::${localDate(slot)}`,
			true
		);
	}

	meetings.sort((a, b) => a.start.getTime() - b.start.getTime());
	return meetings;
}

function isCancelled(event: MinimalEvent): boolean {
	return (
		String(event.component.getFirstPropertyValue("status") ?? "")
			.toUpperCase() === "CANCELLED"
	);
}

function acceptable(
	meeting: CalEvent,
	calendar: CalendarSource,
	seen: Set<string>
): boolean {
	if (calendar.excludeAllDay && meeting.allDay) return false;
	if (seen.has(meeting.id)) return false;
	seen.add(meeting.id);
	return true;
}

function buildMeeting(
	event: MinimalEvent,
	start: Date,
	end: Date,
	calendar: CalendarSource,
	id: string,
	recurring: boolean
): CalEvent {
	const allDay = Boolean(event.startDate?.isDate);
	const title = (event.summary ?? "").toString().trim() || "(no title)";
	const location = (event.location ?? "").toString();
	const description = stripHTML((event.description ?? "").toString());
	const organizer = cleanContact(String(event.organizer ?? ""));

	const attendees: string[] = [];
	for (const prop of event.component.getAllProperties("attendee")) {
		const cn = prop.getParameter("cn");
		if (cn) {
			attendees.push(cn);
			continue;
		}
		const v = prop.getFirstValue();
		if (typeof v === "string") attendees.push(cleanContact(v));
	}

	const teamsUrl = event.component.getFirstPropertyValue<string>(
		"x-microsoft-skypeteamsmeetingurl"
	);
	const meetingUrl =
		(teamsUrl && String(teamsUrl)) ||
		detectMeetingUrl(location) ||
		detectMeetingUrl(description) ||
		detectGenericUrl(description) ||
		detectGenericUrl(location) ||
		"";


	return {
		id,
		uid: event.uid,
		recurring,
		calendarId: calendar.id,
		title,
		start,
		end,
		allDay,
		location,
		description,
		organizer,
		attendees,
		meetingUrl,
	};
}

function detectMeetingUrl(text: string): string {
	if (!text) return "";
	for (const re of MEETING_URL_PATTERNS) {
		const m = re.exec(text);
		if (m) return m[0];
	}
	return "";
}

function detectGenericUrl(text: string): string {
	if (!text) return "";
	const m = GENERIC_URL.exec(text);
	return m ? m[0] : "";
}

function stripHTML(input: string): string {
	if (!input) return "";
	return input
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\r\n/g, "\n")
		.trim();
}

function cleanContact(raw: string): string {
	if (!raw) return "";
	return raw.replace(/^mailto:/i, "");
}

function localDate(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
