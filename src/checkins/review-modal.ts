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
	/** Put off with "Later": shown again at the end of this session and next time. Not saved. */
	private readonly pwLater: string[] = [];
	/** Set when the review is closed, so a running save stops. */
	private pwClosed = false;

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
		this.pwClosed = true;
		this.contentEl.empty();
		if (this.pwUnsaved > 0) void this.plugin.saveSettings();
	}

	private pwRecompute(): void {
		const s = this.plugin.settings;
		const pending = pendingCheckins(this.pwHistory, [...s.swarmReviewed, ...s.swarmSkipped], s.swarmPostedIds);
		// "Later" ones go to the end of the queue.
		const later = new Set(this.pwLater);
		this.pwPending = [
			...pending.filter((c) => !later.has(c.id)),
			...this.pwLater.map((id) => pending.find((c) => c.id === id)).filter((c): c is SwarmCheckin => Boolean(c)),
		];
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
		const textRow = contentEl.createEl("label", { cls: "bc-ci-check bc-rv-sub-check" });
		const textBox = textRow.createEl("input", { attr: { type: "checkbox" } });
		textRow.appendText(" Add the name as plain text (not a link)");
		const showTextOption = () => textRow.toggle(dailyBox.checked);
		dailyBox.addEventListener("change", showTextOption);
		const here = visitsHere(this.pwPending, place.id);
		let allBox: HTMLInputElement | null = null;
		const dayExists = (d: string) => Boolean(getDailyNote(this.app, config, moment(d, "YYYY-MM-DD")));
		const showDaily = () => {
			if (allBox?.checked) {
				const days = [...new Set(here.map(localDate))];
				const missing = days.filter((d) => !dayExists(d)).length;
				dailyText.setText(
					` Add to the daily notes of all ${here.length} visits` +
						(missing > 0
							? ` (${missing} of ${days.length} day${days.length === 1 ? "" : "s"} ${missing === 1 ? "has" : "have"} no daily note; you'll be asked)`
							: "")
				);
				createDaily.toggle(false);
			} else {
				dailyText.setText(daily ? ` Add to daily note ${date}` : ` Add to daily note ${date} (doesn't exist)`);
				createDaily.toggle(!daily);
			}
		};
		dailyBox.checked = Boolean(daily);
		createDaily.onclick = async () => {
			createDaily.disabled = true;
			try {
				daily = await createDailyNote(this.app, settings, moment(date, "YYYY-MM-DD"));
				dailyBox.checked = true;
				showTextOption();
			} catch (e) {
				new Notice(`Couldn't create the daily note. ${e instanceof Error ? e.message : String(e)}`);
			}
			createDaily.disabled = false;
			showDaily();
			showTextOption();
		};
		showDaily();
		showTextOption();

		if (here.length > 1) {
			const allRow = contentEl.createEl("label", { cls: "bc-ci-check" });
			const box = allRow.createEl("input", { attr: { type: "checkbox" } });
			allBox = box;
			allRow.appendText(` Apply to all ${here.length} visits here`);
			// The visits it would save, with whether their day has a daily note.
			const list = contentEl.createEl("ul", { cls: "bc-rv-visits" });
			for (const v of here) {
				const d = localDate(v);
				const li = list.createEl("li");
				li.createSpan({ text: `${moment(d, "YYYY-MM-DD").format("ddd")} ${localStamp(v)}` });
				li.createSpan({
					cls: dayExists(d) ? "bc-rv-has-daily" : "bc-rv-no-daily",
					text: dayExists(d) ? " · daily note ✓" : " · no daily note",
				});
				if (v.shout) li.createSpan({ cls: "bc-rv-visit-shout", text: ` · “${v.shout}”` });
			}
			list.toggle(false);
			box.onchange = () => {
				list.toggle(box.checked);
				if (box.checked) dailyBox.checked = here.some((v) => dayExists(localDate(v)));
				else dailyBox.checked = Boolean(daily);
				showDaily();
				showTextOption();
			};
		}


		saveBtn = this.pwButtons(picker, async () => {
			const items = allBox?.checked ? here : [c];
			const choice = picker.result();
			return this.pwSave(items, picker, {
				link: linkBox.checked,
				daily: dailyBox.checked,
				asText: textBox.checked,
				tags: choice.tags,
				projects: choice.projects,
				existingNote: noteFile,
				placeName: place.name,
			});
		});
		saveBtn.disabled = linkBox.checked && !picker.ready();
	}

	/** Skip / Save and next. Returns the save button. */
	private pwButtons(picker: TagPicker | null, onSave: () => Promise<boolean | void>): HTMLButtonElement {
		const row = this.contentEl.createDiv({ cls: "bc-rv-buttons" });
		const later = row.createEl("button", { text: "Later" });
		later.setAttr("aria-label", "Later: comes back next time");
		const skip = row.createEl("button", { text: "Skip" });
		skip.setAttr("aria-label", "Skip: don't show this one again");
		const save = row.createEl("button", { cls: "mod-cta", text: picker ? "Save and next" : "Next" });
		const current = this.pwPending[0];
		later.onclick = () => {
			if (this.pwBusy || !current) return;
			const i = this.pwLater.indexOf(current.id);
			if (i >= 0) this.pwLater.splice(i, 1);
			this.pwLater.push(current.id);
			this.pwNext();
		};
		skip.onclick = async () => {
			if (this.pwBusy || !current) return;
			this.pwBusy = true;
			const skipped = this.plugin.settings.swarmSkipped;
			if (!skipped.includes(current.id)) skipped.push(current.id);
			this.pwUnsaved++;
			if (this.pwUnsaved >= SAVE_EVERY) {
				this.pwUnsaved = 0;
				await this.plugin.saveSettings();
			}
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
			let saved: boolean | void = true;
			try {
				saved = await onSave();
			} catch (e) {
				console.warn("[Better Calendars] saving a past check-in failed", e);
				new Notice(`Couldn't save this check-in. ${e instanceof Error ? e.message : String(e)}`, 10_000);
				this.pwBusy = false;
				save.disabled = false;
				return;
			}
			this.pwBusy = false;
			if (saved === false) {
				// Cancelled: stay on this check-in.
				save.disabled = false;
				return;
			}
			if (!this.pwClosed) this.pwNext();
		};
		return save;
	}

	/** Returns false when cancelled (nothing saved). */
	private async pwSave(
		items: SwarmCheckin[],
		picker: TagPicker,
		o: {
			link: boolean;
			daily: boolean;
			asText: boolean;
			tags: string[];
			projects: string[];
			existingNote: TFile | null;
			placeName: string;
		}
	): Promise<boolean> {
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
				const answer = await ask(
					app,
					"Some days have no daily note",
					items.length === 1
						? `There's no daily note for ${missing[0] ?? ""}. Create it from your template?`
						: `${missing.length} of these ${items.length} visits are on days without a daily note (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}). Create those daily notes from your template?`,
					"Create them",
					"Skip those days"
				);
				// Closed with X: cancel, nothing is saved.
				if (answer === null) return false;
				createMissing = answer;
			}
		}

		picker.rememberCategory();
		const done: string[] = [];
		for (const item of items) {
			// Closing the review stops after the visit being written.
			if (this.pwClosed) break;
			done.push(item.id);
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
			// Plain text uses the place's own name.
			if (o.asText && placeNote) placeNote = o.placeName;
			if (o.daily && placeNote) {
				const day = moment(localDate(item), "YYYY-MM-DD");
				let daily = getDailyNote(app, config, day);
				if (!daily && createMissing) daily = await createDailyNote(app, settings, day);
				if (daily) await addPlaceToDailyNote(app, settings, daily, placeNote, o.asText);
			}
		}
		await this.pwMarkReviewed(done);
		if (this.pwClosed) {
			await this.plugin.saveSettings();
			if (done.length < items.length) {
				new Notice(`Stopped: saved ${done.length} of ${items.length} visits to ${o.placeName}. The rest stay in the review.`);
			}
			return true;
		}
		if (items.length > 1) new Notice(`Saved ${items.length} visits to ${o.placeName}.`);
		return true;
	}
}

export function openReview(plugin: BetterCalendarsPlugin): void {
	new ReviewModal(plugin).open();
}
