import { AbstractInputSuggest, App, FuzzySuggestModal, TFile } from "obsidian";
import type { BetterCalendarsSettings } from "../settings";
import {
	FsqPlace,
	NOT_ALLOWED_IN_NAMES,
	checkinTags,
	cleanFileName,
	guessTag,
	linkKey,
	normalizeTag,
} from "./logic";
import { RATING, propertyValues } from "./place-notes";

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
		if (typed && !hits.some((h) => h.toLowerCase() === typed.toLowerCase())) hits.push(typed);
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

export function chip(row: HTMLElement, text: string, on: boolean, onClick: () => void): HTMLButtonElement {
	const b = row.createEl("button", { cls: `bc-ci-chip${on ? " is-on" : ""}`, text });
	b.setAttr("aria-pressed", String(on));
	b.onclick = onClick;
	return b;
}

export function fixedChip(row: HTMLElement, text: string, accent = false): void {
	row.createSpan({ cls: `bc-ci-chip bc-ci-chip-fixed${accent ? " is-auto" : ""}`, text });
}

function impliedTagsOf(implied: Record<string, string[]>, tag: string): string[] {
	const k = tag.toLowerCase();
	for (const [key, list] of Object.entries(implied)) if (key.toLowerCase() === k) return list;
	return [];
}

function listValues(v: unknown): string[] {
	if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
	return typeof v === "string" && v.trim() ? [v] : [];
}

/** The remembered tag for a category: by Foursquare id, else by category name. */
export function rememberedTag(
	settings: BetterCalendarsSettings,
	category: { id: string; name: string } | null
): string | undefined {
	if (!category) return undefined;
	const byId = settings.categoryTags[category.id];
	if (byId) return byId.tag;
	const name = category.name.toLowerCase();
	return Object.values(settings.categoryTags).find((e) => e.name.toLowerCase() === name)?.tag;
}

export interface TagChoice {
	/** undefined = not chosen; "" = no tag for this category. */
	categoryTag: string | undefined;
	/** Every tag the place gets (always-tags and brought-along tags included). */
	tags: string[];
	projects: string[];
}

/**
 * Tag chips (with the "which tag for this category?" question when needed)
 * and the Projects field, shared by the check-in and history screens.
 */
export class TagPicker {
	private readonly category: { id: string; name: string } | null;
	private readonly remembered: string | undefined;
	private categoryTag: string | undefined;
	private useCategoryTag = true;
	private readonly extras = new Set<string>();
	private readonly picked: string[] = [];
	private readonly existingProjects: string[];
	private readonly promptBox: HTMLElement | null;
	private readonly chipsLabel: HTMLElement;
	private readonly chips: HTMLElement;
	private readonly projectChips: HTMLElement;
	private readonly projectInput: HTMLInputElement;

