import { AbstractInputSuggest, App, Modal, Notice, Platform, moment } from "obsidian";
import type BetterCalendarsPlugin from "../main";
import { createDailyNote, dailyNoteConfig, getDailyNote, today } from "../daily/daily-notes";
import { FoursquareError, searchPlaces } from "./foursquare";
import { DeviceLocation, getDeviceLocation } from "./location";
import {
	FsqPlace,
	LatLng,
	PlaceNoteInfo,
	checkinTags,
	distanceMetres,
	guessTag,
	linkKey,
	matchPlaceNote,
	normalizeTag,
	swarmShout,
	visitEntry,
} from "./logic";
import { addPlaceToDailyNote, listPlaceNotes, propertyValues, recordVisit } from "./place-notes";
import { postToSwarm } from "./swarm";

/** A better GPS fix is worth waiting for this long after the first one. */
const REFINE_MS = 8000;
/** Search again when a better fix is this far from the one we searched with. */
const RESEARCH_METRES = 60;

/** Suggests values already used in a property (e.g. Projects). */
class ValueSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private readonly pwInput: HTMLInputElement,
		private readonly pwValues: string[],
		private readonly pwOnPick: (value: string) => void
	) {
		super(app, pwInput);
	}

	protected getSuggestions(query: string): string[] {
		const q = query.trim().toLowerCase();
		const hits = this.pwValues.filter((v) => v.toLowerCase().includes(q)).slice(0, 30);
		const typed = query.trim();
		if (typed && !hits.some((h) => h.toLowerCase() === typed.toLowerCase())) {
			hits.push(typed);
		}
		return hits;
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		const isNew = !this.pwValues.some((v) => v.toLowerCase() === value.toLowerCase());
		el.setText(isNew ? `Use "${value}" as a new value` : value);
	}

	selectSuggestion(value: string): void {
		this.pwInput.value = "";
		this.pwOnPick(value);
		this.close();
	}
}

