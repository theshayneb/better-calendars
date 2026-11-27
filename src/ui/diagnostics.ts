import { App, Modal, Notice } from "obsidian";

/** Shows a block of diagnostic text with a Copy button (for sending to whoever is helping). */
export class DiagnosticsModal extends Modal {
	constructor(app: App, private readonly pwText: string) {
		super(app);
	}

	onOpen(): void {
		this.setTitle("Better Calendars diagnostics");
		const { contentEl } = this;
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: "Copy this and send it along with what you were doing.",
		});
		const pre = contentEl.createEl("pre", { cls: "bc-diagnostics", text: this.pwText });
		pre.setAttr("tabindex", "0");
		const button = contentEl.createEl("button", { cls: "mod-cta", text: "Copy" });
		button.onclick = async () => {
			try {
				await navigator.clipboard.writeText(this.pwText);
				new Notice("Copied.");
			} catch {
				// Some phones block the clipboard: select the text so it can be copied by hand.
				const range = document.createRange();
				range.selectNodeContents(pre);
				const sel = window.getSelection();
				sel?.removeAllRanges();
				sel?.addRange(range);
				new Notice("Couldn't copy; the text is selected, copy it by hand.");
			}
		};
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
