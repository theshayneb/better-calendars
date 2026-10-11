import { CalendarSource } from "./types";

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
	/** Frontmatter property holding the event's date; kept up to date when an event moves. */
	eventDateProperty: string;
	runTemplater: boolean;
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
	runTemplater: true,
	imported: {},
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
