import { moment } from "obsidian";
import type { Moment, unitOfTime } from "moment";
import { CalEvent } from "../types";

/**
 * Daily note template variables, the same set the core Daily notes plugin
 * and the Calendar plugin understand:
 * {{title}}, {{date}}, {{time}}, {{date:FORMAT}}, {{time:FORMAT}},
 * {{date+1d:FORMAT}} (offsets y Q M w d h m s), {{yesterday}}, {{tomorrow}}.
 */
export function renderDailyTemplate(
	template: string,
	date: Moment,
	format: string,
	title: string
): string {
	const now = moment();
	// The note's day, at the current time of day (so {{time}} is "now").
	const base = date
		.clone()
		.set({
			hour: now.get("hour"),
			minute: now.get("minute"),
			second: now.get("second"),
		});
	return template
		.replace(/\{\{\s*title\s*\}\}/gi, title)
		.replace(
			/\{\{\s*(date|time)\s*(([+-]\d+)([yQMwdhms]))?\s*(:([^}]*?))?\s*\}\}/g,
			(
				_m: string,
				kind: string,
				_offset: string | undefined,
				amount: string | undefined,
				unit: string | undefined,
				_fmt: string | undefined,
				fmt: string | undefined
			) => {
				const d = base.clone();
				if (amount && unit) {
					d.add(parseInt(amount, 10), unit as unitOfTime.DurationConstructor);
				}
				if (fmt && fmt.trim()) return d.format(fmt.trim());
				return kind === "time"
					? d.format("HH:mm")
					: d.format(format);
			}
		)
		.replace(/\{\{\s*yesterday\s*\}\}/gi, date.clone().subtract(1, "day").format(format))
		.replace(/\{\{\s*tomorrow\s*\}\}/gi, date.clone().add(1, "day").format(format));
}

export interface EventTemplateContext {
	event: CalEvent;
	calendarName: string;
	/** Wikilink to the daily note of the event's day, e.g. "[[2026-10-12]]". */
	dailyNoteLink: string;
}

const EVENT_VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)(?::([^}]+))?\s*\}\}/g;

/** Event note variables. Date variables take an optional moment format: {{start:HH:mm}}. */
export function renderEventTemplate(
	template: string,
	ctx: EventTemplateContext
): string {
	return template.replace(EVENT_VAR_RE, (match: string, name: string, fmt?: string) => {
		const value = eventVariable(name, fmt?.trim(), ctx);
		return value ?? match;
	});
}

function eventVariable(
	name: string,
	fmt: string | undefined,
	ctx: EventTemplateContext
): string | null {
	const { event } = ctx;
	switch (name) {
		case "title":
			return event.title;
		case "date":
			return moment(event.start).format(fmt || "YYYY-MM-DD");
		case "start":
			return event.allDay && !fmt
				? "all day"
				: moment(event.start).format(fmt || "HH:mm");
		case "end":
			return event.allDay && !fmt
				? "all day"
				: moment(event.end).format(fmt || "HH:mm");
		case "time":
			return event.allDay
				? "All day"
				: `${moment(event.start).format("HH:mm")}–${moment(event.end).format("HH:mm")}`;
		case "duration":
			return String(
				Math.max(0, Math.round((event.end.getTime() - event.start.getTime()) / 60000))
			);
		case "location":
			return event.location;
		case "meeting_url":
			return event.meetingUrl;
		case "description":
			return event.description;
		case "organizer":
			return event.organizer;
		case "attendees":
			return event.attendees.join(", ");
		case "attendees_list":
			return event.attendees.map((a) => `- ${a}`).join("\n");
		case "attendees_wikilinks":
			return event.attendees.map((a) => `[[${a}]]`).join(", ");
		case "calendar":
			return ctx.calendarName;
		case "daily_note":
			return ctx.dailyNoteLink;
		case "uid":
			return event.uid;
		default:
			// Unknown names are left alone, so other plugins' {{...}} survive.
			return null;
	}
}

export function sanitizeFilename(name: string): string {
	return name
		.replace(/[\\/:*?"<>|#^[\]]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 180)
		.trim();
}

export const DEFAULT_EVENT_TEMPLATE = `---
Date: {{date}}
time: {{time}}
calendar: {{calendar}}
---
# {{title}}

- **When**: {{daily_note}} {{time}}
- **Where**: {{location}}
- **Link**: {{meeting_url}}
- **Attendees**: {{attendees}}

## Description
{{description}}

## Notes

`;
