import { App, Notice, TFile, moment } from "obsidian";
import type BetterCalendarsPlugin from "../main";
import { CalEvent, CalendarSource } from "../types";
import { dailyNoteConfig, dailyNoteLink } from "../daily/daily-notes";
import {
	DEFAULT_EVENT_TEMPLATE,
	renderEventTemplate,
	sanitizeFilename,
} from "../util/template";
import { runTemplaterIfAvailable } from "../util/templater";
import { PersonNote, buildPeopleIndex, selectAttendees } from "../util/attendees";
import {
	FM_EVENT_ID,
	FM_LEGACY_EVENT_DATE,
	findIsoDate,
	withEventFrontmatter,
} from "./with-frontmatter";
import {
	ensureFolder,
	joinPath,
	resolveTemplateFile,
	uniquePath,
} from "../util/vault";

/** Finds event notes by the `event_id` in their frontmatter. */
export class EventNoteIndex {
	private byId: Map<string, TFile> | null = null;

	constructor(private readonly plugin: BetterCalendarsPlugin) {
		const app = plugin.app;
		const invalidate = () => {
			this.byId = null;
		};
		plugin.registerEvent(app.metadataCache.on("changed", invalidate));
		plugin.registerEvent(app.metadataCache.on("resolved", invalidate));
		plugin.registerEvent(app.vault.on("delete", invalidate));
		plugin.registerEvent(app.vault.on("rename", invalidate));
	}

	get(eventId: string): TFile | null {
		if (!this.byId) this.byId = this.build();
		return this.byId.get(eventId) ?? null;
	}

	private build(): Map<string, TFile> {
		const map = new Map<string, TFile>();
		const { vault, metadataCache } = this.plugin.app;
		for (const file of vault.getMarkdownFiles()) {
			const id: unknown =
				metadataCache.getFileCache(file)?.frontmatter?.[FM_EVENT_ID];
			if (typeof id === "string" && id && !map.has(id)) map.set(id, file);
		}
		return map;
	}
}

export interface ImportResult {
	/** Notes created in this run. */
	created: number;
	/** Events in the window whose note was created before and has since been deleted. */
	skipped: number;
	/** Events in the import window, from calendars that import automatically. */
	inWindow: number;
}

export class EventImporter {
	private importing: Promise<ImportResult> | null = null;

	constructor(
		private readonly plugin: BetterCalendarsPlugin,
		private readonly index: EventNoteIndex
	) {}

	private get app(): App {
		return this.plugin.app;
	}

	calendarFor(event: CalEvent): CalendarSource | undefined {
		return this.plugin.settings.calendars.find(
			(c) => c.id === event.calendarId
		);
	}

	findNote(event: CalEvent): TFile | null {
		return this.index.get(event.id);
	}

	/**
	 * Create notes for every event in the import window that doesn't have
	 * one yet. Events whose note was created before (and maybe deleted
	 * since) are left alone.
	 */
	importNow(): Promise<ImportResult> {
		if (this.importing) return this.importing;
		this.importing = this.doImport().finally(() => {
			this.importing = null;
		});
		return this.importing;
	}

	private async doImport(): Promise<ImportResult> {
		const settings = this.plugin.settings;
		const from = moment()
			.startOf("day")
			.subtract(Math.max(0, settings.importDaysBack), "days");
		const to = moment()
			.startOf("day")
			.add(Math.max(0, settings.importDaysAhead) + 1, "days");

		let created = 0;
		let skipped = 0;
		let inWindow = 0;
		let changed = false;
		for (const event of this.plugin.manager.allEvents()) {
			const calendar = this.calendarFor(event);
			if (!calendar || !calendar.enabled || !calendar.autoImport) continue;
			if (event.start < from.toDate() || event.start >= to.toDate()) continue;
			inWindow++;

			const note = this.findNote(event);
			if (note) {
				await this.followReschedule(note, event);
				if (settings.imported[event.id] === undefined) {
					settings.imported[event.id] = event.start.getTime();
					changed = true;
				}
				continue;
			}
			if (settings.imported[event.id] !== undefined) {
				skipped++;
				continue;
			}

			try {
				await this.createNote(event, calendar);
				settings.imported[event.id] = event.start.getTime();
				changed = true;
				created++;
			} catch (e) {
				console.warn(
					`[Better Calendars] could not create a note for "${event.title}"`,
					e
				);
			}
		}

		// Forget old entries so the record doesn't grow forever.
		const cutoff = moment()
			.startOf("day")
			.subtract(Math.max(0, settings.importDaysBack) + 60, "days")
			.valueOf();
		for (const [id, start] of Object.entries(settings.imported)) {
			if (start < cutoff) {
				delete settings.imported[id];
				changed = true;
			}
		}

		if (changed) await this.plugin.saveSettings();
		return { created, skipped, inWindow };
	}

	/** Open the event's note, creating it first if needed. */
	async openOrCreate(event: CalEvent, newTab: boolean): Promise<void> {
		let note = this.findNote(event);
		if (!note) {
			const calendar = this.calendarFor(event);
			if (!calendar) {
				new Notice("Better Calendars: calendar not found.");
				return;
			}
			note = await this.createNote(event, calendar);
			this.plugin.settings.imported[event.id] = event.start.getTime();
			await this.plugin.saveSettings();
		}
		await this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(note);
	}

