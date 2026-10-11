# Changelog

## [1.0.3] - 2026-10-11

- New setting "Hide event_id property" (on by default) hides `event_id` in the properties panel. The property stays in the note.
- Attendees: event notes now list the guests who accepted the invite (setting "Attendees": accepted, accepted or maybe, everyone who didn't decline, or everyone). Meeting rooms are left out, and you can leave out people such as yourself.
- Guests are linked to your person notes: a note in the People folder (setting) whose email property, name or alias matches the guest. Guests without a note are plain text, or links if you turn on "Link guests without a note".
- New template variable `{{attendees_property}}` for a list property, e.g. `Attendees: {{attendees_property}}`. The built-in template now uses it.

## [1.0.2] - 2026-10-11

- "Import now" explains why no notes were created: it now says when events were skipped because their notes were deleted earlier (and how to get them back), or when there are no events in the import window.

## [1.0.1] - 2026-10-11

- Daily notes now also use the template, folder and format from the Periodic Notes plugin (when its daily notes are on), and from the core Daily notes plugin even when it is turned off. Before, new daily notes could come out empty in those setups.
- The Daily notes settings now say which template is used, or that none was found.
- Event notes no longer get an `event_date` property. The event's date goes in your own date property instead (setting "Date property", default `Date`), which is added only if your template doesn't set it, and is updated when an event moves. Only `event_id` is still added.

## [1.0.0] - 2026-10-11

First release of Better Calendars, combining a stripped-down Calendar (Liam Cain) and Meetings Plus (Jacob Holm).

- Month calendar in the right sidebar. Click a day to open its daily note, or create it from your template (also for future days). Dots show which days have a daily note and which have events.
- "Create daily notes in advance" command: create the daily notes for a range of days at once. Optionally keep daily notes created automatically for the next N days.
- Daily note templates support `{{date}}`, `{{time}}`, `{{title}}`, `{{date:FORMAT}}`, `{{date+1d:FORMAT}}`, `{{yesterday}}` and `{{tomorrow}}`, all relative to the note's date. Templater commands run too.
- Subscribe to Google calendars (or any ICS feed) with the secret iCal address. Event notes are created automatically for the next days (default 7), with no clicking needed. A deleted event note is not created again.
- Moved events update their note's date and file name; moved or cancelled single occurrences of recurring events are handled.
- The selected day's events are listed below the calendar; click one to open its note (or create it, for calendars that don't import automatically).
