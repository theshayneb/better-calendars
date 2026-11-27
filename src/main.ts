import { Notice, Platform, Plugin, TAbstractFile, WorkspaceLeaf, apiVersion, moment } from "obsidian";
import { DiagnosticsModal } from "./ui/diagnostics";
import type { Moment } from "moment";
import { BetterCalendarsSettings, DEFAULT_SETTINGS, normalizeSettings } from "./settings";
import { Data, clone, sameData, syncStep } from "./sync/merge";
import { SyncSettle } from "./sync/settle";
import {
	BACKGROUND_KEY,
	LAST_LOCATION_KEY,
	LAST_RUN_KEY,
	LEGACY_IMPORT_KEY,
	backgroundOn,
} from "./sync/background";
import { BetterCalendarsSettingTab } from "./settings-tab";
import { CalendarManager } from "./events/manager";
import { EventImporter, EventNoteIndex } from "./events/importer";
import { CalendarView, VIEW_TYPE_CALENDAR } from "./ui/calendar-view";
import { ConfirmModal, CreateAheadModal } from "./ui/modals";
import { openLocationTest } from "./checkins/location";
import { openCheckin } from "./checkins/checkin-modal";
import { openReview } from "./checkins/review-modal";
import { loadHistory, refreshHistory } from "./checkins/history";
import { pendingCheckins } from "./checkins/history-logic";
import { finishSwarmConnect, retrySwarmQueue } from "./checkins/swarm";
import {
	createDailyNote,
	createDailyNotesAhead,
	dailyNoteConfig,
	getDailyNote,
	invalidateDailyNoteIndex,
	today,
} from "./daily/daily-notes";

/** While Sync hasn't settled, look again this often. */
const SETTLE_RETRY_MS = 60_000;
/** Settings changes from disk are handled this long after the last one of a burst. */
const EXTERNAL_CHANGE_DELAY_MS = 2000;
/** More writes than this in a minute in answer to changes from disk means devices are bouncing. */
const MAX_EXTERNAL_WRITES_PER_MINUTE = 5;
/** A settings file read or write that takes longer than this is given up on. */
const FILE_TIMEOUT_MS = 30_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = window.setTimeout(() => reject(new Error(`took longer than ${ms / 1000} s`)), ms);
		p.then(
			(v) => {
				window.clearTimeout(timer);
				resolve(v);
			},
			(e: unknown) => {
				window.clearTimeout(timer);
				reject(e instanceof Error ? e : new Error(String(e)));
			}
		);
	});
}

export default class BetterCalendarsPlugin extends Plugin {
	settings!: BetterCalendarsSettings;
	manager!: CalendarManager;
	settingTab: BetterCalendarsSettingTab | null = null;
	importer!: EventImporter;
	settle!: SyncSettle;
	private refreshTimer: number | null = null;
	private settleTimer: number | null = null;
	private working = false;
	/** The settings as last read from or written to disk; edits are what differs from it. */
	private baseline: Data = {};
	/** Settings reads and writes run one at a time. */
	private syncChain: Promise<unknown> = Promise.resolve();
	private pendingSync: Promise<boolean> | null = null;
	private externalTimer: number | null = null;
	/** How many times data.json was written (for the safety valve). */
	private settingsWrites = 0;
	private externalWrites: number[] = [];
	private quietUntil = 0;
	/** Errors worth reporting (newest last), for "Show diagnostics". Kept in memory only. */
	private problems: { at: number; where: string; message: string; stack: string }[] = [];
	private settingsOpened: number[] = [];

