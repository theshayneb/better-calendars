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

	// Check-ins
	/** Foursquare Places API key (service key), for finding places. */
	fsqApiKey: string;
	/** Foursquare developer project, for signing in to Swarm. */
	swarmClientId: string;
	swarmClientSecret: string;
	/** Swarm access token; empty when not connected. */
	swarmToken: string;
	/** Display name of the connected Swarm account. */
	swarmUser: string;
	/** Folder of place notes. */
	placesFolder: string;
	/** Property holding "lat, lng" in place notes. */
	geolinkProperty: string;
	/** Daily note property listing the places of the day. */
	dailyPlacesProperty: string;
	/** Hide the fsq property in the Properties panel. */
	hideFsq: boolean;
	/** The tags offered as chips. */
	checkinTags: string[];
	/** Set once "nyc" has been added to checkinTags, so removing it sticks. */
	nycTagAdded: boolean;
	/** Tags every place note gets. */
	alwaysTags: string[];
	/** A tag that brings others along, e.g. pizza -> food. */
	impliedTags: Record<string, string[]>;
	/** Foursquare category id -> remembered tag; "" means "no tag for this category". */
	categoryTags: Record<string, { name: string; tag: string }>;
	/** Last place checked in (for searching near it on desktop). */
	lastLocation: { lat: number; lng: number } | null;
	/** Swarm check-ins waiting to be posted (no signal, Foursquare down). */
	swarmQueue: QueuedSwarmCheckin[];
	/** Swarm check-in ids made from Obsidian (so the history review skips them). */
	swarmPostedIds: string[];
	/** Swarm check-in ids already reviewed (saved or skipped) in "Catch up on Swarm history". */
	swarmReviewed: string[];
	/** Swarm check-in ids skipped in the review ("Bring skipped back" puts them in the queue again). */
	swarmSkipped: string[];
}

export interface QueuedSwarmCheckin {
	venueId: string;
	placeName: string;
	shout: string;
	/** When the check-in happened (ms). */
	at: number;
	/** The device that queued it; only that device retries, so it's never posted twice. */
	device: string;
	attempts: number;
	lastError: string;
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

	fsqApiKey: "",
	swarmClientId: "",
	swarmClientSecret: "",
	swarmToken: "",
	swarmUser: "",
	placesFolder: "Planning & Productivity/Travel",
	geolinkProperty: "Geolink",
	dailyPlacesProperty: "Places",
	hideFsq: true,
	checkinTags: ["dessert", "pizza", "tea", "food", "shopping", "sight", "museum", "activity", "outdoors", "nyc"],
	nycTagAdded: true,
	alwaysTags: ["place"],
	impliedTags: { pizza: ["food"], tea: ["food"], dessert: ["food"] },
	categoryTags: {},
	lastLocation: null,
	swarmQueue: [],
	swarmPostedIds: [],
	swarmReviewed: [],
	swarmSkipped: [],
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
