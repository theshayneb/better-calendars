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
 * How long a new note stays hidden from Templater's own "trigger on new
 * file creation" after we ran Templater on it. That trigger fires about
 * 300 ms after the note is created.
 */
const TRIGGER_GUARD_MS = 2000;

/** Templater keeps one shared `tp` state, so runs must not overlap. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Create a note and, if asked and Templater is installed, run Templater on
 * it. Notes are handled one at a time, and Templater only runs once
 * Obsidian has read the new note's properties (so tp.frontmatter works).
 * Templater's own new-file trigger is kept off the note until well after
 * that: if it ran on this note while we process the next one, the shared
 * tp state (tp.file.title, ...) would belong to the wrong note.
 */
export function createNote(
	app: App,
	path: string,
	body: string,
	runTemplater: boolean
): Promise<TFile> {
	const run = queue.then(() => createNow(app, path, body, runTemplater));
	queue = run.catch(() => undefined);
	return run;
}

async function createNow(
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
		// Templater removes the path when its run ends; put it back for a while.
		pending?.add(path);
		window.setTimeout(() => pending?.delete(path), TRIGGER_GUARD_MS);
	}
}
