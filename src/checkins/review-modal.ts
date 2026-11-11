import { App, Modal, Notice, TFile, moment } from "obsidian";
import type BetterCalendarsPlugin from "../main";
import { createDailyNote, dailyNoteConfig, getDailyNote } from "../daily/daily-notes";
import { ask } from "./checkin-modal";
import { refreshHistory } from "./history";
import {
	SwarmCheckin,
	localDate,
	localStamp,
	pendingCheckins,
	reviewTotal,
	visitsHere,
} from "./history-logic";
import { PlaceNoteInfo, cleanFileName, matchPlaceNote, visitEntry } from "./logic";
import { addPlaceToDailyNote, listPlaceNotes, recordVisit } from "./place-notes";
import { TagPicker } from "./tag-picker";

/** Progress is saved to the (synced) settings every this many check-ins, and on close. */
const SAVE_EVERY = 10;

/** "Catch up on Swarm history": one past check-in at a time, newest first. */
export class ReviewModal extends Modal {
	private pwHistory: SwarmCheckin[] = [];
	private pwPending: SwarmCheckin[] = [];
	private pwTotal = 0;
	private pwNotes: PlaceNoteInfo[] = [];
	private pwUnsaved = 0;
	private pwBusy = false;

	constructor(private readonly plugin: BetterCalendarsPlugin) {
		super(plugin.app);
	}

	onOpen(): void {
		this.modalEl.addClass("bc-ci-modal");
		this.setTitle("Swarm history");
		if (!this.plugin.settings.swarmToken) {
			this.contentEl.createEl("p", {
				text: "Connect Swarm first: Settings → Better Calendars → Check-ins → Swarm.",
			});
			return;
		}
		const status = this.contentEl.createEl("p", { cls: "bc-ci-status", text: "Loading your Swarm history…" });
		refreshHistory(this.plugin, (fetched, total) => {
			status.setText(`Loading your Swarm history… ${fetched.toLocaleString()} of ${total.toLocaleString()}`);
		})
			.then(({ history }) => {
				this.pwHistory = history;
				this.pwNext();
			})
			.catch((e: unknown) => {
				status.setText(
					`Couldn't load your Swarm history. ${e instanceof Error ? e.message : String(e)}`
				);
			});
	}

	onClose(): void {
		this.contentEl.empty();
		if (this.pwUnsaved > 0) void this.plugin.saveSettings();
	}

	private pwRecompute(): void {
		const s = this.plugin.settings;
		this.pwPending = pendingCheckins(this.pwHistory, s.swarmReviewed, s.swarmPostedIds);
		this.pwTotal = reviewTotal(this.pwHistory, s.swarmPostedIds);
	}

	private async pwMarkReviewed(ids: string[]): Promise<void> {
		const reviewed = this.plugin.settings.swarmReviewed;
		const have = new Set(reviewed);
		for (const id of ids) if (!have.has(id)) reviewed.push(id);
		this.pwUnsaved += ids.length;
		if (this.pwUnsaved >= SAVE_EVERY) {
			this.pwUnsaved = 0;
			await this.plugin.saveSettings();
		}
	}

	private pwNext(): void {
		this.pwRecompute();
		this.pwNotes = listPlaceNotes(this.app, this.plugin.settings);
		const next = this.pwPending[0];
		const { contentEl } = this;
		contentEl.empty();
		if (!next) {
			contentEl.createEl("p", {
				text:
					this.pwTotal === 0
						? "Your Swarm history is empty."
						: `All caught up: you've reviewed all ${this.pwTotal.toLocaleString()} check-ins.`,
			});
			return;
		}
		this.pwShow(next);
	}

