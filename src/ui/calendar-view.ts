import { ItemView, Menu, Notice, WorkspaceLeaf, moment, setIcon } from "obsidian";
import type { Moment } from "moment";
import type BetterCalendarsPlugin from "../main";
import { CalEvent } from "../types";
import { dailyNoteConfig, getDailyNote } from "../daily/daily-notes";

export const VIEW_TYPE_CALENDAR = "better-calendars-view";

export class CalendarView extends ItemView {
	/** First day of the month on screen. */
	private pwMonth: Moment = moment().startOf("month");
	private pwSelected: Moment = moment().startOf("day");
	private pwRenderQueued = false;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: BetterCalendarsPlugin
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_CALENDAR;
	}

	getDisplayText(): string {
		return "Calendar";
	}

	getIcon(): string {
		return "calendar-days";
	}

	async onOpen(): Promise<void> {
		const { app } = this;
		const rerender = () => this.pwQueueRender();
		this.registerEvent(app.vault.on("create", rerender));
		this.registerEvent(app.vault.on("delete", rerender));
		this.registerEvent(app.vault.on("rename", rerender));
		this.registerEvent(app.metadataCache.on("changed", rerender));
		this.register(this.plugin.manager.onChange(rerender));

		// Roll over to the new day after midnight.
		let shownDay = moment().format("YYYY-MM-DD");
		this.registerInterval(
			window.setInterval(() => {
				const now = moment().format("YYYY-MM-DD");
				if (now === shownDay) return;
				const wasOnToday = this.pwSelected.format("YYYY-MM-DD") === shownDay;
				shownDay = now;
				if (wasOnToday) {
					this.pwSelected = moment().startOf("day");
					this.pwMonth = moment().startOf("month");
				}
				this.pwRender();
			}, 60_000)
		);
		this.pwRender();
	}

	/** Re-render now (settings changed etc.). */
	refresh(): void {
		this.pwRender();
	}

	private pwQueueRender(): void {
		if (this.pwRenderQueued) return;
		this.pwRenderQueued = true;
		window.setTimeout(() => {
			this.pwRenderQueued = false;
			this.pwRender();
		}, 150);
	}

	private pwWeekStartDay(): number {
		switch (this.plugin.settings.weekStart) {
			case "sunday":
				return 0;
			case "monday":
				return 1;
			default:
				return moment.localeData().firstDayOfWeek();
		}
	}

	private pwRender(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("bc-view");

		this.pwRenderHeader(root);
		this.pwRenderGrid(root);
		this.pwRenderDay(root);
	}

	private pwRenderHeader(root: HTMLElement): void {
		const header = root.createDiv({ cls: "bc-header" });
		const title = header.createDiv({ cls: "bc-title" });
		title.createSpan({ cls: "bc-month", text: this.pwMonth.format("MMMM") });
		title.createSpan({ cls: "bc-year", text: ` ${this.pwMonth.format("YYYY")}` });

		const nav = header.createDiv({ cls: "bc-nav" });
		const prev = nav.createDiv({ cls: "bc-nav-btn clickable-icon", attr: { "aria-label": "Previous month" } });
		setIcon(prev, "chevron-left");
		prev.onclick = () => {
			this.pwMonth = this.pwMonth.clone().subtract(1, "month");
			this.pwRender();
		};
		const todayBtn = nav.createDiv({ cls: "bc-today-btn clickable-icon", text: "Today" });
		todayBtn.onclick = () => {
			this.pwMonth = moment().startOf("month");
			this.pwSelected = moment().startOf("day");
			this.pwRender();
		};
		const next = nav.createDiv({ cls: "bc-nav-btn clickable-icon", attr: { "aria-label": "Next month" } });
		setIcon(next, "chevron-right");
		next.onclick = () => {
			this.pwMonth = this.pwMonth.clone().add(1, "month");
			this.pwRender();
		};
	}

	private pwRenderGrid(root: HTMLElement): void {
		const settings = this.plugin.settings;
		const config = dailyNoteConfig(this.app, settings);
		const weekStart = this.pwWeekStartDay();
		const showWeeks = settings.showWeekNumbers;

		const table = root.createEl("table", { cls: "bc-grid" });
		const headRow = table.createEl("thead").createEl("tr");
		if (showWeeks) headRow.createEl("th", { cls: "bc-week-num", text: "W" });
		for (let i = 0; i < 7; i++) {
			const day = (weekStart + i) % 7;
			const th = headRow.createEl("th", {
				text: moment().day(day).format("dd"),
			});
			if (day === 0 || day === 6) th.addClass("bc-weekend");
		}

		// Events per day, for the dots.
		const colors = new Map(settings.calendars.map((c) => [c.id, c.color]));
		const dots = new Map<string, string[]>();
		for (const e of this.plugin.manager.allEvents()) {
			const last = moment(e.end).subtract(1, "ms");
			const d = moment(e.start).startOf("day");
			// Multi-day events show on each day (capped).
			for (let i = 0; i < 31 && d.isSameOrBefore(last, "day"); i++) {
				const key = d.format("YYYY-MM-DD");
				const list = dots.get(key) ?? [];
				list.push(colors.get(e.calendarId) ?? "var(--interactive-accent)");
				dots.set(key, list);
				d.add(1, "day");
			}
		}

		const offset = (this.pwMonth.day() - weekStart + 7) % 7;
		const cursor = this.pwMonth.clone().subtract(offset, "days");
		const todayKey = moment().format("YYYY-MM-DD");
		const selectedKey = this.pwSelected.format("YYYY-MM-DD");
		const body = table.createEl("tbody");

		for (let week = 0; week < 6; week++) {
			// Skip a 6th row that is entirely next month.
			if (week === 5 && !cursor.isSame(this.pwMonth, "month")) break;
			const row = body.createEl("tr");
			if (showWeeks) {
				row.createEl("td", { cls: "bc-week-num", text: cursor.format("w") });
			}
			for (let i = 0; i < 7; i++) {
				const date = cursor.clone();
				const key = date.format("YYYY-MM-DD");
				const cell = row.createEl("td", { cls: "bc-day" });
				if (!date.isSame(this.pwMonth, "month")) cell.addClass("bc-other-month");
				if (key === todayKey) cell.addClass("bc-today");
				if (key === selectedKey) cell.addClass("bc-selected");
				if (date.day() === 0 || date.day() === 6) cell.addClass("bc-weekend");

				cell.createDiv({ cls: "bc-day-num", text: date.format("D") });
				const marks = cell.createDiv({ cls: "bc-marks" });
				const note = getDailyNote(this.app, config, date);
				if (note) {
					cell.addClass("bc-has-note");
					marks.createSpan({ cls: "bc-note-dot", attr: { "aria-label": "Daily note" } });
				}
				const evDots = dots.get(key) ?? [];
				for (const color of evDots.slice(0, 3)) {
					const dot = marks.createSpan({ cls: "bc-event-dot" });
					dot.style.setProperty("--bc-dot", color);
				}
				if (evDots.length > 0) {
					cell.setAttr(
						"aria-label",
						`${evDots.length} event${evDots.length === 1 ? "" : "s"}`
					);
				}

				cell.addEventListener("click", (ev) => {
					this.pwSelected = date.clone();
					if (!date.isSame(this.pwMonth, "month")) {
						this.pwMonth = date.clone().startOf("month");
					}
					this.pwRender();
					void this.plugin.openDailyNote(date, ev.ctrlKey || ev.metaKey);
				});
				cell.addEventListener("contextmenu", (ev) => {
					ev.preventDefault();
					this.pwDayMenu(date, ev);
				});
				cursor.add(1, "day");
			}
		}
	}

	private pwDayMenu(date: Moment, ev: MouseEvent): void {
		const menu = new Menu();
		const config = dailyNoteConfig(this.app, this.plugin.settings);
		const note = getDailyNote(this.app, config, date);
		menu.addItem((item) =>
			item
				.setTitle("Show events")
				.setIcon("list")
				.onClick(() => {
					this.pwSelected = date.clone();
					this.pwRender();
				})
		);
		menu.addItem((item) =>
			item
				.setTitle(note ? "Open daily note in new tab" : "Create daily note")
				.setIcon(note ? "file-symlink" : "file-plus")
				.onClick(() => void this.plugin.openDailyNote(date, Boolean(note), true))
		);
		menu.showAtMouseEvent(ev);
	}

	private pwRenderDay(root: HTMLElement): void {
		const section = root.createDiv({ cls: "bc-day-section" });
		const head = section.createDiv({ cls: "bc-day-head" });
		head.createSpan({ cls: "bc-day-title", text: this.pwSelected.format("dddd, MMMM D") });

		const refresh = head.createDiv({
			cls: "bc-refresh clickable-icon",
			attr: {
				"aria-label": "Refresh calendars, import events and create daily notes ahead",
			},
		});
		setIcon(refresh, "refresh-cw");
		if (this.plugin.manager.isRefreshing()) refresh.addClass("bc-spinning");
		refresh.onclick = () => void this.plugin.refreshAndImport(true);

		const settings = this.plugin.settings;
		if (settings.calendars.length === 0) {
			section.createDiv({
				cls: "bc-empty",
				text: "No calendars yet. Add your Google calendar in the plugin settings.",
			});
			return;
		}

		const errors = settings.calendars.filter(
			(c) => c.enabled && this.plugin.manager.getStatus(c.id).kind === "error"
		);
		for (const c of errors) {
			const st = this.plugin.manager.getStatus(c.id);
			section.createDiv({
				cls: "bc-error",
				text: `${c.name}: ${st.kind === "error" ? st.message : ""}`,
			});
		}

		const events = this.plugin.manager.eventsOn(this.pwSelected.toDate());
		if (events.length === 0) {
			section.createDiv({ cls: "bc-empty", text: "No events." });
			return;
		}
		const list = section.createDiv({ cls: "bc-events" });
		for (const e of events) this.pwRenderEvent(list, e);
	}

	private pwRenderEvent(list: HTMLElement, e: CalEvent): void {
		const calendar = this.plugin.importer.calendarFor(e);
		const note = this.plugin.importer.findNote(e);
		const row = list.createDiv({ cls: "bc-event" });
		if (note) row.addClass("bc-event-has-note");
		if (e.end.getTime() < Date.now()) row.addClass("bc-event-past");
		const dot = row.createSpan({ cls: "bc-event-dot" });
		dot.style.setProperty("--bc-dot", calendar?.color ?? "var(--interactive-accent)");
		row.createSpan({
			cls: "bc-event-time",
			text: e.allDay
				? "All day"
				: `${moment(e.start).format("LT")}`,
		});
		row.createSpan({ cls: "bc-event-title", text: e.title });
		const icon = row.createSpan({ cls: "bc-event-icon" });
		setIcon(icon, note ? "file-text" : "file-plus");
		row.setAttr(
			"aria-label",
			note ? `Open note: ${note.basename}` : "Create a note for this event"
		);
		row.onclick = (ev) => {
			void this.plugin.importer
				.openOrCreate(e, ev.ctrlKey || ev.metaKey)
				.catch((err) => {
					console.warn("[Better Calendars] event note failed", err);
					new Notice("Better Calendars: could not create the event note.");
				});
		};
		if (e.meetingUrl) {
			row.addEventListener("contextmenu", (ev) => {
				ev.preventDefault();
				const menu = new Menu();
				menu.addItem((item) =>
					item
						.setTitle("Open meeting link")
						.setIcon("external-link")
						.onClick(() => window.open(e.meetingUrl, "_blank"))
				);
				menu.showAtMouseEvent(ev);
			});
		}
	}
}
