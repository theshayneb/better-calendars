/** Frontmatter key the plugin writes into every event note to recognize it later. */
export const FM_EVENT_ID = "event_id";
/** Written by 1.0.0; only read, to follow moved events in older notes. */
export const FM_LEGACY_EVENT_DATE = "event_date";

/**
 * Add `event_id` to the note's frontmatter (creating frontmatter if there is
 * none), plus the date property when the template didn't set it.
 */
export function withEventFrontmatter(
	body: string,
	id: string,
	dateProperty: string,
	date: string
): string {
	const idLine = `${FM_EVENT_ID}: ${JSON.stringify(id)}\n`;
	const dateLine = dateProperty ? `${dateProperty}: ${date}\n` : "";
	const open = /^---\r?\n/.exec(body);
	if (open) {
		const close = /\r?\n---[ \t]*(\r?\n|$)/.exec(body.slice(open[0].length - 1));
		if (close) {
			const yaml = body.slice(open[0].length, open[0].length - 1 + close.index);
			const hasDate =
				dateProperty !== "" &&
				new RegExp(`^${escapeRegex(dateProperty)}\\s*:`, "m").test(yaml);
			return open[0] + idLine + (hasDate ? "" : dateLine) + body.slice(open[0].length);
		}
	}
	return `---\n${idLine}${dateLine}---\n${body}`;
}

/**
 * Fill properties that the template left empty (`Location:` with nothing
 * after it, or just [] / "" / null) from `values`, keyed by lower-case property name and already
 * written as YAML. Properties with a value, or with list items below them,
 * are left alone.
 */
export function fillEmptyProperties(body: string, values: Map<string, string>): string {
	const open = /^---\r?\n/.exec(body);
	if (!open) return body;
	const rest = body.slice(open[0].length);
	const close = /^---[ \t]*$/m.exec(rest);
	if (!close) return body;
	const lines = rest.slice(0, close.index).split("\n");
	for (let i = 0; i < lines.length; i++) {
		const m = /^([^\s#:][^:]*?)[ \t]*:[ \t]*(?:\[\]|""|''|null|~)?[ \t]*\r?$/.exec(lines[i] ?? "");
		if (!m || !m[1]) continue;
		if (/^\s+\S/.test(lines[i + 1] ?? "")) continue; // has list items or nested values
		const value = values.get(m[1].trim().toLowerCase());
		if (value) lines[i] = `${m[1]}: ${value}`;
	}
	return open[0] + lines.join("\n") + rest.slice(close.index);
}

/** The YYYY-MM-DD date inside a property value such as "2026-10-12" or "[[2026-10-12]]". */
export function findIsoDate(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const m = /\d{4}-\d{2}-\d{2}/.exec(value);
	return m ? m[0] : null;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