	async createNote(event: CalEvent, calendar: CalendarSource): Promise<TFile> {
		const settings = this.plugin.settings;
		const folder = (calendar.folder || settings.eventFolder).trim();
		const pattern =
			calendar.titlePattern.trim() ||
			settings.eventTitlePattern.trim() ||
			"{{date}} {{title}}";
		const templatePath = (calendar.template || settings.eventTemplate).trim();

		let template = DEFAULT_EVENT_TEMPLATE;
		if (templatePath) {
			const file = resolveTemplateFile(this.app, templatePath);
			if (file) {
				template = await this.app.vault.cachedRead(file);
			} else {
				new Notice(
					`Better Calendars: event template "${templatePath}" not found, using the built-in one.`
				);
			}
		}

		const ctx = {
			event,
			calendarName: calendar.name,
			attendees: selectAttendees(
				event.attendees,
				{
					filter: settings.attendeeFilter,
					format: settings.attendeeFormat,
					exclude: settings.attendeeExclude,
					linkUnmatched: settings.linkUnmatchedAttendees,
				},
				event.attendees.length > 0 ? this.peopleIndex(joinPath(folder, "event.md")) : null
			),
			dailyNoteLink: dailyNoteLink(
				dailyNoteConfig(this.app, settings),
				moment(event.start)
			),
		};
		const name =
			sanitizeFilename(renderEventTemplate(pattern, ctx)) || "Untitled event";
		let path = joinPath(folder, `${name}.md`);

		// Already there (e.g. created on another device and synced before
		// the metadata cache caught up): reuse it.
		const existing = this.app.vault.getFileByPath(path);
		if (existing && (await this.noteHasId(existing, event.id))) return existing;
		path = uniquePath(this.app, path);

		const body = withEventFrontmatter(
			renderEventTemplate(template, ctx),
			event.id,
			settings.eventDateProperty.trim(),
			moment(event.start).format("YYYY-MM-DD")
		);
		if (folder) await ensureFolder(this.app, folder);
		const file = await this.app.vault.create(path, body);
		if (settings.runTemplater) {
			try {
				await runTemplaterIfAvailable(this.app, file);
			} catch (e) {
				console.warn("[Better Calendars] Templater failed on", path, e);
			}
		}
		return file;
	}

	/** Person notes in the People folder (or the whole vault), for linking guests. */
	private peopleIndex(sourcePath: string) {
		const { vault, metadataCache } = this.app;
		const folder = this.plugin.settings.peopleFolder.trim().replace(/^\/+|\/+$/g, "");
		const notes: PersonNote[] = [];
		for (const file of vault.getMarkdownFiles()) {
			if (folder && !file.path.startsWith(`${folder}/`)) continue;
			const fm = metadataCache.getFileCache(file)?.frontmatter ?? {};
			const list = (v: unknown): string[] =>
				Array.isArray(v)
					? v.filter((x): x is string => typeof x === "string")
					: typeof v === "string"
						? [v]
						: [];
			const emails: string[] = [];
			for (const [key, value] of Object.entries(fm)) {
				if (/^e-?mails?$/i.test(key)) emails.push(...list(value));
			}
			notes.push({
				linktext: metadataCache.fileToLinktext(file, sourcePath, true),
				basename: file.basename,
				aliases: [...list(fm.aliases), ...list(fm.alias)],
				emails: emails.map((e) => e.replace(/^mailto:/i, "").trim()),
			});
		}
		return buildPeopleIndex(notes);
	}

	private async noteHasId(file: TFile, id: string): Promise<boolean> {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (fm) return fm[FM_EVENT_ID] === id;
		const text = await this.app.vault.cachedRead(file);
		return text.includes(`${FM_EVENT_ID}: ${JSON.stringify(id)}`);
	}

	/** An event moved to another day: update the date property and the file name. */
	private async followReschedule(note: TFile, event: CalEvent): Promise<void> {
		const prop = this.plugin.settings.eventDateProperty.trim();
		const fm = this.app.metadataCache.getFileCache(note)?.frontmatter;
		if (!fm) return;
		const current = prop ? findIsoDate(fm[prop]) : null;
		const legacy = findIsoDate(fm[FM_LEGACY_EVENT_DATE]);
		const oldDate = current ?? legacy;
		const newDate = moment(event.start).format("YYYY-MM-DD");
		if (!oldDate || oldDate === newDate) return;

		await this.app.fileManager.processFrontMatter(
			note,
			(data: Record<string, unknown>) => {
				if (prop) {
					const value = data[prop];
					// Keep the value's shape, e.g. "[[2026-10-12]]".
					data[prop] =
						typeof value === "string" && value.includes(oldDate)
							? value.split(oldDate).join(newDate)
							: newDate;
				}
				delete data[FM_LEGACY_EVENT_DATE];
			}
		);
		if (note.basename.includes(oldDate)) {
			const newName = note.basename.split(oldDate).join(newDate);
			const parent = note.parent?.path ?? "";
			const target = uniquePath(
				this.app,
				joinPath(parent === "/" ? "" : parent, `${newName}.md`)
			);
			await this.app.fileManager.renameFile(note, target);
		}
	}
}
