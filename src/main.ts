import { Notice, Plugin, WorkspaceLeaf, moment } from "obsidian";
import type { Moment } from "moment";
import {
	BetterCalendarsSettings,
	DEFAULT_SETTINGS,
	normalizeCalendar,
} from "./settings";
import { BetterCalendarsSettingTab } from "./settings-tab";
import { CalendarManager } from "./events/manager";
import { EventImporter, EventNoteIndex } from "./events/importer";
import { CalendarView, VIEW_TYPE_CALENDAR } from "./ui/calendar-view";
import { ConfirmModal, CreateAheadModal } from "./ui/modals";
import {
	createDailyNote,
	createDailyNotesAhead,
	dailyNoteConfig,
	getDailyNote,
	today,
} from "./daily/daily-notes";

/** Wait this long after startup before creating notes, so sync can deliver other devices' notes first. */
const STARTUP_IMPORT_DELAY_MS = 30_000;
const LOCAL_IMPORT_KEY = "better-calendars-import-here";

export default class BetterCalendarsPlugin extends Plugin {
	settings!: BetterCalendarsSettings;
	manager!: CalendarManager;
	importer!: EventImporter;
	private refreshTimer: number | null = null;
	private startupDone = false;
	private startupTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.applyHideEventId();

		this.manager = new CalendarManager(
			() => this.settings.calendars,
			() => ({
				back: this.settings.importDaysBack,
				ahead: this.settings.importDaysAhead,
			})
		);
		this.importer = new EventImporter(this, new EventNoteIndex(this));

