# Better Calendars: notes for Claude Code

An Obsidian plugin (id `better-calendars`), installed by the owner through BRAT. Keep the plugin id: changing it orphans the installed plugin and its `data.json`.

## Workflow

- Push finished, checked work straight to `main`.
- Every change that ships gets a new version and a GitHub release (BRAT installs from releases):
  1. Bump the version in `manifest.json`, `package.json` and `package-lock.json` (top-level `version` and `packages[""].version`), and add it to the top of `versions.json` mapped to `minAppVersion`.
  2. Add a `## [x.y.z] - YYYY-MM-DD` entry at the top of `CHANGELOG.md`; the release workflow uses it as the release notes and fails without it.
  3. Commit and push to `main`, then push the tag `x.y.z` (no `v` prefix), or, where tag pushes are blocked, run the "Release Plugin" workflow on `main` with `version: x.y.z`.
  4. Tell the owner the version number. They use the GitHub web interface, not git.
- Never reuse a version number.

## Checks before pushing

```
npm run lint   # eslint + tsc
npm test
npm run build
```

## Things to know

- Event notes are recognized by `event_id` in their frontmatter: the ICS UID for one-off events, `UID::YYYY-MM-DD` (original slot) for occurrences of recurring events.
- The event's date lives in the owner's own property (`settings.eventDateProperty`, default `Date`); 1.0.0 notes may still have `event_date`, which is read as a fallback and removed when the event moves.
- `{{end_date}}` is inclusive (all-day DTEND is exclusive); `settings.eventEndDateProperty` (default `End_Date`) is updated on reschedule but never added.
- Daily note settings fall back to Periodic Notes (daily enabled), then the core Daily notes plugin.
- Attendees: parsed with their PARTSTAT (rooms/resources skipped), filtered and matched to person notes (email property, then name, then alias) in `src/util/attendees.ts`.
- The `event_id` property is hidden with the body class `bc-hide-event-id` (setting `hideEventId`).
- `settings.imported` remembers which events already got a note, so deleted notes aren't recreated.
- Don't give subclasses of Obsidian classes members that may clash with internals; use a `pw` prefix.
