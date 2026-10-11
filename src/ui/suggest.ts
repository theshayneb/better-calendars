import { AbstractInputSuggest, App, TFile, TFolder } from "obsidian";

/** Suggests vault folders in a text input. */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(
		app: App,
		private readonly pwInput: HTMLInputElement,
		private readonly pwOnPick: (path: string) => void
	) {
		super(app, pwInput);
	}

	protected getSuggestions(query: string): TFolder[] {
		const q = query.toLowerCase();
		return this.app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder && !f.isRoot())
			.filter((f) => f.path.toLowerCase().includes(q))
			.slice(0, 50);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.pwInput.value = folder.path;
		this.pwOnPick(folder.path);
		this.close();
	}
}

/** Suggests markdown files in a text input (used for templates). */
export class FileSuggest extends AbstractInputSuggest<TFile> {
	constructor(
		app: App,
		private readonly pwInput: HTMLInputElement,
		private readonly pwOnPick: (path: string) => void
	) {
		super(app, pwInput);
	}

	protected getSuggestions(query: string): TFile[] {
		const q = query.toLowerCase();
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.toLowerCase().includes(q))
			.slice(0, 50);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	selectSuggestion(file: TFile): void {
		this.pwInput.value = file.path;
		this.pwOnPick(file.path);
		this.close();
	}
}
