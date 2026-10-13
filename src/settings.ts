import { CalendarSource } from "./types";
import { AttendeeFilter, AttendeeFormat } from "./util/attendees";

export type WeekStart = "locale" | "sunday" | "monday";

export interface BetterCalendarsSettings {
	// Calendar view
	weekStart: WeekStart;
	showWeekNumbers: boolean;
	confirmBeforeCreate: boolean;
	openOnStartup: boolean;

	// Daily notes. Empty values fall back to the core Daily notes settings.
	dailyFolder: string;
	dailyFormat: string;
	dailyTemplate: string;
	/** Keep daily notes created for today and this many days ahead (0 = off). */
	dailyAutoCreateDays: number;

	// Event import
	calendars: CalendarSource[];
	autoImport: boolean;
	importDaysAhead: number;
	importDaysBack: number;
	refreshMinutes: number;
	eventFolder: string;
	eventTemplate: string;
	eventTitlePattern: string;
	attendeeFilter: AttendeeFilter;
	attendeeFormat: AttendeeFormat;
	/** Names/emails never listed as attendees (e.g. your own). */
	attendeeExclude: string;
	/** Folder with person notes to link guests to; empty searches the whole vault. */
	peopleFolder: string;
	/** Link guests without a person note as [[Name]]. */
	linkUnmatchedAttendees: boolean;
	/** Hide the event_id property in the Properties panel. */
	hideEventId: boolean;
	/** Frontmatter property holding the event's date; kept up to date when an event moves. */
	eventDateProperty: string;
	/** Frontmatter property holding the event's end date; updated (never added) when an event moves. */
	eventEndDateProperty: string;
	/** Write date and time (2026-10-12T15:00) into the date properties of timed events. */
	includeTimes: boolean;
	/** Frontmatter property for the guests list. */
	eventPeopleProperty: string;
	/** Fill template properties left empty (Date:, People:, Location:, ...) by name. */
	fillEmptyProperties: boolean;
	runTemplater: boolean;
	/** Keep the People property of event notes up to date with the guests. */
	syncPeople: boolean;
	/** People entries the plugin added, per event id; only these are ever removed again. */
	peopleAdded: Record<string, string[]>;
	/** Per event id: the file name the plugin gave the note and the event title it was made from. */
	noteNames: Record<string, { name: string; title: string }>;
	/** Events that already got a note: event id -> event start (ms). Deleting such a note doesn't bring it back. */
	imported: Record<string, number>;
}

export const DEFAULT_SETTINGS: BetterCalendarsSettings = {
	weekStart: "locale",
	showWeekNumbers: false,
	confirmBeforeCreate: true,
	openOnStartup: true,

	dailyFolder: "",
	dailyFormat: "",
	dailyTemplate: "",
	dailyAutoCreateDays: 0,

	calendars: [],
	autoImport: true,
	importDaysAhead: 7,
	importDaysBack: 0,
	refreshMinutes: 30,
	eventFolder: "Events",
	eventTemplate: "",
	eventTitlePattern: "{{date}} {{title}}",
	eventDateProperty: "Date",
	eventEndDateProperty: "End_Date",
	eventPeopleProperty: "People",
	includeTimes: true,
	fillEmptyProperties: true,
	attendeeFilter: "accepted",
	attendeeFormat: "name",
	attendeeExclude: "",
	peopleFolder: "People",
	linkUnmatchedAttendees: false,
	hideEventId: true,
	runTemplater: true,
	imported: {},
	syncPeople: true,
	peopleAdded: {},
	noteNames: {},
};

export function normalizeCalendar(raw: unknown): CalendarSource {
	const o = (raw ?? {}) as Record<string, unknown>;
	const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);
	return {
		id: str(o.id, ""),
		name: str(o.name, "Calendar"),
		url: str(o.url, ""),
		color: str(o.color, "#4285f4"),
		enabled: o.enabled !== false,
		autoImport: o.autoImport !== false,
		folder: str(o.folder, ""),
		template: str(o.template, ""),
		titlePattern: str(o.titlePattern, ""),
		excludeAllDay: o.excludeAllDay !== false,
	};
}