		this.registerView(
			VIEW_TYPE_CALENDAR,
			(leaf: WorkspaceLeaf) => new CalendarView(leaf, this)
		);
		this.addRibbonIcon("calendar-days", "Open calendar", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-calendar",
			name: "Open calendar",
			callback: () => void this.activateView(),
		});
		this.addCommand({
			id: "create-daily-notes-ahead",
			name: "Create daily notes in advance",
			callback: () => new CreateAheadModal(this.app, this).open(),
		});
		this.addCommand({
			id: "open-tomorrow",
			name: "Open tomorrow's daily note",
			callback: () => void this.openDailyNote(today().add(1, "day"), false, true),
		});
		this.addCommand({
			id: "refresh-and-import",
			name: "Refresh calendars and import events",
			callback: () => void this.refreshAndImport(true),
		});

		this.addSettingTab(new BetterCalendarsSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			if (this.settings.openOnStartup) void this.activateView(false);
			// Load events for the view right away; create notes a bit later.
			void this.manager.refreshAll();
			this.startupTimer = window.setTimeout(() => {
				this.startupTimer = null;
				this.startupDone = true;
				void this.refreshAndImport(false);
			}, STARTUP_IMPORT_DELAY_MS);
			this.scheduleRefresh();
		});
	}

	onunload(): void {
		document.body.removeClass("bc-hide-event-id");
		if (this.startupTimer !== null) window.clearTimeout(this.startupTimer);
		if (this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
	}

	async loadSettings(): Promise<void> {
		const loaded = ((await this.loadData()) ?? {}) as Partial<BetterCalendarsSettings>;
		this.settings = {
			...DEFAULT_SETTINGS,
			...loaded,
			calendars: (Array.isArray(loaded.calendars) ? loaded.calendars : []).map(
				normalizeCalendar
			),
			imported: { ...(loaded.imported ?? {}) },
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	applyHideEventId(): void {
		document.body.toggleClass("bc-hide-event-id", this.settings.hideEventId);
	}

	importsOnThisDevice(): boolean {
		return this.app.loadLocalStorage(LOCAL_IMPORT_KEY) !== "off";
	}

	setImportsOnThisDevice(on: boolean): void {
		this.app.saveLocalStorage(LOCAL_IMPORT_KEY, on ? null : "off");
	}

	scheduleRefresh(): void {
		if (this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
		const minutes = Math.max(5, this.settings.refreshMinutes || 30);
		this.refreshTimer = window.setInterval(
			() => void this.refreshAndImport(false),
			minutes * 60_000
		);
		this.registerInterval(this.refreshTimer);
	}

	/**
	 * Fetch all calendars, then (if allowed) import new events and create
	 * daily notes ahead. `manual` runs regardless of the automatic settings
	 * and reports the result.
	 */
	async refreshAndImport(manual: boolean): Promise<void> {
		await this.manager.refreshAll();
		this.refreshViews();

		const failed = this.settings.calendars.filter(
			(c) => c.enabled && this.manager.getStatus(c.id).kind === "error"
		);
		if (manual && failed.length > 0) {
			new Notice(
				`Better Calendars: could not load ${failed.map((c) => c.name).join(", ")}.`
			);
		}

		const auto = this.startupDone && this.importsOnThisDevice();
		if (manual || (auto && this.settings.autoImport)) {
			try {
				const { created, skipped, inWindow } = await this.importer.importNow();
				if (created > 0 || manual) {
					const days = this.settings.importDaysAhead;
					let msg =
						inWindow === 0
							? `no events in the next ${days} day${days === 1 ? "" : "s"}.`
							: `${created} new event note${created === 1 ? "" : "s"}.`;
					if (skipped > 0) {
						msg += ` ${skipped} event${skipped === 1 ? " was" : "s were"} skipped because ${skipped === 1 ? "its note was" : "their notes were"} deleted earlier; use "Forget import history" in the settings to create them again, or click the event in the calendar.`;
					}
					new Notice(`Better Calendars: ${msg}`, skipped > 0 ? 10_000 : undefined);
				}
			} catch (e) {
				console.warn("[Better Calendars] import failed", e);
				if (manual) new Notice("Better Calendars: import failed, see the console.");
			}
		}
		if (manual || auto) await this.autoCreateDailyNotes();
		this.refreshViews();
	}

	/** Keep daily notes for today + N days ahead, if that is turned on. */
	async autoCreateDailyNotes(): Promise<void> {
		const days = this.settings.dailyAutoCreateDays;
		if (days <= 0 || !this.importsOnThisDevice()) return;
		try {
			await createDailyNotesAhead(this.app, this.settings, today(), days + 1);
		} catch (e) {
			console.warn("[Better Calendars] creating daily notes failed", e);
		}
	}

	async createDailyNotesAhead(from: Moment, days: number, report: boolean): Promise<void> {
		try {
			const created = await createDailyNotesAhead(this.app, this.settings, from, days);
			if (report) {
				new Notice(
					`Better Calendars: created ${created} daily note${created === 1 ? "" : "s"}.`
				);
			}
		} catch (e) {
			console.warn("[Better Calendars] creating daily notes failed", e);
			new Notice("Better Calendars: could not create the daily notes, see the console.");
		}
	}

	/** Open the daily note for `date`, creating it (from the template) if needed. */
	async openDailyNote(date: Moment, newTab: boolean, skipConfirm = false): Promise<void> {
		const config = dailyNoteConfig(this.app, this.settings);
		const existing = getDailyNote(this.app, config, date);
		if (existing) {
			await this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(existing);
			return;
		}
		const create = async () => {
			try {
				const file = await createDailyNote(this.app, this.settings, date);
				await this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(file);
			} catch (e) {
				console.warn("[Better Calendars] could not create daily note", e);
				new Notice("Better Calendars: could not create the daily note, see the console.");
			}
		};
		if (this.settings.confirmBeforeCreate && !skipConfirm) {
			new ConfirmModal(
				this.app,
				"New daily note",
				`Create the daily note for ${moment(date).format("dddd, LL")}?`,
				"Create",
				() => void create()
			).open();
		} else {
			await create();
		}
	}

	async activateView(reveal = true): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)[0];
		if (existing) {
			if (reveal) await workspace.revealLeaf(existing);
			return;
		}
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_CALENDAR, active: reveal });
		if (reveal) await workspace.revealLeaf(leaf);
	}

	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)) {
			if (leaf.view instanceof CalendarView) leaf.view.refresh();
		}
	}
}
