import { App, Modal, Notice, Platform, moment } from "obsidian";
import { TagPicker } from "./tag-picker";
import type BetterCalendarsPlugin from "../main";
import { createDailyNote, dailyNoteConfig, getDailyNote, today } from "../daily/daily-notes";
import { FoursquareError, searchPlaces } from "./foursquare";
import { DeviceLocation, getDeviceLocation } from "./location";
import {
	FsqPlace,
	LatLng,
	PlaceNoteInfo,
	distanceMetres,
	matchPlaceNote,
	swarmShout,
	visitEntry,
} from "./logic";
import { addPlaceToDailyNote, listPlaceNotes, recordVisit } from "./place-notes";
import { postToSwarm } from "./swarm";

/** A better GPS fix is worth waiting for this long after the first one. */
const REFINE_MS = 8000;
/** Search again when a better fix is this far from the one we searched with. */
const RESEARCH_METRES = 60;

/** Asks a yes/no question; resolves true for the first button. */
export function ask(app: App, title: string, text: string, yes: string, no: string): Promise<boolean> {
	return new Promise((resolve) => {
		let answered = false;
		const modal = new (class extends Modal {
			onOpen(): void {
				this.setTitle(title);
				this.contentEl.createEl("p", { text });
				const row = this.contentEl.createDiv({ cls: "bc-ci-actions" });
				const noBtn = row.createEl("button", { text: no });
				const yesBtn = row.createEl("button", { text: yes, cls: "mod-cta" });
				noBtn.onclick = () => {
					answered = true;
					resolve(false);
					this.close();
				};
				yesBtn.onclick = () => {
					answered = true;
					resolve(true);
					this.close();
				};
			}
			onClose(): void {
				this.contentEl.empty();
				if (!answered) resolve(false);
			}
		})(app);
		modal.open();
	});
}

export class CheckinModal extends Modal {
	private pwNotes: PlaceNoteInfo[] = [];
	private pwPlaces: FsqPlace[] = [];
	private pwLocation: DeviceLocation | null = null;
	private pwSearchedAt: LatLng | null = null;
	private pwQuery = "";
	private pwStatus = "";
	private pwSearchTimer: number | null = null;
	private pwWatchId: number | null = null;
	private pwSearchSeq = 0;
	private pwListEl: HTMLElement | null = null;
	private pwStatusEl: HTMLElement | null = null;

	constructor(private readonly plugin: BetterCalendarsPlugin) {
		super(plugin.app);
	}

	onOpen(): void {
		this.modalEl.addClass("bc-ci-modal");
		this.pwNotes = listPlaceNotes(this.app, this.plugin.settings);
		const key = this.plugin.settings.fsqApiKey.trim();
		if (!key || key === this.plugin.settings.swarmClientSecret.trim()) {
			this.setTitle("Check in");
			this.contentEl.createEl("p", {
				text: key
					? "The Service API key setting holds your Client Secret. Place search needs a Service API Key: see Settings → Better Calendars → Check-ins."
					: "Add your Foursquare Service API Key under Settings → Better Calendars → Check-ins first.",
			});
			return;
		}
		this.pwShowList();
		if (Platform.isMobile) this.pwLocate();
		else this.pwSetStatus("Search places by name.");
	}

	onClose(): void {
		this.pwStopWatching();
		if (this.pwSearchTimer !== null) window.clearTimeout(this.pwSearchTimer);
		this.contentEl.empty();
	}

	// ----- Step 1: the list -----

	private pwShowList(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle("Check in");
		const input = contentEl.createEl("input", {
			cls: "bc-ci-search",
			attr: {
				type: "search",
				placeholder: Platform.isMobile ? "Search nearby" : "Search places by name",
				"aria-label": "Search places",
			},
		});
		input.value = this.pwQuery;
		input.addEventListener("input", () => {
			this.pwQuery = input.value;
			if (this.pwSearchTimer !== null) window.clearTimeout(this.pwSearchTimer);
			this.pwSearchTimer = window.setTimeout(() => void this.pwSearch(), 400);
		});
		this.pwStatusEl = contentEl.createEl("p", { cls: "bc-ci-status", text: this.pwStatus });
		this.pwListEl = contentEl.createDiv({ cls: "bc-ci-list" });
		this.pwRenderList();
		if (!Platform.isMobile) window.setTimeout(() => input.focus(), 50);
	}