	private pwShow(c: SwarmCheckin): void {
		const plugin = this.plugin;
		const settings = plugin.settings;
		const { contentEl } = this;
		contentEl.empty();

		// Progress: "1,204 of 6,830"
		const position = this.pwTotal - this.pwPending.length + 1;
		const bar = contentEl.createDiv({
			cls: "bc-rv-bar",
			attr: {
				role: "progressbar",
				"aria-label": "Review progress",
				"aria-valuemin": "0",
				"aria-valuemax": String(this.pwTotal),
				"aria-valuenow": String(position - 1),
			},
		});
		bar.createDiv({ cls: "bc-rv-bar-fill" }).style.setProperty(
			"--bc-progress",
			`${Math.min(100, ((position - 1) / Math.max(1, this.pwTotal)) * 100)}%`
		);
		contentEl.createEl("p", {
			cls: "bc-ci-status",
			text: `${position.toLocaleString()} of ${this.pwTotal.toLocaleString()}`,
		});

		const date = localDate(c);
		const stamp = localStamp(c);
		contentEl.createEl("p", {
			cls: "bc-ci-visits",
			text: `${moment(date, "YYYY-MM-DD").format("ddd")} ${date} · ${stamp.slice(11)}`,
		});

		const place = c.place;
		if (!place) {
			contentEl.createEl("h3", { text: "A place that's no longer on Foursquare" });
			contentEl.createEl("p", { cls: "bc-ci-sub", text: "There's nothing to save for this check-in." });
			if (c.shout) contentEl.createEl("blockquote", { cls: "bc-rv-shout", text: c.shout });
			this.pwButtons(null, async () => {
				await this.pwMarkReviewed([c.id]);
			});
			return;
		}

		contentEl.createEl("h3", { cls: "bc-rv-place", text: place.name });
		contentEl.createEl("p", {
			cls: "bc-ci-sub",
			text: [place.categories[0]?.name, place.address].filter(Boolean).join(" · "),
		});
		const note = matchPlaceNote(place, this.pwNotes);
		contentEl.createEl("p", {
			cls: "bc-ci-sub",
			text: note
				? `Note exists · ${note.visits} visit${note.visits === 1 ? "" : "s"} recorded`
				: "No note yet",
		});
		if (c.shout) contentEl.createEl("blockquote", { cls: "bc-rv-shout", text: c.shout });

		let saveBtn: HTMLButtonElement | null = null;
		const noteFile = note ? this.app.vault.getFileByPath(note.path) : null;
		const picker = new TagPicker(this.app, settings, contentEl, place, noteFile, () => {
			if (saveBtn) saveBtn.disabled = linkBox.checked && !picker.ready();
		});

		// Checkboxes
		const linkRow = contentEl.createEl("label", { cls: "bc-ci-check" });
		const linkBox = linkRow.createEl("input", { attr: { type: "checkbox" } });
		linkBox.checked = true;
		linkRow.appendText(" Create or link place note");
		linkBox.onchange = () => {
			if (saveBtn) saveBtn.disabled = linkBox.checked && !picker.ready();
		};

		const config = dailyNoteConfig(this.app, settings);
		let daily: TFile | null = getDailyNote(this.app, config, moment(date, "YYYY-MM-DD"));
		const dailyRow = contentEl.createEl("label", { cls: "bc-ci-check" });
		const dailyBox = dailyRow.createEl("input", { attr: { type: "checkbox" } });
		const dailyText = dailyRow.createSpan();
		const createDaily = contentEl.createEl("button", {
			cls: "bc-rv-create-daily",
			text: `Create ${date} from your template`,
		});
		const showDaily = () => {
			dailyText.setText(daily ? ` Add to daily note ${date}` : ` Add to daily note ${date} (doesn't exist)`);
			createDaily.toggle(!daily);
		};
		dailyBox.checked = Boolean(daily);
		createDaily.onclick = async () => {
			createDaily.disabled = true;
			try {
				daily = await createDailyNote(this.app, settings, moment(date, "YYYY-MM-DD"));
				dailyBox.checked = true;
			} catch (e) {
				new Notice(`Couldn't create the daily note. ${e instanceof Error ? e.message : String(e)}`);
			}
			createDaily.disabled = false;
			showDaily();
		};
		showDaily();

		const here = visitsHere(this.pwPending, place.id);
		let allBox: HTMLInputElement | null = null;
		if (here.length > 1) {
			const allRow = contentEl.createEl("label", { cls: "bc-ci-check" });
			allBox = allRow.createEl("input", { attr: { type: "checkbox" } });
			allRow.appendText(` Apply to all ${here.length} visits here`);
		}

		saveBtn = this.pwButtons(picker, async () => {
			const items = allBox?.checked ? here : [c];
			const choice = picker.result();
			picker.rememberCategory();
			await this.pwSave(items, {
				link: linkBox.checked,
				daily: dailyBox.checked,
				tags: choice.tags,
				projects: choice.projects,
				existingNote: noteFile,
				placeName: place.name,
			});
		});
		saveBtn.disabled = linkBox.checked && !picker.ready();
	}

