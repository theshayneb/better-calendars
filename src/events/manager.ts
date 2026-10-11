import { moment } from "obsidian";
import { CalEvent, CalendarSource, FetchStatus } from "../types";
import { fetchICS } from "./fetcher";
import { parseICS } from "./parser";

/** How far back / ahead events are loaded for the calendar view. */
const VIEW_DAYS_BACK = 45;
const VIEW_DAYS_AHEAD = 120;

/** Fetches and holds the events of every enabled calendar. */
export class CalendarManager {
	private events = new Map<string, CalEvent[]>();
	private status = new Map<string, FetchStatus>();
	private listeners = new Set<() => void>();
	private running: Promise<void> | null = null;

	constructor(
		private readonly getCalendars: () => CalendarSource[],
		private readonly getImportWindow: () => { back: number; ahead: number }
	) {}

	onChange(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private emit(): void {
		for (const fn of this.listeners) {
			try {
				fn();
			} catch (e) {
				console.warn("[Better Calendars] listener failed", e);
			}
		}
	}

	getStatus(calendarId: string): FetchStatus {
		return this.status.get(calendarId) ?? { kind: "idle" };
	}

	isRefreshing(): boolean {
		return this.running !== null;
	}

	/** All loaded events from enabled calendars, sorted by start. */
	allEvents(): CalEvent[] {
		const enabled = new Set(
			this.getCalendars().filter((c) => c.enabled).map((c) => c.id)
		);
		const out: CalEvent[] = [];
		for (const [id, list] of this.events) {
			if (enabled.has(id)) out.push(...list);
		}
		return out.sort((a, b) => a.start.getTime() - b.start.getTime());
	}

	/** Events overlapping the given local day. */
	eventsOn(day: Date): CalEvent[] {
		const start = moment(day).startOf("day").toDate();
		const end = moment(day).endOf("day").toDate();
		return this.allEvents().filter((e) => e.start <= end && e.end > start);
	}

	forget(calendarId: string): void {
		this.events.delete(calendarId);
		this.status.delete(calendarId);
		this.emit();
	}

	/** Refresh every enabled calendar. Concurrent calls share one run. */
	refreshAll(): Promise<void> {
		if (this.running) return this.running;
		this.running = this.doRefresh().finally(() => {
			this.running = null;
			this.emit();
		});
		return this.running;
	}

	private async doRefresh(): Promise<void> {
		const calendars = this.getCalendars().filter(
			(c) => c.enabled && c.url.trim()
		);
		for (const c of calendars) this.status.set(c.id, { kind: "fetching" });
		this.emit();

		const { back, ahead } = this.getImportWindow();
		const windowStart = moment()
			.startOf("day")
			.subtract(Math.max(back, VIEW_DAYS_BACK), "days")
			.toDate();
		const windowEnd = moment()
			.startOf("day")
			.add(Math.max(ahead, VIEW_DAYS_AHEAD) + 1, "days")
			.toDate();

		await Promise.all(
			calendars.map(async (calendar) => {
				try {
					const { body } = await fetchICS(calendar.url, {
						timeoutMs: 20_000,
					});
					const events = parseICS(body, {
						calendar,
						windowStart,
						windowEnd,
					});
					this.events.set(calendar.id, events);
					this.status.set(calendar.id, {
						kind: "ok",
						at: Date.now(),
						count: events.length,
					});
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					console.warn(
						`[Better Calendars] could not load "${calendar.name}"`,
						e
					);
					// Keep the last good events on a failed refresh.
					this.status.set(calendar.id, {
						kind: "error",
						at: Date.now(),
						message,
					});
				}
			})
		);
	}
}