	private pwSetStatus(text: string): void {
		this.pwStatus = text;
		this.pwStatusEl?.setText(text);
	}

	private pwLocate(): void {
		this.pwSetStatus("Finding your location…");
		const started = Date.now();
		getDeviceLocation()
			.then((loc) => {
				this.pwUseLocation(loc);
				void this.pwSearch();
				// Android often answers from Wi-Fi first; keep listening for a sharper GPS fix.
				if (loc.accuracy > 40 && navigator.geolocation) {
					this.pwWatchId = navigator.geolocation.watchPosition(
						(pos) => {
							const better: DeviceLocation = {
								lat: pos.coords.latitude,
								lng: pos.coords.longitude,
								accuracy: pos.coords.accuracy,
							};
							if (!this.pwLocation || better.accuracy < this.pwLocation.accuracy) {
								this.pwUseLocation(better);
								const moved = this.pwSearchedAt ? distanceMetres(this.pwSearchedAt, better) : Infinity;
								if (!this.pwQuery && moved > RESEARCH_METRES) void this.pwSearch();
							}
							if (better.accuracy <= 25 || Date.now() - started > REFINE_MS) this.pwStopWatching();
						},
						() => this.pwStopWatching(),
						{ enableHighAccuracy: true, timeout: REFINE_MS, maximumAge: 0 }
					);
					window.setTimeout(() => this.pwStopWatching(), REFINE_MS);
				}
			})
			.catch((e: unknown) => {
				this.pwSetStatus(
					`${e instanceof Error ? e.message : String(e)} You can still search by name.`
				);
			});
	}

	private pwStopWatching(): void {
		if (this.pwWatchId !== null) navigator.geolocation?.clearWatch(this.pwWatchId);
		this.pwWatchId = null;
	}

	private pwUseLocation(loc: DeviceLocation): void {
		this.pwLocation = loc;
		this.pwSetStatus(`Your location · accurate to ${Math.round(loc.accuracy)} m`);
	}

	private async pwSearch(): Promise<void> {
		const seq = ++this.pwSearchSeq;
		const near: LatLng | null = this.pwLocation ?? this.plugin.settings.lastLocation;
		const query = this.pwQuery.trim();
		if (!query && !this.pwLocation) {
			this.pwPlaces = [];
			this.pwRenderList();
			return;
		}
		try {
			const places = await searchPlaces(this.plugin.settings.fsqApiKey.trim(), {
				near,
				query: query || undefined,
			});
			if (seq !== this.pwSearchSeq) return;
			this.pwSearchedAt = this.pwLocation;
			this.pwPlaces = places;
			if (this.pwLocation) {
				const here = this.pwLocation;
				for (const p of places) p.distance = Math.round(distanceMetres(here, p));
				if (!query) places.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
			}
			this.pwRenderList();
		} catch (e) {
			if (seq !== this.pwSearchSeq) return;
			this.pwSetStatus(e instanceof FoursquareError ? e.message : `Search failed: ${String(e)}`);
		}
	}

	private pwRenderList(): void {
		const list = this.pwListEl;
		if (!list) return;
		list.empty();
		if (this.pwPlaces.length === 0) {
			list.createEl("p", {
				cls: "bc-ci-empty",
				text: this.pwQuery.trim() ? "No places found." : Platform.isMobile ? "" : "Type a name to search.",
			});
			return;
		}
		for (const place of this.pwPlaces) {
			const note = matchPlaceNote(place, this.pwNotes);
			const row = list.createEl("button", { cls: "bc-ci-row" });
			const main = row.createSpan({ cls: "bc-ci-row-main" });
			main.createSpan({ cls: "bc-ci-row-name", text: place.name });
			const bits = [place.categories[0]?.name, formatDistance(place.distance)].filter(Boolean);
			main.createSpan({ cls: "bc-ci-row-sub", text: bits.join(" · ") });
			if (note && note.visits > 0) {
				row.createSpan({
					cls: "bc-ci-row-visits",
					text: `${note.visits} visit${note.visits === 1 ? "" : "s"}`,
				});
			}
			row.onclick = () => this.pwShowPlace(place, note);
		}
	}

	// ----- Step 2: one place -----

