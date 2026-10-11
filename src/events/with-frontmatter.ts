/** Frontmatter keys the plugin writes into every event note. */
export const FM_EVENT_ID = "event_id";
export const FM_EVENT_DATE = "event_date";

/** Add `event_id` / `event_date` to the note's frontmatter, creating it if there is none. */
export function withEventFrontmatter(body: string, id: string, date: string): string {
	const lines = `${FM_EVENT_ID}: ${JSON.stringify(id)}\n${FM_EVENT_DATE}: ${date}\n`;
	const match = /^---\r?\n/.exec(body);
	if (match && /\r?\n---\s*(\r?\n|$)/.test(body.slice(match[0].length - 1))) {
		return match[0] + lines + body.slice(match[0].length);
	}
	return `---\n${lines}---\n${body}`;
}