	/** Skip / Save and next. Returns the save button. */
	private pwButtons(picker: TagPicker | null, onSave: () => Promise<void>): HTMLButtonElement {
		const row = this.contentEl.createDiv({ cls: "bc-rv-buttons" });
		const skip = row.createEl("button", { text: "Skip" });
		const save = row.createEl("button", { cls: "mod-cta", text: picker ? "Save and next" : "Next" });
		const current = this.pwPending[0];
		skip.onclick = async () => {
			if (this.pwBusy || !current) return;
			this.pwBusy = true;
			await this.pwMarkReviewed([current.id]);
			this.pwBusy = false;
			this.pwNext();
		};
		save.onclick = async () => {
			if (this.pwBusy) return;
			if (picker && !picker.ready()) {
				new Notice(`Pick a tag for ${picker.categoryName()} first, or "No tag for this category".`);
				return;
			}
			this.pwBusy = true;
			save.disabled = true;
			try {
				await onSave();
			} catch (e) {
				console.warn("[Better Calendars] saving a past check-in failed", e);
				new Notice(`Couldn't save this check-in. ${e instanceof Error ? e.message : String(e)}`, 10_000);
				this.pwBusy = false;
				save.disabled = false;
				return;
			}
			this.pwBusy = false;
			this.pwNext();
		};
		return save;
	}

	private async pwSave(
		items: SwarmCheckin[],
		o: {
			link: boolean;
			daily: boolean;
			tags: string[];
			projects: string[];
			existingNote: TFile | null;
			placeName: string;
		}
	): Promise<void> {
		const app: App = this.app;
		const settings = this.plugin.settings;
		const config = dailyNoteConfig(app, settings);

		// Days among these visits without a daily note: ask what to do (once per save).
		let createMissing = false;
		if (o.daily) {
			const missing = [...new Set(items.map(localDate))].filter(
				(d) => !getDailyNote(app, config, moment(d, "YYYY-MM-DD"))
			);
			if (missing.length > 0) {
				createMissing = await ask(
					app,
					"Some days have no daily note",
					items.length === 1
						? `There's no daily note for ${missing[0] ?? ""}. Create it from your template?`
						: `${missing.length} of these ${items.length} visits are on days without a daily note (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}). Create those daily notes from your template?`,
					"Create them",
					"Skip those days"
				);
			}
		}

		for (const item of items) {
			if (!item.place) continue;
			let placeNote: TFile | string | null = null;
			if (o.link) {
				placeNote = await recordVisit(app, settings, {
					place: item.place,
					tags: o.tags,
					projects: o.projects,
					visit: visitEntry(localStamp(item), item.shout),
				});
			} else if (o.daily) {
				placeNote = o.existingNote ?? cleanFileName(o.placeName);
			}
			if (o.daily && placeNote) {
				const day = moment(localDate(item), "YYYY-MM-DD");
				let daily = getDailyNote(app, config, day);
				if (!daily && createMissing) daily = await createDailyNote(app, settings, day);
				if (daily) await addPlaceToDailyNote(app, settings, daily, placeNote);
			}
		}
		await this.pwMarkReviewed(items.map((i) => i.id));
		if (items.length > 1) new Notice(`Saved ${items.length} visits to ${o.placeName}.`);
	}
}

export function openReview(plugin: BetterCalendarsPlugin): void {
	new ReviewModal(plugin).open();
}
