import { App, Notice, TFile, moment } from "obsidian";
import type BetterCalendarsPlugin from "../main";
import { CalEvent, CalendarSource } from "../types";
import { dailyNoteConfig, dailyNoteLink } from "../daily/daily-notes";
import {
	DEFAULT_EVENT_TEMPLATE,
	EventTemplateContext,
	eventEndDate,
	renderEventTemplate,
	sanitizeFilename,
} from "../util/template";
import { createNote } from "../util/templater";
import {
	AttendeeText,
	PersonNote,
	buildPeopleIndex,
	personKey,
	selectAttendees,
	syncPeople,
} from "../util/attendees";
import {
	FM_EVENT_ID,
	FM_LEGACY_EVENT_DATE,
	fillEmptyProperties,
	findIsoDate,
	movedValue,
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
				if (await this.followPeople(note, event)) changed = true;
				if (await this.followTitle(note, event)) changed = true;
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
		for (const id of Object.keys(settings.peopleAdded)) {
			if (settings.imported[id] === undefined) {
				delete settings.peopleAdded[id];
				changed = true;
			}
		}
		for (const id of Object.keys(settings.noteNames)) {
			if (settings.imported[id] === undefined) {
				delete settings.noteNames[id];
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

		const ctx: EventTemplateContext = {
			event,
			calendarName: calendar.name,
			attendees: this.attendeesFor(event, joinPath(folder, "event.md")),
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

		let rendered = renderEventTemplate(template, ctx);
		if (settings.fillEmptyProperties) {
			rendered = fillEmptyProperties(rendered, this.propertyValues(ctx));
		}
		const body = withEventFrontmatter(
			rendered,
			event.id,
			settings.eventDateProperty.trim(),
			this.dateValue(event, "start")
		);
		if (folder) await ensureFolder(this.app, folder);
		const file = await createNote(this.app, path, body, settings.runTemplater);
		settings.noteNames[event.id] = { name: file.basename, title: event.title };
		// Remember which guests we wrote, so only those are ever removed again.
		if (ctx.attendees.length > 0) {
			settings.peopleAdded[event.id] = ctx.attendees.map((a) => a.link);
		}
		return file;
	}

	/** 2026-10-12T15:00 (timed events, if times are on) or 2026-10-12. The end date of all-day events is inclusive. */
	private dateValue(e: CalEvent, which: "start" | "end"): string {
		const dateTime = this.dateTimeOf(e, which);
		if (dateTime) return dateTime;
		return which === "start" ? moment(e.start).format("YYYY-MM-DD") : eventEndDate(e);
	}

	private dateTimeOf(e: CalEvent, which: "start" | "end"): string | null {
		if (e.allDay || !this.plugin.settings.includeTimes) return null;
		return moment(which === "start" ? e.start : e.end).format("YYYY-MM-DDTHH:mm");
	}

	private attendeesFor(event: CalEvent, sourcePath: string): AttendeeText[] {
		const settings = this.plugin.settings;
		return selectAttendees(
			event.attendees,
			{
				filter: settings.attendeeFilter,
				format: settings.attendeeFormat,
				exclude: settings.attendeeExclude,
				linkUnmatched: settings.linkUnmatchedAttendees,
			},
			event.attendees.length > 0 ? this.peopleIndex(sourcePath) : null
		);
	}

	/**
	 * Add guests who accepted since, and remove guests the plugin added who
	 * declined or were taken off the invite. Only touches notes that have the
	 * People property. Returns true when the plugin's record changed.
	 */
	private async followPeople(note: TFile, event: CalEvent): Promise<boolean> {
		const settings = this.plugin.settings;
		const prop = settings.eventPeopleProperty.trim();
		if (!settings.syncPeople || !prop) return false;
		const fm = this.app.metadataCache.getFileCache(note)?.frontmatter;
		if (!fm || !(prop in fm)) return false;

		const raw: unknown = fm[prop];
		const current = Array.isArray(raw)
			? raw.filter((v): v is string => typeof v === "string")
			: typeof raw === "string" && raw.trim()
				? [raw]
				: [];
		const wanted = this.attendeesFor(event, note.path).map((a) => a.link);
		let added = settings.peopleAdded[event.id];
		if (!added) {
			// Notes from before this was tracked: count the entries that are
			// guests of this event as ours.
			const guests = new Set(
				selectAttendees(
					event.attendees,
					{
						filter: "all",
						format: settings.attendeeFormat,
						exclude: "",
						linkUnmatched: settings.linkUnmatchedAttendees,
					},
					event.attendees.length > 0 ? this.peopleIndex(note.path) : null
				).flatMap((a) => [personKey(a.link), personKey(a.text)])
			);
			added = current.filter((v) => guests.has(personKey(v)));
		}

		const result = syncPeople(current, wanted, added);
		if (result.changed) {
			await this.app.fileManager.processFrontMatter(
				note,
				(data: Record<string, unknown>) => {
					data[prop] = result.list;
				}
			);
		}
		const before = JSON.stringify(settings.peopleAdded[event.id] ?? null);
		settings.peopleAdded[event.id] = result.added;
		return before !== JSON.stringify(result.added);
	}

	/** Values for empty template properties, by lower-case property name. */
	private propertyValues(ctx: EventTemplateContext): Map<string, string> {
		const settings = this.plugin.settings;
		const e = ctx.event;
		const values = new Map<string, string>();
		const set = (names: string[], value: string) => {
			if (!value) return;
			for (const n of names) {
				const key = n.trim().toLowerCase();
				if (key && !values.has(key)) values.set(key, value);
			}
		};
		const text = (s: string) => (s ? JSON.stringify(s) : "");
		const time = (d: Date) => (e.allDay ? "" : text(moment(d).format("HH:mm")));
		set([settings.eventDateProperty, "date"], this.dateValue(e, "start"));
		set([settings.eventEndDateProperty, "end_date", "end date"], this.dateValue(e, "end"));
		if (ctx.attendees.length > 0) {
			set(
				[settings.eventPeopleProperty, "people", "attendees", "participants"],
				`[${ctx.attendees.map((a) => JSON.stringify(a.link)).join(", ")}]`
			);
		}
		set(["title"], text(e.title));
		set(["start", "start_time", "start time"], time(e.start));
		set(["end", "end_time", "end time"], time(e.end));
		set(
			["time"],
			e.allDay ? text("All day") : text(`${moment(e.start).format("HH:mm")}–${moment(e.end).format("HH:mm")}`)
		);
		set(["location", "where", "place"], text(e.location));
		set(["link", "url", "meeting_url", "meeting link", "meeting_link"], text(e.meetingUrl));
		set(["organizer", "organiser"], text(e.organizer));
		set(["calendar"], text(ctx.calendarName));
		set(["description"], text(e.description));
		set(["daily_note", "daily note", "day"], text(ctx.dailyNoteLink));
		return values;
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

	/**
	 * An event moved (other day or other time): update the date and end
	 * date properties, and the file name if it contains the old date.
	 */
	private async followReschedule(note: TFile, event: CalEvent): Promise<void> {
		const settings = this.plugin.settings;
		const prop = settings.eventDateProperty.trim();
		const endProp = settings.eventEndDateProperty.trim();
		const fm = this.app.metadataCache.getFileCache(note)?.frontmatter;
		if (!fm) return;
		const newDate = moment(event.start).format("YYYY-MM-DD");
		const legacy = findIsoDate(fm[FM_LEGACY_EVENT_DATE]);
		const oldDate = (prop ? findIsoDate(fm[prop]) : null) ?? legacy;
		const startValue = prop
			? movedValue(fm[prop], newDate, this.dateTimeOf(event, "start"))
			: null;
		const endValue = endProp
			? movedValue(fm[endProp], eventEndDate(event), this.dateTimeOf(event, "end"))
			: null;
		const legacyMoved = legacy !== null && legacy !== newDate;
		if (startValue === null && endValue === null && !legacyMoved) return;

		await this.app.fileManager.processFrontMatter(
			note,
			(data: Record<string, unknown>) => {
				if (startValue !== null) data[prop] = startValue;
				else if (legacyMoved && prop && data[prop] === undefined) {
					data[prop] = this.dateValue(event, "start");
				}
				if (endValue !== null) data[endProp] = endValue;
				if (legacy !== null) delete data[FM_LEGACY_EVENT_DATE];
			}
		);
		const dateMoved = oldDate !== null && oldDate !== newDate;
		if (dateMoved && oldDate && note.basename.includes(oldDate)) {
			await this.renameNote(note, event, note.basename.split(oldDate).join(newDate));
		}
	}

	/** Rename a note in its folder, keeping the record of its plugin-given name current. */
	private async renameNote(note: TFile, event: CalEvent, newName: string): Promise<void> {
		const oldName = note.basename;
		if (!newName || newName === oldName) return;
		const parent = note.parent?.path ?? "";
		const target = uniquePath(
			this.app,
			joinPath(parent === "/" ? "" : parent, `${newName}.md`)
		);
		await this.app.fileManager.renameFile(note, target);
		const record = this.plugin.settings.noteNames[event.id];
		if (record && record.name === oldName) record.name = note.basename;
	}

	/**
	 * The event was renamed in the calendar: put the new title in the file
	 * name (where the old one was) and in a `title` property that still has
	 * the old title. Notes you renamed yourself keep their name. Returns true
	 * when the plugin's record changed.
	 */
	private async followTitle(note: TFile, event: CalEvent): Promise<boolean> {
		const records = this.plugin.settings.noteNames;
		const record = records[event.id];
		if (!record) {
			// Notes from before titles were tracked: start from what's there.
			records[event.id] = { name: note.basename, title: event.title };
			return true;
		}
		if (record.title === event.title) return false;

		const oldTitle = record.title;
		record.title = event.title;
		const fm = this.app.metadataCache.getFileCache(note)?.frontmatter ?? {};
		const titleKeys = Object.keys(fm).filter(
			(k) => k.toLowerCase() === "title" && fm[k] === oldTitle
		);
		if (titleKeys.length > 0) {
			await this.app.fileManager.processFrontMatter(
				note,
				(data: Record<string, unknown>) => {
					for (const k of titleKeys) data[k] = event.title;
				}
			);
		}
		const oldPart = sanitizeFilename(oldTitle);
		const newPart = sanitizeFilename(event.title);
		if (note.basename === record.name && oldPart && newPart && note.basename.includes(oldPart)) {
			await this.renameNote(note, event, note.basename.split(oldPart).join(newPart));
		}
		return true;
	}
}
