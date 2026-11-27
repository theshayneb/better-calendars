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
export class FuzzySuggestModal<T> extends Modal {
	placeholder = "";
	setPlaceholder(p: string) {
		this.placeholder = p;
	}
	getItems(): T[] {
		return [];
	}
}
/** The last modal opened through `open()` in a test. */
export const opened: Modal[] = [];
const originalOpen = Modal.prototype.open;
Modal.prototype.open = function (this: Modal) {
	opened.push(this);
	originalOpen.call(this);
};

/** Enough of Setting and its components to draw a settings tab in jsdom. */
class Component<T> {
	value: T;
	changeCb: ((v: T) => unknown) | null = null;
	constructor(public inputEl: HTMLElement, initial: T) {
		this.value = initial;
	}
	setValue(v: T) {
		this.value = v;
		return this;
	}
	onChange(cb: (v: T) => unknown) {
		this.changeCb = cb;
		return this;
	}
	setPlaceholder() {
		return this;
	}
	addOption(value: string, text: string) {
		const o = document.createElement("option");
		o.value = value;
		o.textContent = text;
		this.inputEl.appendChild(o);
		return this;
	}
	setButtonText(t: string) {
		this.inputEl.textContent = t;
		return this;
	}
	setCta() {
		return this;
	}
	setWarning() {
		return this;
	}
	setDisabled() {
		return this;
	}
	setIcon() {
		return this;
	}
	setTooltip() {
		return this;
	}
	onClick(cb: () => unknown) {
		this.changeCb = cb as never;
		return this;
	}
}
export class Setting {
	settingEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;
	controlEl: HTMLElement;
	constructor(containerEl: HTMLElement) {
		this.settingEl = containerEl.createDiv({ cls: "setting-item" });
		this.nameEl = this.settingEl.createDiv({ cls: "setting-item-name" });
		this.descEl = this.settingEl.createDiv({ cls: "setting-item-description" });
		this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
	}
	setName(n: string) {
		this.nameEl.setText(n);
		return this;
	}
	setDesc(d: string) {
		this.descEl.setText(d);
		return this;
	}
	setHeading() {
		return this;
	}
	setClass(c: string) {
		this.settingEl.addClass(c);
		return this;
	}
	private add<T>(tag: keyof HTMLElementTagNameMap, initial: T, cb: (c: Component<T>) => unknown) {
		cb(new Component<T>(this.controlEl.createEl(tag), initial));
		return this;
	}
	addText(cb: (c: Component<string>) => unknown) {
		return this.add("input", "", cb);
	}
	addTextArea(cb: (c: Component<string>) => unknown) {
		return this.add("textarea", "", cb);
	}
	addToggle(cb: (c: Component<boolean>) => unknown) {
		return this.add("input", false, cb);
	}
	addDropdown(cb: (c: Component<string>) => unknown) {
		return this.add("select", "", cb);
	}
	addButton(cb: (c: Component<void>) => unknown) {
		return this.add("button", undefined, cb);
	}
	addExtraButton(cb: (c: Component<void>) => unknown) {
		return this.add("button", undefined, cb);
	}
}
export class PluginSettingTab {
	containerEl: HTMLElement = document.createElement("div");
	hidden = 0;
	constructor(public app: unknown, public plugin: unknown) {}
	hide() {
		this.hidden++;
	}
}