	async onload(): Promise<void> {
		await this.loadSettings();
		this.applyHideEventId();
		// The daily note lookup keeps an index of note names.
		for (const ev of ["create", "delete", "rename"] as const) {
			this.registerEvent(this.app.vault.on(ev as "create", () => invalidateDailyNoteIndex()));
		}
		// Background work waits until Obsidian Sync has caught up.
		this.settle = new SyncSettle(this.app);
		for (const ev of ["create", "modify", "delete", "rename"] as const) {
			this.registerEvent(
				this.app.vault.on(ev as "rename", (file: TAbstractFile, oldPath?: string) =>
					this.settle.onVaultChange(file, oldPath)
				)
			);
		}
		this.registerDomEvent(document, "visibilitychange", () => {
			this.settle.onVisibilityChange(document.hidden);
			// Going to the background (phones): save what the settings tab still holds.
			if (document.hidden) this.settingTab?.pwSaveNow();
		});
		this.registerDomEvent(window, "online", () => this.settle.onOnline());

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
			name: "Refresh calendars, import events and create daily notes ahead",
			callback: () => void this.refreshAndImport(true),
		});
		this.addCommand({
			id: "test-location",
			name: "Test location (GPS)",
			callback: () => openLocationTest(this.app),
		});

		this.addCommand({
			id: "show-diagnostics",
			name: "Show diagnostics",
			callback: () => new DiagnosticsModal(this.app, this.diagnostics()).open(),
		});
		// Errors from this plugin that nothing else caught (no console on phones).
		const mine = (stack: string) => /better-calendars/i.test(stack);
		this.registerDomEvent(window, "error", (ev: ErrorEvent) => {
			const err: unknown = ev.error;
			const stack = err instanceof Error ? (err.stack ?? "") : `${ev.filename ?? ""}`;
			if (mine(stack)) this.recordProblem("Uncaught error", err ?? ev.message);
		});
		this.registerDomEvent(window, "unhandledrejection", (ev: PromiseRejectionEvent) => {
			const err: unknown = ev.reason;
			if (err instanceof Error && mine(err.stack ?? "")) this.recordProblem("Unhandled promise", err);
		});

		this.settingTab = new BetterCalendarsSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		// Check-ins
		this.addRibbonIcon("map-pin", "Check in", () => openCheckin(this));
		this.addCommand({
			id: "check-in",
			name: "Check in",
			callback: () => openCheckin(this),
		});
		this.addCommand({
			id: "swarm-history",
			name: "Catch up on Swarm history",
			callback: () => openReview(this),
		});
		this.registerObsidianProtocolHandler("better-calendars-swarm", (params) => {
			void finishSwarmConnect(this, params);
		});
		// obsidian://better-calendars-checkin opens the check-in screen (for Tasker, shortcuts, links).
		this.registerObsidianProtocolHandler("better-calendars-checkin", () => {
			this.app.workspace.onLayoutReady(() => openCheckin(this));
		});

		this.app.workspace.onLayoutReady(() => {
			if (this.settings.openOnStartup) void this.activateView(false);
			// Load events for the view right away; background work waits for Sync to settle.
			void this.refreshAndImport(false);
			this.scheduleRefresh();
		});
	}

	onunload(): void {
		document.body.removeClass("bc-hide-event-id");
		document.body.removeClass("bc-hide-fsq");
		if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
		if (this.externalTimer !== null) window.clearTimeout(this.externalTimer);
		if (this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
	}

	async loadSettings(): Promise<void> {
		const raw = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		this.settings = normalizeSettings(raw);
		this.baseline = clone(this.settings) as unknown as Data;
		// Before 1.4.0 the last check-in place was in the synced settings.
		const loc = raw.lastLocation as { lat?: unknown; lng?: unknown } | null | undefined;
		if (loc && typeof loc.lat === "number" && typeof loc.lng === "number" && !this.app.loadLocalStorage(LAST_LOCATION_KEY)) {
			this.app.saveLocalStorage(LAST_LOCATION_KEY, { lat: loc.lat, lng: loc.lng });
		}
	}

	/** Save: re-read data.json, merge this device's edits into it, and write only if that changed it. */
	async saveSettings(): Promise<void> {
		await this.syncSettings();
	}

	/** Obsidian calls this when data.json changed on disk (Obsidian Sync brought another device's copy). */
	/**
	 * Obsidian calls this when data.json changed on disk (Sync brought another
	 * device's copy, or, on some phones, our own write). Bursts are handled
	 * once, a couple of seconds after the last one.
	 */
	onExternalSettingsChange(): void {
		if (this.externalTimer !== null) window.clearTimeout(this.externalTimer);
		this.externalTimer = window.setTimeout(() => {
			this.externalTimer = null;
			void this.handleExternalSettings();
		}, EXTERNAL_CHANGE_DELAY_MS);
	}

	private async handleExternalSettings(): Promise<void> {
		// Safety valve: if the file keeps changing and this device keeps answering
		// with writes, something is bouncing between devices. Stop answering for a while.
		const now = Date.now();
		this.externalWrites = this.externalWrites.filter((t) => now - t < 60_000);
		if (now < this.quietUntil) return;
		if (this.externalWrites.length >= MAX_EXTERNAL_WRITES_PER_MINUTE) {
			this.quietUntil = now + 10 * 60_000;
			console.warn("[Better Calendars] the settings file keeps changing; not answering for 10 minutes");
			return;
		}
		const minutes = this.settings.refreshMinutes;
		const calendars = JSON.stringify(this.settings.calendars);
		const writesBefore = this.settingsWrites;
		const changed = await this.syncSettings();
		if (this.settingsWrites > writesBefore) this.externalWrites.push(Date.now());
		if (!changed) return;
		this.applyHideEventId();
		if (minutes !== this.settings.refreshMinutes) this.scheduleRefresh();
		if (calendars !== JSON.stringify(this.settings.calendars)) {
			void this.manager.refreshAll();
		}
		this.refreshViews();
		// The settings page isn't redrawn under you (a phone can get changes in bursts);
		// it says so, and shows them the next time it's opened.
		this.settingTab?.pwChangedElsewhere();
	}

	/**
	 * Merge memory with data.json (read, merge, write). Edits made here since
	 * the last sync get the current time; per setting and per entry the
	 * newest edit wins (see sync/merge.ts). Writes only when the merge
	 * changed what's on disk. Returns true when memory changed.
	 */
	syncSettings(): Promise<boolean> {
		// A run that hasn't started yet covers every edit made before it starts: join it.
		if (this.pendingSync) return this.pendingSync;
		const run = this.syncChain.then(() => {
			this.pendingSync = null;
			return this.doSyncSettings();
		});
		this.pendingSync = run;
		this.syncChain = run.catch(() => undefined);
		return run;
	}

	private async doSyncSettings(): Promise<boolean> {
		const mine = this.settings as unknown as Data;
		let raw: unknown;
		try {
			raw = await withTimeout(this.loadData(), FILE_TIMEOUT_MS);
		} catch (e) {
			// Half-written by Sync, say. Keep memory; the next save merges again.
			console.warn("[Better Calendars] could not read the settings file; not saving now", e);
			return false;
		}
		const disk = normalizeSettings(raw ?? {}) as unknown as Data;
		// Nothing changed here or on disk since the last sync: nothing to do.
		if (sameData(disk, this.baseline) && sameData(mine, this.baseline)) return false;
		const { write, merged, memoryChanged: changed } = syncStep(mine, this.baseline, disk, Date.now());
		// Update memory before writing, so an edit made while the file is being written isn't overwritten.
		if (changed) {
			for (const key of Object.keys(mine)) if (!(key in merged)) delete mine[key];
			Object.assign(mine, merged);
		}
		this.baseline = clone(merged);
		if (write) {
			this.settingsWrites++;
			try {
				await withTimeout(this.saveData(write), FILE_TIMEOUT_MS);
			} catch (e) {
				// Stuck file call (seen on phones): don't hold up later saves; the next one writes again.
				console.warn("[Better Calendars] saving the settings took too long", e);
			}
		}
		return changed;
	}

	lastLocation(): { lat: number; lng: number } | null {
		const v = this.app.loadLocalStorage(LAST_LOCATION_KEY) as { lat?: unknown; lng?: unknown } | null;
		return v && typeof v.lat === "number" && typeof v.lng === "number" ? { lat: v.lat, lng: v.lng } : null;
	}

	setLastLocation(loc: { lat: number; lng: number }): void {
		this.app.saveLocalStorage(LAST_LOCATION_KEY, loc);
	}

	/**
	 * Pull check-ins made in the Swarm app into the review queue (background
	 * work), only once the history has been loaded on this device (the
	 * first, full load happens when you open the review).
	 */
	private async pullSwarmCheckins(): Promise<void> {
		const s = this.settings;
		if (!s.swarmToken) return;
		try {
			if ((await loadHistory(this)).length === 0) return;
			const { history, added } = await refreshHistory(this);
			if (added === 0) return;
			const fresh = pendingCheckins(
				history.slice(0, added),
				[...s.swarmReviewed, ...s.swarmSkipped],
				s.swarmPostedIds,
				s.swarmSkippedPlaces
			);
			if (fresh.length > 0) {
				new Notice(
					`Better Calendars: ${fresh.length} new Swarm check-in${fresh.length === 1 ? "" : "s"} to review (Catch up on Swarm history).`
				);
			}
		} catch (e) {
			console.warn("[Better Calendars] pulling Swarm check-ins failed", e);
		}
	}

	recordProblem(where: string, e: unknown): void {
		const err = e instanceof Error ? e : new Error(String(e));
		console.warn(`[Better Calendars] ${where}`, err);
		this.problems.push({ at: Date.now(), where, message: err.message, stack: err.stack ?? "" });
		if (this.problems.length > 20) this.problems.shift();
	}

	noteSettingsOpened(): void {
		this.settingsOpened.push(Date.now());
		if (this.settingsOpened.length > 10) this.settingsOpened.shift();
	}

	/** Plain-text report for "Show diagnostics". No keys, tokens or note contents. */
	diagnostics(): string {
		const s = this.settings as unknown as Record<string, unknown>;
		const t = (ms: number) => (ms ? moment(ms).format("YYYY-MM-DD HH:mm:ss") : "never");
		const size = (v: unknown) =>
			Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0;
		let bytes = 0;
		try {
			bytes = JSON.stringify(this.settings).length;
		} catch (e) {
			this.recordProblem("Measuring settings", e);
		}
		const lines = [
			`Better Calendars ${this.manifest.version}, Obsidian ${apiVersion}`,
			`Device: ${Platform.isAndroidApp ? "Android" : Platform.isIosApp ? "iOS" : Platform.isDesktopApp ? "desktop" : "other"}${Platform.isTablet ? " tablet" : Platform.isPhone ? " phone" : ""}`,
			`Now: ${t(Date.now())}`,
			`Background tasks here: ${this.backgroundOnThisDevice() ? "on" : "off"}; ${this.settle?.describe() ?? "no sync tracker"}; last run ${t(this.lastBackgroundRun())}`,
			`Settings page registered: ${this.settingTab ? "yes" : "no"}; drawn ${this.settingsOpened.length} time(s) this session${this.settingsOpened.length ? `, last ${t(this.settingsOpened[this.settingsOpened.length - 1] ?? 0)}` : ""}`,
			`Settings file writes this session: ${this.settingsWrites}; pausing answers until ${t(this.quietUntil)}`,
			`Settings size: ${Math.round(bytes / 1024)} KB`,
			...[
				"calendars", "imported", "noteNames", "peopleAdded", "categoryTags", "impliedTags",
				"checkinTags", "ratingOptions", "swarmReviewed", "swarmPostedIds", "swarmSkipped",
				"swarmSkippedPlaces", "swarmQueue",
			].map((k) => `  ${k}: ${size(s[k])}${s[k] !== undefined && typeof s[k] !== "object" ? ` (not a list: ${typeof s[k]})` : ""}`),
			`Unknown keys: ${Object.keys(s).filter((k) => !(k in DEFAULT_SETTINGS) && k !== "_sync").join(", ") || "none"}`,
			"",
			this.problems.length === 0 ? "Problems: none recorded this session." : "Problems (newest last):",
			...this.problems.map(
				(p) => `- ${t(p.at)} ${p.where}: ${p.message}\n${p.stack.split("\n").slice(0, 8).join("\n")}`
			),
		];
		return lines.join("\n");
	}

	/** Redraw the settings tab if it is open (e.g. after Swarm sign-in). */
	refreshSettingsTab(): void {
		if (this.settingTab?.containerEl.isShown()) this.settingTab.display();
	}

	applyHideEventId(): void {
		document.body.toggleClass("bc-hide-fsq", this.settings.hideFsq);
		document.body.toggleClass("bc-hide-event-id", this.settings.hideEventId);
	}

	/** "Run background tasks on this device" (stored per device, never synced). */
	backgroundOnThisDevice(): boolean {
		return backgroundOn(
			this.app.loadLocalStorage(BACKGROUND_KEY),
			this.app.loadLocalStorage(LEGACY_IMPORT_KEY),
			Platform.isDesktopApp
		);
	}

	setBackgroundOnThisDevice(on: boolean): void {
		this.app.saveLocalStorage(BACKGROUND_KEY, on ? "on" : "off");
		if (on) this.runBackgroundWhenSettled();
	}

	/** When background work last ran on this device (ms), or 0. */
	lastBackgroundRun(): number {
		const v: unknown = this.app.loadLocalStorage(LAST_RUN_KEY);
		return typeof v === "number" ? v : 0;
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
	 * Fetch all calendars (for the view, on every device). `manual` (you
	 * asked for it) then imports events and creates daily notes ahead right
	 * away; otherwise that only happens as background work: on the device
	 * with "Run background tasks on this device", once Sync has settled.
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
		// Check-ins you made on this device that couldn't be posted yet.
		try {
			await retrySwarmQueue(this);
		} catch (e) {
			console.warn("[Better Calendars] Swarm retry failed", e);
		}
		if (manual) await this.runWork(true);
		else this.runBackgroundWhenSettled();
	}

	/** Background work, if this device does it, as soon as Sync has settled (looked at again every minute). */
	runBackgroundWhenSettled(): void {
		if (!this.backgroundOnThisDevice()) return;
		if (this.settleTimer !== null) {
			window.clearTimeout(this.settleTimer);
			this.settleTimer = null;
		}
		if (!this.settle.settled()) {
			this.settleTimer = window.setTimeout(() => {
				this.settleTimer = null;
				this.runBackgroundWhenSettled();
			}, SETTLE_RETRY_MS);
			return;
		}
		void this.runWork(false);
	}

	private async runWork(manual: boolean): Promise<void> {
		if (this.working) return;
		this.working = true;
		let deferred = false;
		try {
			// Start from what's on disk, so nothing another device recorded is missed.
			await this.syncSettings();
			if (manual || this.settings.autoImport) {
				try {
					const result = await this.importer.importNow(!manual);
					deferred = result.deferred;
					const { created, skipped, inWindow } = result;
					if (created > 0 || manual) {
						const days = this.settings.importDaysAhead;
						let msg =
							inWindow === 0
								? `no events in the next ${days} day${days === 1 ? "" : "s"}.`
								: `${created} new event note${created === 1 ? "" : "s"}.`;
						if (skipped > 0) {
							msg += ` ${skipped} event${skipped === 1 ? " was" : "s were"} skipped because ${skipped === 1 ? "its note was" : "their notes were"} created before (deleted since, or not synced here yet); use "Forget import history" in the settings to create them again, or click the event in the calendar.`;
						}
						new Notice(`Better Calendars: ${msg}`, skipped > 0 ? 10_000 : undefined);
					}
				} catch (e) {
					console.warn("[Better Calendars] import failed", e);
					if (manual) new Notice("Better Calendars: import failed, see the console.");
				}
			}
			if (!deferred && (manual || this.settle.settled())) await this.autoCreateDailyNotes();
			await this.pullSwarmCheckins();
			if (!manual) this.app.saveLocalStorage(LAST_RUN_KEY, Date.now());
		} finally {
			this.working = false;
			this.refreshViews();
		}
		// Sync got busy halfway: finish once it has settled again.
		if (deferred) this.runBackgroundWhenSettled();
	}

	/** Keep daily notes for today + N days ahead, if that is turned on. */
	async autoCreateDailyNotes(): Promise<void> {
		const days = this.settings.dailyAutoCreateDays;
		if (days <= 0) return;
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
