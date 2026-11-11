// Obsidian's DOM helpers, for tests that draw a screen in jsdom.
type Opts = { cls?: string; text?: string; attr?: Record<string, string> };

function make<K extends keyof HTMLElementTagNameMap>(tag: K, o?: Opts | string): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	const opts: Opts = typeof o === "string" ? { cls: o } : (o ?? {});
	if (opts.cls) el.className = opts.cls;
	if (opts.text !== undefined) el.textContent = opts.text;
	for (const [k, v] of Object.entries(opts.attr ?? {})) el.setAttribute(k, v);
	return el;
}

const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
proto.createEl = function (this: HTMLElement, tag: keyof HTMLElementTagNameMap, o?: Opts) {
	return this.appendChild(make(tag, o));
};
proto.createDiv = function (this: HTMLElement, o?: Opts) {
	return this.appendChild(make("div", o));
};
proto.createSpan = function (this: HTMLElement, o?: Opts) {
	return this.appendChild(make("span", o));
};
proto.empty = function (this: HTMLElement) {
	this.replaceChildren();
};
proto.setText = function (this: HTMLElement, t: string) {
	this.textContent = t;
};
proto.appendText = function (this: HTMLElement, t: string) {
	this.append(t);
};
proto.toggle = function (this: HTMLElement, show: boolean) {
	this.style.display = show ? "" : "none";
};
proto.addClass = function (this: HTMLElement, c: string) {
	this.classList.add(c);
};
proto.setAttr = function (this: HTMLElement, k: string, v: string) {
	this.setAttribute(k, v);
};
(globalThis as Record<string, unknown>).createEl = make;

/** Visible text of an element (skips hidden ones). */
export function visibleText(el: Element): string {
	if ((el as HTMLElement).style?.display === "none") return "";
	let out = "";
	for (const n of Array.from(el.childNodes)) {
		out += n.nodeType === 3 ? (n.textContent ?? "") : visibleText(n as Element);
	}
	return out;
}