	constructor(
		private readonly app: App,
		private readonly settings: BetterCalendarsSettings,
		container: HTMLElement,
		place: FsqPlace,
		noteFile: TFile | null,
		private readonly onChange: () => void
	) {
		this.category = place.categories[0] ?? null;
		this.remembered = rememberedTag(settings, this.category);
		this.categoryTag = this.remembered;

		const tagsBox = container.createDiv({ cls: "bc-ci-section" });
		this.promptBox = null;
		if (this.category && this.remembered === undefined) {
			this.categoryTag = guessTag(this.category.name, settings.checkinTags) ?? undefined;
			this.promptBox = tagsBox.createDiv({ cls: "bc-ci-prompt" });
		}
		this.chipsLabel = tagsBox.createEl("p", { cls: "bc-ci-label" });
		this.chips = tagsBox.createDiv({ cls: "bc-ci-chips" });

		// Projects: existing values stay; picked ones are added.
		const projectsBox = container.createDiv({ cls: "bc-ci-section" });
		const inputId = `bc-ci-projects-${Math.random().toString(36).slice(2, 8)}`;
		projectsBox.createEl("label", { cls: "bc-ci-label", text: "Projects", attr: { for: inputId } });
		this.projectChips = projectsBox.createDiv({ cls: "bc-ci-chips" });
		this.existingProjects = noteFile
			? listValues(app.metadataCache.getFileCache(noteFile)?.frontmatter?.Projects)
			: [];
		this.projectInput = projectsBox.createEl("input", {
			cls: "bc-ci-input",
			attr: { id: inputId, placeholder: "Neighbourhood or project", type: "text" },
		});
		new ValueSuggest(app, this.projectInput, propertyValues(app, "Projects"), (v) => this.addProject(v));
		this.projectInput.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter") {
				this.addProject(this.projectInput.value);
				this.projectInput.value = "";
			}
		});
		this.renderProjects();
		this.render();
	}

	/** False while a category still needs its tag chosen. */
	ready(): boolean {
		return !this.category || this.categoryTag !== undefined;
	}

	categoryName(): string {
		return this.category?.name ?? "";
	}

	result(): TagChoice {
		if (this.projectInput.value.trim()) {
			this.addProject(this.projectInput.value);
			this.projectInput.value = "";
		}
		const chosen = [this.useCategoryTag ? this.categoryTag : "", ...this.extras].filter(
			(t): t is string => Boolean(t)
		);
		return {
			categoryTag: this.categoryTag,
			tags: checkinTags(this.settings.alwaysTags, chosen, this.settings.impliedTags),
			projects: [...this.picked],
		};
	}

	/** Remember the category's tag (when it was asked for). */
	rememberCategory(): void {
		if (this.category && this.remembered === undefined && this.categoryTag !== undefined) {
			this.settings.categoryTags[this.category.id] = {
				name: this.category.name,
				tag: this.categoryTag,
			};
		}
	}

	private addProject(value: string): void {
		const v = value.trim();
		if (!v) return;
		const keys = new Set([...this.existingProjects, ...this.picked].map(linkKey));
		if (!keys.has(linkKey(v))) this.picked.push(v);
		this.renderProjects();
	}

	private renderProjects(): void {
		this.projectChips.empty();
		for (const p of this.existingProjects) fixedChip(this.projectChips, p);
		for (const p of this.picked) {
			chip(this.projectChips, `${p} ×`, true, () => {
				this.picked.splice(this.picked.indexOf(p), 1);
				this.renderProjects();
			}).setAttr("aria-label", `Remove ${p}`);
		}
	}

	private render(): void {
		const { settings, category } = this;
		if (this.promptBox && category) {
			const box = this.promptBox;
			box.empty();
			box.createEl("p", { cls: "bc-ci-prompt-title", text: `Which tag for ${category.name}?` });
			box.createEl("p", {
				cls: "bc-ci-prompt-text",
				text: `Your choice is remembered for every ${category.name}. You can change it in the settings.`,
			});
			const row = box.createDiv({ cls: "bc-ci-chips" });
			for (const t of settings.checkinTags) {
				chip(row, t, this.categoryTag === t, () => {
					this.categoryTag = t;
					this.extras.delete(t);
					this.render();
				});
			}
			chip(row, "No tag for this category", this.categoryTag === "", () => {
				this.categoryTag = "";
				this.render();
			});
			this.addNewChip(row, (t) => {
				this.categoryTag = t;
				this.render();
			});
		}

		const lower = (t: string) => t.toLowerCase();
		const always = new Set(settings.alwaysTags.map(lower));
		const chosen = [this.useCategoryTag ? this.categoryTag : "", ...this.extras].filter(
			(t): t is string => Boolean(t)
		);
		const chosenKeys = new Set(chosen.map(lower));
		this.chipsLabel.setText(
			category && this.categoryTag && this.remembered !== undefined
				? `Tags · ${this.categoryTag} is remembered for every ${category.name}`
				: "Tags"
		);
		const chips = this.chips;
		chips.empty();
		for (const t of settings.alwaysTags) fixedChip(chips, `${t} · always`);
		if (this.categoryTag && category) {
			if (this.promptBox) fixedChip(chips, `${this.categoryTag} · for ${category.name}`, true);
			else {
				const tag = this.categoryTag;
				chip(chips, this.useCategoryTag ? `✓ ${tag}` : tag, this.useCategoryTag, () => {
					this.useCategoryTag = !this.useCategoryTag;
					this.render();
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
			if (k === lower(this.categoryTag ?? "") || always.has(k) || impliedShown.has(k)) continue;
			chip(chips, t, this.extras.has(t), () => {
				if (this.extras.has(t)) this.extras.delete(t);
				else this.extras.add(t);
				this.render();
			});
		}
		this.addNewChip(chips, (t) => {
			this.extras.add(t);
			this.render();
		});
		this.onChange();
	}

	private addNewChip(row: HTMLElement, onAdd: (tag: string) => void): void {
		const btn = row.createEl("button", { cls: "bc-ci-chip bc-ci-chip-new", text: "+ new" });
		btn.onclick = () => {
			const input = createEl("input", {
				cls: "bc-ci-new-tag",
				attr: { placeholder: "New tag", "aria-label": "New tag" },
			});
			let finished = false;
			const done = () => {
				if (finished) return;
				finished = true;
				const t = normalizeTag(input.value);
				if (t) {
					if (!this.settings.checkinTags.some((x) => x.toLowerCase() === t.toLowerCase())) {
						this.settings.checkinTags.push(t);
					}
					onAdd(t);
				} else this.render();
			};
			input.addEventListener("keydown", (ev) => {
				if (ev.key === "Enter") done();
				if (ev.key === "Escape") {
					finished = true;
					this.render();
				}
			});
			input.addEventListener("blur", done);
			btn.replaceWith(input);
			window.setTimeout(() => input.focus(), 20);
		};
	}
}

/**
 * "Note name" for a place that has no note yet: the suggested name, editable.
 * Returns a getter for the name to use.
 */
export function noteNameField(container: HTMLElement, suggested: string): () => string {
	const box = container.createDiv({ cls: "bc-ci-section" });
	const id = `bc-ci-name-${Math.random().toString(36).slice(2, 8)}`;
	box.createEl("label", { cls: "bc-ci-label", text: "Note name", attr: { for: id } });
	const input = box.createEl("input", { cls: "bc-ci-input", attr: { id, type: "text" } });
	input.value = suggested;
	const hint = box.createEl("p", { cls: "bc-ci-hint" });
	const update = () => {
		const cleaned = cleanFileName(input.value);
		hint.setText(
			!cleaned
				? `Needs a name. These can't be used: ${NOT_ALLOWED_IN_NAMES}`
				: cleaned !== input.value.trim()
					? `Will be saved as "${cleaned}" (these can't be used: ${NOT_ALLOWED_IN_NAMES})`
					: ""
		);
	};
	input.addEventListener("input", update);
	update();
	return () => cleanFileName(input.value) || suggested;
}

/**
 * "Rating": the values you already use in Rating properties (most used
 * first) as chips, plus "+ new". Starts on the note's current rating.
 * Returns a getter: the chosen rating, or "" for none (nothing is removed).
 */
export function ratingField(container: HTMLElement, app: App, current: string): () => string {
	const box = container.createDiv({ cls: "bc-ci-section" });
	box.createEl("p", { cls: "bc-ci-label", text: "Rating" });
	const row = box.createDiv({ cls: "bc-ci-chips" });
	const values = propertyValues(app, RATING);
	if (current && !values.includes(current)) values.unshift(current);
	let chosen = current;
	const render = () => {
		row.empty();
		for (const v of values) {
			chip(row, v, v === chosen, () => {
				chosen = chosen === v ? "" : v;
				render();
			});
		}
		const add = row.createEl("button", { cls: "bc-ci-chip bc-ci-chip-new", text: "+ new" });
		add.onclick = () => {
			const input = createEl("input", {
				cls: "bc-ci-new-tag",
				attr: { placeholder: "New rating", "aria-label": "New rating" },
			});
			let finished = false;
			const done = () => {
				if (finished) return;
				finished = true;
				const v = input.value.trim();
				if (v) {
					if (!values.includes(v)) values.push(v);
					chosen = v;
				}
				render();
			};
			input.addEventListener("keydown", (ev) => {
				if (ev.key === "Enter") done();
				if (ev.key === "Escape") {
					finished = true;
					render();
				}
			});
			input.addEventListener("blur", done);
			add.replaceWith(input);
			window.setTimeout(() => input.focus(), 20);
		};
	};
	render();
	return () => chosen;
}

/** The note's current Rating, as text ("" when none). */
export function currentRating(app: App, file: TFile | null): string {
	if (!file) return "";
	const v: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.[RATING];
	if (typeof v === "string") return v.trim();
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string").join(", ");
	return "";
}

/** Search all notes by name and pick one (to link a place to a note named differently). */
export class NoteSearchModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly pwPlacesFolder: string,
		private readonly pwOnPick: (file: TFile) => void
	) {
		super(app);
		this.setPlaceholder("Find the note for this place");
	}

	getItems(): TFile[] {
		const folder = this.pwPlacesFolder.replace(/^\/+|\/+$/g, "");
		const files = this.app.vault.getMarkdownFiles();
		// Notes in the places folder first.
		return [
			...files.filter((f) => folder && f.path.startsWith(`${folder}/`)),
			...files.filter((f) => !folder || !f.path.startsWith(`${folder}/`)),
		];
	}

	getItemText(file: TFile): string {
		return file.path.replace(/\.md$/, "");
	}

	onChooseItem(file: TFile): void {
		this.pwOnPick(file);
	}
}
