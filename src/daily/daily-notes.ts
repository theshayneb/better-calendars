import { App, Notice, TFile, moment } from "obsidian";
import type { Moment } from "moment";
import { BetterCalendarsSettings } from "../settings";
import { renderDailyTemplate } from "../util/template";
import { runTemplaterIfAvailable } from "../util/templater";
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

/** The core Daily notes plugin's settings, if it is enabled. */
export function coreDailyNoteOptions(app: App): CoreDailyNotesOptions {
	const internal = (
		app as unknown as {
			internalPlugins?: {
				getPluginById?(id: string): {
					enabled?: boolean;
					instance?: { options?: CoreDailyNotesOptions };
				} | null;
			};
		}
	).internalPlugins;
	const plugin = internal?.getPluginById?.("daily-notes");
	return plugin?.instance?.options ?? {};
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

export function getDailyNote(
	app: App,
	config: DailyNoteConfig,
	date: Moment
): TFile | null {
	const file = app.vault.getAbstractFileByPath(dailyNotePath(config, date));
	return file instanceof TFile ? file : null;
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
		file = await app.vault.create(path, body);
	} catch (e) {
		// Lost a race (sync or a parallel call): use the note that won.
		const raced = getDailyNote(app, config, date);
		if (raced) return raced;
		throw e;
	}
	if (settings.runTemplater) {
		try {
			await runTemplaterIfAvailable(app, file);
		} catch (e) {
			console.warn("[Better Calendars] Templater failed on", path, e);
		}
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