	private pwShowPlace(place: FsqPlace, note: PlaceNoteInfo | null): void {
		this.pwStopWatching();
		const settings = this.plugin.settings;
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle(place.name);

		const back = contentEl.createEl("button", { cls: "bc-ci-back", text: "Back to the list" });
		back.onclick = () => this.pwShowList();

		const sub = [place.categories[0]?.name, place.address].filter(Boolean).join(" · ");
		contentEl.createEl("p", { cls: "bc-ci-sub", text: sub });
		contentEl.createEl("p", {
			cls: "bc-ci-visits",
			text: note && note.visits > 0 ? `${note.visits} visit${note.visits === 1 ? "" : "s"}` : "First visit",
		});

		let checkBtn: HTMLButtonElement | null = null;
		const noteFile = note ? this.app.vault.getFileByPath(note.path) : null;
		const picker = new TagPicker(this.app, settings, contentEl, place, noteFile, () => {
			if (checkBtn) checkBtn.disabled = !picker.ready();
		});

		const noteBox = contentEl.createDiv({ cls: "bc-ci-section" });
		noteBox.createEl("label", {
			cls: "bc-ci-label",
			text: "Note (optional) · becomes your Swarm shout",
			attr: { for: "bc-ci-note" },
		});
		const noteInput = noteBox.createEl("textarea", { cls: "bc-ci-input", attr: { id: "bc-ci-note", rows: "2" } });

		const swarmRow = contentEl.createEl("label", { cls: "bc-ci-check" });
		const swarmBox = swarmRow.createEl("input", { attr: { type: "checkbox" } });
		const connected = Boolean(settings.swarmToken);
		swarmBox.checked = connected;
		swarmBox.disabled = !connected;
		swarmRow.appendText(
			connected ? " Also check in on Swarm (public)" : " Also check in on Swarm (connect Swarm in the settings)"
		);

		checkBtn = contentEl.createEl("button", { cls: "mod-cta bc-ci-go", text: "Check in" });
		checkBtn.disabled = !picker.ready();
		checkBtn.onclick = () => {
			if (!picker.ready()) {
				new Notice(`Pick a tag for ${picker.categoryName()} first, or "No tag for this category".`);
				return;
			}
			const choice = picker.result();
			picker.rememberCategory();
			this.close();
			void this.pwCheckIn(place, {
				tags: choice.tags,
				projects: choice.projects,
				note: noteInput.value,
				swarm: swarmBox.checked,
			});
		};
	}

	private async pwCheckIn(
		place: FsqPlace,
		c: { tags: string[]; projects: string[]; note: string; swarm: boolean }
	): Promise<void> {
		const plugin = this.plugin;
		const settings = plugin.settings;
		const app = this.app;
		settings.lastLocation = { lat: place.lat, lng: place.lng };

		const done: string[] = [];
		try {
			const visit = visitEntry(moment().format("YYYY-MM-DD HH:mm"), c.note);
			const file = await recordVisit(app, settings, {
				place,
				tags: c.tags,
				projects: c.projects,
				visit,
			});
			done.push(`visit added to ${file.basename}`);

			const config = dailyNoteConfig(app, settings);
			let daily = getDailyNote(app, config, today());
			if (!daily) {
				const create = await ask(
					app,
					"Today's daily note doesn't exist yet",
					`Create it from your template and add ${file.basename} to it?`,
					"Create it",
					"Don't add"
				);
				if (create) daily = await createDailyNote(app, settings, today());
			}
			if (daily && (await addPlaceToDailyNote(app, settings, daily, file))) {
				done.push("added to today's daily note");
			}
		} catch (e) {
			console.warn("[Better Calendars] check-in failed", e);
			new Notice(`Better Calendars: the check-in couldn't be saved. ${e instanceof Error ? e.message : String(e)}`, 10_000);
			await plugin.saveSettings();
			return;
		}

		if (c.swarm) {
			const status = await postToSwarm(
				plugin,
				{ venueId: place.id, placeName: place.name, shout: swarmShout(c.note), at: Date.now() },
				{ lat: place.lat, lng: place.lng }
			);
			if (status === "posted") done.push("checked in on Swarm");
			if (status === "queued") done.push("Swarm post queued (will retry on the next refresh)");
		}
		await plugin.saveSettings();
		new Notice(`Checked in at ${place.name}: ${done.join(", ")}.`, 6000);
	}
}




function formatDistance(m: number | null): string {
	if (m === null) return "";
	return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}


export function openCheckin(plugin: BetterCalendarsPlugin): void {
	new CheckinModal(plugin).open();
}
