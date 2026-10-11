/** One subscribed calendar (an ICS feed, e.g. Google's "secret address in iCal format"). */
export interface CalendarSource {
	/** Stable internal ID, generated when the calendar is added. */
	id: string;
	name: string;
	/** ICS feed URL. webcal:// and https://user:pass@host/... are accepted. */
	url: string;
	/** Dot color in the calendar view. */
	color: string;
	/** Fetch this calendar at all. */
	enabled: boolean;
	/** Create notes for this calendar's events automatically. */
	autoImport: boolean;
	/** Folder for event notes; empty uses the global default. */
	folder: string;
	/** Template file path; empty uses the global default. */
	template: string;
	/** File name pattern; empty uses the global default. */
	titlePattern: string;
	/** Ignore all-day events (birthdays, holidays, ...). */
	excludeAllDay: boolean;
}

export interface CalEvent {
	/**
	 * Identity of the note that belongs to this event. A one-off event keeps
	 * the same id when it is rescheduled; a recurring event gets one id per
	 * occurrence.
	 */
	id: string;
	uid: string;
	recurring: boolean;
	calendarId: string;
	title: string;
	start: Date;
	end: Date;
	allDay: boolean;
	location: string;
	description: string;
	organizer: string;
	attendees: string[];
	/** Detected Meet / Zoom / Teams / Webex link, or the first URL found. */
	meetingUrl: string;
}

export type FetchStatus =
	| { kind: "idle" }
	| { kind: "fetching" }
	| { kind: "ok"; at: number; count: number }
	| { kind: "error"; at: number; message: string };
