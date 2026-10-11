import { App, TFile } from "obsidian";

interface TemplaterInternals {
	overwrite_file_commands?: (file: TFile) => Promise<void>;
	/** Paths Templater is busy with; its "on new file" trigger skips them. */
	files_with_pending_templates?: Set<string>;
}

function templaterOf(app: App): TemplaterInternals | null {
	const plugin = (
		app as unknown as {
			plugins?: {
				plugins?: Record<string, { templater?: TemplaterInternals } | undefined>;
			};
		}
	).plugins?.plugins?.["templater-obsidian"];
	const templater = plugin?.templater;
	return typeof templater?.overwrite_file_commands === "function" ? templater : null;
}

/** Resolves once Obsidian has indexed the file (properties readable), or after `timeoutMs`. */
function waitForMetadata(app: App, file: TFile, timeoutMs = 3000): Promise<void> {
	if (app.metadataCache.getFileCache(file)) return Promise.resolve();
	return new Promise((resolve) => {
		const ref = app.metadataCache.on("changed", (changed) => {
			if (changed.path === file.path) done();
		});
		const timer = window.setTimeout(done, timeoutMs);
		function done() {
			window.clearTimeout(timer);
			app.metadataCache.offref(ref);
			resolve();
		}
	});
}

/**
 * Create a note and, if asked and Templater is installed, run Templater on
 * it. Templater only runs once Obsidian has read the new note's properties,
 * so templates that use tp.frontmatter (e.g. a Date property on a note
 * created in advance) see the note's own values. Until then Templater's own
 * "trigger on new file creation" is kept off this note, so it isn't
 * processed early with empty properties.
 */
export async function createNote(
	app: App,
	path: string,
	body: string,
	runTemplater: boolean
): Promise<TFile> {
	const templater = runTemplater ? templaterOf(app) : null;
	const pending = templater?.files_with_pending_templates;
	pending?.add(path);
	try {
		const file = await app.vault.create(path, body);
		if (templater?.overwrite_file_commands) {
			await waitForMetadata(app, file);
			try {
				await templater.overwrite_file_commands(file);
			} catch (e) {
				console.warn("[Better Calendars] Templater failed on", path, e);
			}
		}
		return file;
	} finally {
		pending?.delete(path);
	}
}
