import { Attendee } from "../types";

/** Which guests go into event notes, by their reply to the invite. */
export type AttendeeFilter = "accepted" | "accepted-maybe" | "not-declined" | "all";
/** How an unlinked guest is written: display name (email when there is none), or email. */
export type AttendeeFormat = "name" | "email";

/** A guest as written into a note. */
export interface AttendeeText {
	/** Plain text: the person note's name, the display name or the email. */
	text: string;
	/** "[[Note]]" when linked, otherwise the same as `text`. */
	link: string;
}

/** A person note that guests can be matched to. */
export interface PersonNote {
	/** What goes between [[ ]] to link to it. */
	linktext: string;
	basename: string;
	aliases: string[];
	emails: string[];
}

export interface PeopleIndex {
	byEmail: Map<string, PersonNote>;
	byName: Map<string, PersonNote>;
	byAlias: Map<string, PersonNote>;
}

export function buildPeopleIndex(notes: PersonNote[]): PeopleIndex {
	const index: PeopleIndex = { byEmail: new Map(), byName: new Map(), byAlias: new Map() };
	const add = (map: Map<string, PersonNote>, key: string, note: PersonNote) => {
		const k = key.trim().toLowerCase();
		if (k && !map.has(k)) map.set(k, note);
	};
	for (const note of notes) {
		add(index.byName, note.basename, note);
		for (const a of note.aliases) add(index.byAlias, a, note);
		for (const e of note.emails) add(index.byEmail, e, note);
	}
	return index;
}

export function findPerson(a: Attendee, index: PeopleIndex): PersonNote | null {
	const email = a.email.toLowerCase();
	const name = a.name.trim().toLowerCase();
	return (
		(email && index.byEmail.get(email)) ||
		(name && (index.byName.get(name) ?? index.byAlias.get(name))) ||
		(email && index.byAlias.get(email)) ||
		null
	);
}

export interface AttendeeOptions {
	filter: AttendeeFilter;
	format: AttendeeFormat;
	/** Comma- or line-separated names/emails to leave out (e.g. yourself). */
	exclude: string;
	/** Link guests without a person note as [[Name]] instead of plain text. */
	linkUnmatched: boolean;
}

export function selectAttendees(
	list: Attendee[],
	opts: AttendeeOptions,
	people: PeopleIndex | null
): AttendeeText[] {
	const excluded = new Set(
		opts.exclude
			.split(/[,\n]/)
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean)
	);
	const out: AttendeeText[] = [];
	for (const a of list) {
		if (!passes(a, opts.filter)) continue;
		if (
			(a.email && excluded.has(a.email.toLowerCase())) ||
			(a.name && excluded.has(a.name.toLowerCase()))
		) {
			continue;
		}
		const person = people ? findPerson(a, people) : null;
		let entry: AttendeeText;
		if (person) {
			entry = { text: person.basename, link: `[[${person.linktext}]]` };
		} else {
			const text = opts.format === "email" ? a.email || a.name : a.name || a.email;
			if (!text) continue;
			entry = { text, link: opts.linkUnmatched ? `[[${text}]]` : text };
		}
		if (!out.some((o) => o.link === entry.link)) out.push(entry);
	}
	return out;
}

function passes(a: Attendee, filter: AttendeeFilter): boolean {
	switch (filter) {
		case "accepted":
			return a.status === "accepted";
		case "accepted-maybe":
			return a.status === "accepted" || a.status === "tentative";
		case "not-declined":
			return a.status !== "declined";
		default:
			return true;
	}
}

/** Compare links loosely: "[[People/Ann Lee|Ann]]" and "[[Ann Lee]]" are the same person. */
export function personKey(value: string): string {
	let v = value.trim();
	const link = /^\[\[([^\]]+)\]\]$/.exec(v);
	if (link?.[1]) {
		v = link[1].split("|")[0] ?? "";
		v = v.slice(v.lastIndexOf("/") + 1).replace(/\.md$/i, "");
	}
	return v.trim().toLowerCase();
}

export interface PeopleSync {
	/** The new property value. */
	list: string[];
	/** Guests the plugin has added and that are still wanted (kept even if you removed them, so they aren't added again). */
	added: string[];
	changed: boolean;
}

/**
 * Bring a People list up to date with the calendar:
 * - add wanted guests the plugin hasn't added before;
 * - remove guests the plugin added that are no longer wanted (declined,
 *   taken off the invite).
 * Entries the plugin didn't add are never removed, and a guest you removed
 * by hand is not added again.
 */
export function syncPeople(current: string[], wanted: string[], added: string[]): PeopleSync {
	const wantedKeys = new Set(wanted.map(personKey));
	const addedKeys = new Set(added.map(personKey));
	const list = current.filter((v) => {
		const k = personKey(v);
		return wantedKeys.has(k) || !addedKeys.has(k);
	});
	const present = new Set(list.map(personKey));
	const toAdd = wanted.filter((v) => {
		const k = personKey(v);
		return !present.has(k) && !addedKeys.has(k);
	});
	list.push(...toAdd);
	return {
		list,
		added: [...added.filter((v) => wantedKeys.has(personKey(v))), ...toAdd],
		changed: list.length !== current.length || toAdd.length > 0,
	};
}