/** Asks a yes/no question; resolves true for the first button. */
function ask(app: App, title: string, text: string, yes: string, no: string): Promise<boolean> {
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

		// The category's remembered tag, or a question when there is none yet.
		const category = place.categories[0] ?? null;
		const remembered = category ? settings.categoryTags[category.id] : undefined;
		/** undefined = not chosen yet; "" = no tag for this category. */
		let categoryTag: string | undefined = remembered?.tag;
		const extras = new Set<string>();
		/** Untick the remembered tag for this place only (the mapping stays). */
		let useCategoryTag = true;

		const tagsBox = contentEl.createDiv({ cls: "bc-ci-section" });
		let promptBox: HTMLElement | null = null;
		if (category && remembered === undefined) {
			categoryTag = guessTag(category.name, settings.checkinTags) ?? undefined;
			promptBox = tagsBox.createDiv({ cls: "bc-ci-prompt" });
		}
		const chipsLabel = tagsBox.createEl("p", { cls: "bc-ci-label" });
		const chips = tagsBox.createDiv({ cls: "bc-ci-chips" });

		const render = () => {
			if (promptBox && category) {
				promptBox.empty();
				promptBox.createEl("p", { cls: "bc-ci-prompt-title", text: `Which tag for ${category.name}?` });
				promptBox.createEl("p", {
					cls: "bc-ci-prompt-text",
					text: `Your choice is remembered for every ${category.name}. You can change it in the settings.`,
				});
				const row = promptBox.createDiv({ cls: "bc-ci-chips" });
				for (const t of settings.checkinTags) {
					chip(row, t, categoryTag === t, () => {
						categoryTag = t;
						extras.delete(t);
						render();
					});
				}
				chip(row, "No tag for this category", categoryTag === "", () => {
					categoryTag = "";
					render();
				});
				addNewChip(row, (t) => {
					categoryTag = t;
					render();
				});
			}

			const lower = (t: string) => t.toLowerCase();
			const always = new Set(settings.alwaysTags.map(lower));
			const chosen = [useCategoryTag ? categoryTag : "", ...extras].filter((t): t is string => Boolean(t));
			const chosenKeys = new Set(chosen.map(lower));
			chipsLabel.setText(
				category && categoryTag && remembered
					? `Tags · ${categoryTag} is remembered for every ${category.name}`
					: "Tags"
			);
			chips.empty();
			for (const t of settings.alwaysTags) fixedChip(chips, `${t} · always`);
			if (categoryTag && category) {
				if (promptBox) fixedChip(chips, `${categoryTag} · for ${category.name}`, true);
				else {
					const tag = categoryTag;
					chip(chips, useCategoryTag ? `✓ ${tag}` : tag, useCategoryTag, () => {
						useCategoryTag = !useCategoryTag;
						render();
					}).setAttr("aria-label", `${tag}, remembered for every ${category.name}`);
				}
			}
			const impliedShown = new Set<string>();
			for (const c of chosen) {
				for (const t of impliedTagsOf(settings.impliedTags, c)) {
					const k = lower(t);
					if (always.has(k) || chosenKeys.has(k) || impliedShown.has(k)) continue;
					fixedChip(chips, `${t} · with ${c}`, true);
					impliedShown.add(k);
				}
			}
			for (const t of settings.checkinTags) {
				const k = lower(t);
				if (k === lower(categoryTag ?? "") || always.has(k) || impliedShown.has(k)) continue;
				chip(chips, t, extras.has(t), () => {
					if (extras.has(t)) extras.delete(t);
					else extras.add(t);
					render();
				});
			}
			addNewChip(chips, (t) => {
				extras.add(t);
				render();
			});
			checkBtn.disabled = Boolean(category) && categoryTag === undefined;
		};

		const addNewChip = (row: HTMLElement, onAdd: (tag: string) => void) => {
			const btn = row.createEl("button", { cls: "bc-ci-chip bc-ci-chip-new", text: "+ new" });
			btn.onclick = () => {
				btn.replaceWith(
					(() => {
						const input = createEl("input", { cls: "bc-ci-new-tag", attr: { placeholder: "New tag", "aria-label": "New tag" } });
						const done = () => {
							const t = normalizeTag(input.value);
							if (t) {
								if (!settings.checkinTags.some((x) => x.toLowerCase() === t.toLowerCase())) {
									settings.checkinTags.push(t);
								}
								onAdd(t);
							} else render();
						};
						input.addEventListener("keydown", (ev) => {
							if (ev.key === "Enter") done();
							if (ev.key === "Escape") render();
						});
						input.addEventListener("blur", done);
						window.setTimeout(() => input.focus(), 20);
						return input;
					})()
				);
			};
		};

		// Projects: existing values stay; picked ones are added.
		const projectsBox = contentEl.createDiv({ cls: "bc-ci-section" });
		projectsBox.createEl("label", { cls: "bc-ci-label", text: "Projects", attr: { for: "bc-ci-projects" } });
		const projectChips = projectsBox.createDiv({ cls: "bc-ci-chips" });
		const noteFile = note ? this.app.vault.getFileByPath(note.path) : null;
		const existingProjects = noteFile
			? listValues(this.app.metadataCache.getFileCache(noteFile)?.frontmatter?.Projects)
			: [];
		const picked: string[] = [];
		const renderProjects = () => {
			projectChips.empty();
			for (const p of existingProjects) fixedChip(projectChips, p);
			for (const p of picked) {
				const c = chip(projectChips, `${p} ×`, true, () => {
					picked.splice(picked.indexOf(p), 1);
					renderProjects();
				});
				c.setAttr("aria-label", `Remove ${p}`);
			}
		};
		const projectInput = projectsBox.createEl("input", {
			cls: "bc-ci-input",
			attr: { id: "bc-ci-projects", placeholder: "Neighbourhood or project", type: "text" },
		});
		const addProject = (value: string) => {
			const v = value.trim();
			if (!v) return;
			const keys = new Set([...existingProjects, ...picked].map(linkKey));
			if (!keys.has(linkKey(v))) picked.push(v);
			renderProjects();
		};
		new ValueSuggest(this.app, projectInput, propertyValues(this.app, "Projects"), addProject);
		projectInput.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter") {
				addProject(projectInput.value);
				projectInput.value = "";
			}
		});
		renderProjects();

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

		const checkBtn = contentEl.createEl("button", { cls: "mod-cta bc-ci-go", text: "Check in" });
		checkBtn.onclick = () => {
			if (category && categoryTag === undefined) {
				new Notice(`Pick a tag for ${category.name} first, or "No tag for this category".`);
				return;
			}
			if (projectInput.value.trim()) addProject(projectInput.value);
			const chosen = [useCategoryTag ? categoryTag : "", ...extras].filter((t): t is string => Boolean(t));
			this.close();
			void this.pwCheckIn(place, {
				categoryTag,
				tags: checkinTags(settings.alwaysTags, chosen, settings.impliedTags),
				projects: picked,
				note: noteInput.value,
				swarm: swarmBox.checked,
			});
		};
		render();
	}

	private async pwCheckIn(
		place: FsqPlace,
		c: { categoryTag: string | undefined; tags: string[]; projects: string[]; note: string; swarm: boolean }
	): Promise<void> {
		const plugin = this.plugin;
		const settings = plugin.settings;
		const app = this.app;
		const category = place.categories[0];
		if (category && c.categoryTag !== undefined) {
			settings.categoryTags[category.id] = { name: category.name, tag: c.categoryTag };
		}
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

function chip(row: HTMLElement, text: string, on: boolean, onClick: () => void): HTMLButtonElement {
	const b = row.createEl("button", { cls: `bc-ci-chip${on ? " is-on" : ""}`, text });
	b.setAttr("aria-pressed", String(on));
	b.onclick = onClick;
	return b;
}

function fixedChip(row: HTMLElement, text: string, accent = false): void {
	row.createSpan({ cls: `bc-ci-chip bc-ci-chip-fixed${accent ? " is-auto" : ""}`, text });
}

function impliedTagsOf(implied: Record<string, string[]>, tag: string): string[] {
	const k = tag.toLowerCase();
	for (const [key, list] of Object.entries(implied)) if (key.toLowerCase() === k) return list;
	return [];
}

function formatDistance(m: number | null): string {
	if (m === null) return "";
	return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

function listValues(v: unknown): string[] {
	if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
	return typeof v === "string" && v.trim() ? [v] : [];
}

export function openCheckin(plugin: BetterCalendarsPlugin): void {
	new CheckinModal(plugin).open();
}
