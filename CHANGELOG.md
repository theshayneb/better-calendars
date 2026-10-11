# Changelog

## [1.0.0] - 2026-10-11

First release of Better Calendars, combining a stripped-down Calendar (Liam Cain) and Meetings Plus (Jacob Holm).

- Month calendar in the right sidebar. Click a day to open its daily note, or create it from your template (also for future days). Dots show which days have a daily note and which have events.
- "Create daily notes in advance" command: create the daily notes for a range of days at once. Optionally keep daily notes created automatically for the next N days.
- Daily note templates support `{{date}}`, `{{time}}`, `{{title}}`, `{{date:FORMAT}}`, `{{date+1d:FORMAT}}`, `{{yesterday}}` and `{{tomorrow}}`, all relative to the note's date. Templater commands run too.
- Subscribe to Google calendars (or any ICS feed) with the secret iCal address. Event notes are created automatically for the next days (default 7), with no clicking needed. A deleted event note is not created again.
- Moved events update their note's date and file name; moved or cancelled single occurrences of recurring events are handled.
- The selected day's events are listed below the calendar; click one to open its note (or create it, for calendars that don't import automatically).
