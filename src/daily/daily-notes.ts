import { App, Notice, TFile, moment } from "obsidian";
import type { Moment } from "moment";
import { BetterCalendarsSettings } from "../settings";
import { renderDailyTemplate } from "../util/template";
import { createNote } from "../util/templater";
import {
	ensureParentFolder,
	joinPath,
	resolveTemplateFile,
} from "../util/vault";

export const DEFAULT_DAILY_FORMAT = "YYYY-MM-DD";

export interface DailyNoteConfig {
	folder: string;
	format: string;
	template: string;
}

interface CoreDailyNotesOptions {
	folder?: string;
	format?: string;
	template?: string;
}

/**
 * Daily note settings of the plugin that manages daily notes: Periodic
 * Notes when its daily notes are on (like the Calendar plugin did),
 * otherwise the core Daily notes plugin (read even when it is disabled).
 */
export function coreDailyNoteOptions(app: App): CoreDailyNotesOptions {
	const periodic = periodicNotesDaily(app);
	if (periodic) return periodic;
	const internal = (
		app as unknown as {
			internalPlugins?: {
				plugins?: Record<string, { instance?: { options?: CoreDailyNotesOptions } } | undefined>;
				getPluginById?(id: string): { instance?: { options?: CoreDailyNotesOptions } } | null;
			};
		}
	).internalPlugins;
	return (
		internal?.getPluginById?.("daily-notes")?.instance?.options ??
		internal?.plugins?.["daily-notes"]?.instance?.options ??
		{}
	);
}

interface PeriodicDaily {
	enabled?: boolean;
	folder?: string;
	format?: string;
	template?: string;
	templatePath?: string;
}

function periodicNotesDaily(app: App): CoreDailyNotesOptions | null {
	const plugin = (
		app as unknown as {
			plugins?: { getPlugin?(id: string): unknown };
		}
	).plugins?.getPlugin?.("periodic-notes") as
		| {
				settings?: {
					daily?: PeriodicDaily;
					activeCalendarSet?: string;
					calendarSets?: { id?: string; day?: PeriodicDaily }[];
				};
		  }
		| null
		| undefined;
	const settings = plugin?.settings;
	if (!settings) return null;
	// Periodic Notes 1.x keeps settings per "calendar set".
	const set =
		settings.calendarSets?.find((c) => c.id === settings.activeCalendarSet) ??
		settings.calendarSets?.[0];
	const daily = set?.day ?? settings.daily;
	if (!daily?.enabled) return null;
	return {
		folder: daily.folder,
		format: daily.format,
		template: daily.template ?? daily.templatePath,
	};
}

/** Plugin settings win; empty ones fall back to the core Daily notes settings. */
export function dailyNoteConfig(
	app: App,
	settings: BetterCalendarsSettings
): DailyNoteConfig {
	const core = coreDailyNoteOptions(app);
	return {
		folder: (settings.dailyFolder || core.folder || "").trim(),
		format:
			(settings.dailyFormat || core.format || "").trim() ||
			DEFAULT_DAILY_FORMAT,
		template: (settings.dailyTemplate || core.template || "").trim(),
	};
}

export function dailyNotePath(config: DailyNoteConfig, date: Moment): string {
	return joinPath(config.folder, `${date.format(config.format)}.md`);
}

/** Markdown files by lower-case name; cleared whenever a file is created, deleted or renamed. */
let byName: { vault: unknown; map: Map<string, TFile[]> } | null = null;

export function invalidateDailyNoteIndex(): void {
	byName = null;
}

function filesNamed(app: App, basename: string): TFile[] {
	if (!byName || byName.vault !== app.vault) {
		const files = app.vault.getMarkdownFiles();
		const map = new Map<string, TFile[]>();
		for (const f of files) {
			const k = f.basename.toLowerCase();
			const list = map.get(k);
			if (list) list.push(f);
			else map.set(k, [f]);
		}
		byName = { vault: app.vault, map };
	}
	return (byName.map.get(basename.toLowerCase()) ?? []).filter((f) => app.vault.getFileByPath(f.path));
}

/**
 * The daily note for a date: at the configured path, or else a note with
 * that date's name somewhere else (e.g. older notes moved into year
 * folders), preferring the daily notes folder and its subfolders.
 */
export function getDailyNote(
	app: App,
	config: DailyNoteConfig,
	date: Moment
): TFile | null {
	const path = dailyNotePath(config, date);
	const file = app.vault.getAbstractFileByPath(path);
	if (file instanceof TFile) return file;
	const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
	const named = filesNamed(app, name);
	if (named.length === 0) return null;
	const folder = config.folder.replace(/^\/+|\/+$/g, "");
	return (folder ? named.find((f) => f.path.startsWith(`${folder}/`)) : undefined) ?? named[0] ?? null;
}

/** "[[2026-10-12]]", pointing at the daily note for that date (existing or not). */
export function dailyNoteLink(config: DailyNoteConfig, date: Moment): string {
	const path = dailyNotePath(config, date).replace(/\.md$/, "");
	const base = path.slice(path.lastIndexOf("/") + 1);
	return `[[${base}]]`;
}

/**
 * Create the daily note for `date` from the template. Returns the existing
 * note if there already is one.
 */
export async function createDailyNote(
	app: App,
	settings: BetterCalendarsSettings,
	date: Moment
): Promise<TFile> {
	const config = dailyNoteConfig(app, settings);
	const existing = getDailyNote(app, config, date);
	if (existing) return existing;

	const path = dailyNotePath(config, date);
	let body = "";
	if (config.template) {
		const templateFile = resolveTemplateFile(app, config.template);
		if (templateFile) {
			body = await app.vault.cachedRead(templateFile);
		} else {
			new Notice(
				`Better Calendars: daily note template "${config.template}" not found.`
			);
		}
	}
	const title = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
	body = renderDailyTemplate(body, date, config.format, title);

	await ensureParentFolder(app, path);
	let file: TFile;
	try {
		file = await createNote(app, path, body, settings.runTemplater);
	} catch (e) {
		// Lost a race (sync or a parallel call): use the note that won.
		const raced = getDailyNote(app, config, date);
		if (raced) return raced;
		throw e;
	}
	return file;
}

/** Create the missing daily notes for `days` days starting at `from`. Returns how many were created. */
export async function createDailyNotesAhead(
	app: App,
	settings: BetterCalendarsSettings,
	from: Moment,
	days: number
): Promise<number> {
	const config = dailyNoteConfig(app, settings);
	let created = 0;
	for (let i = 0; i < days; i++) {
		const date = from.clone().startOf("day").add(i, "day");
		if (getDailyNote(app, config, date)) continue;
		await createDailyNote(app, settings, date);
		created++;
	}
	return created;
}

export function today(): Moment {
	return moment().startOf("day");
}
