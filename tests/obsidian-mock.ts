// The pure modules only need Obsidian's moment (and requestUrl for typing).
import moment from "moment";
export { moment };
export const requestUrl = () => {
	throw new Error("not available in tests");
};
export class TFile {
	path = "";
	basename = "";
}
export class TFolder {}
export const normalizePath = (p: string) => p.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
/** Good enough for the tests: JSON values are valid YAML. */
export const stringifyYaml = (obj: Record<string, unknown>) =>
	Object.entries(obj)
		.map(([k, v]) => `${k}: ${JSON.stringify(v)}\n`)
		.join("");
export const notices: string[] = [];
export class Notice {
	constructor(message: string) {
		notices.push(message);
	}
}
export class Modal {
	contentEl: HTMLElement;
	modalEl: HTMLElement;
	title = "";
	constructor(public app: unknown) {
		this.contentEl = document.createElement("div");
		this.modalEl = document.createElement("div");
	}
	setTitle(t: string) {
		this.title = t;
		return this;
	}
	open() {
		(this as unknown as { onOpen?: () => void }).onOpen?.();
	}
	close() {
		(this as unknown as { onClose?: () => void }).onClose?.();
	}
}
export class AbstractInputSuggest {
	constructor(
		public app: unknown,
		public inputEl: HTMLInputElement
	) {}
	close() {}
}
export const Platform = { isMobile: false, isAndroidApp: false, isIosApp: false };
