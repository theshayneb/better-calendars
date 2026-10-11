import { App, TFile, TFolder, normalizePath } from "obsidian";

export async function ensureFolder(app: App, folder: string): Promise<void> {
	const path = normalizePath(folder);
	if (!path || path === "/") return;
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFolder) return;
	if (existing) throw new Error(`"${path}" exists and is not a folder`);
	try {
		await app.vault.createFolder(path);
	} catch (e) {
		// Created in the meantime (sync, another call): fine.
		if (!(app.vault.getAbstractFileByPath(path) instanceof TFolder)) throw e;
	}
}

export async function ensureParentFolder(app: App, filePath: string): Promise<void> {
	const slash = filePath.lastIndexOf("/");
	if (slash > 0) await ensureFolder(app, filePath.slice(0, slash));
}

export function joinPath(folder: string, name: string): string {
	const f = folder.trim().replace(/^\/+|\/+$/g, "");
	return normalizePath(f ? `${f}/${name}` : name);
}

/** "Name.md", or "Name (2).md" etc. when the path is taken. */
export function uniquePath(app: App, path: string): string {
	if (!app.vault.getAbstractFileByPath(path)) return path;
	const dot = path.lastIndexOf(".");
	const stem = dot > 0 ? path.slice(0, dot) : path;
	const ext = dot > 0 ? path.slice(dot) : "";
	for (let i = 2; i < 1000; i++) {
		const candidate = `${stem} (${i})${ext}`;
		if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
	}
	return path;
}

/** Resolve a template setting ("Templates/Daily", "Templates/Daily.md") to a file. */
export function resolveTemplateFile(app: App, path: string): TFile | null {
	const p = path.trim();
	if (!p) return null;
	const direct = app.vault.getAbstractFileByPath(normalizePath(p));
	if (direct instanceof TFile) return direct;
	const withMd = app.vault.getAbstractFileByPath(normalizePath(`${p}.md`));
	if (withMd instanceof TFile) return withMd;
	return app.metadataCache.getFirstLinkpathDest(p, "");
}

export async function openFile(app: App, file: TFile, newTab: boolean): Promise<void> {
	await app.workspace.getLeaf(newTab ? "tab" : false).openFile(file);
}
