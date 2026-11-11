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
- New notes are created through `createNote` in `src/util/templater.ts`: it runs one note at a time (Templater shares one `tp` state), marks the path as pending for Templater (so its on-create trigger skips it; re-added after the run for 2 s, since Templater clears it), waits for the metadata cache, then runs `overwrite_file_commands`, so `tp.frontmatter` works.
- Event templates may just list empty properties (`Date:`, `People:` ...); `fillEmptyProperties` fills them by name (`propertyValues` in the importer). The owner's template works this way.
- With `includeTimes`, Date/End_Date of timed events are `YYYY-MM-DDTHH:mm`; `movedValue` updates them (date or time change) keeping their shape.
- Daily note settings fall back to Periodic Notes (daily enabled), then the core Daily notes plugin.
- Attendees: parsed with their PARTSTAT (rooms/resources skipped), filtered and matched to person notes (email property, then name, then alias) in `src/util/attendees.ts`.
- `People` sync: `syncPeople` (attendees.ts) with `settings.peopleAdded[eventId]` = entries the plugin added (still wanted); only those are removed, and they are never re-added. Notes from before 1.0.11 get their current guest entries as the starting record.
- Title changes: `settings.noteNames[eventId]` = {name the plugin gave the file, title it was made from}; `followTitle` swaps old title for new in the file name only if the file still has that name. Pre-1.0.12 notes get their current name/title as the starting record (no rename on first sight).
- Check-ins (`src/checkins/`): Places API search (`places-api.foursquare.com`, header `X-Places-Api-Version: 2025-06-17`, API key as Bearer), Swarm via v2 (`api.foursquare.com/v2`, OAuth code flow with redirect `obsidian://better-calendars-swarm`, token as Bearer). Pure logic in `logic.ts`; notes written in `place-notes.ts` (match by `fsq`, else same name within 150 m; only fill empty properties; `Visits` append-only). The owner's place notes use `Geolink`, `Link` as a list, tags `place` + `food`, and `Projects`/`Rating` they fill themselves.
- Swarm posts that fail transiently go to `settings.swarmQueue` and are retried only by the device that queued them (`deviceId` in local storage). Swarm ids posted from Obsidian go to `swarmPostedIds` (for the history review in 1.2.0).
- Swarm history review (`review-modal.ts`, `history.ts`, `history-logic.ts`): history cached per device in `<plugin dir>/swarm-history.json` (not synced settings); synced progress is `settings.swarmReviewed` (ids, saved every 10 reviews and on close). Queue = history minus reviewed minus `swarmPostedIds`, newest first. Background pull only on the import device and only once its cache exists. `recordVisit` skips a visit whose date+time is already in `Visits`, and remembers notes it just created (`justCreated`) because the metadata cache lags.
- Review buttons: Later (session-only `pwLater`, not saved), Skip (`settings.swarmSkipped`, undone by "Bring skipped back"), Save and next (`swarmReviewed`). The queue excludes reviewed + skipped + posted-from-Obsidian.
- `getDailyNote` falls back to a note with the date's name anywhere (daily folder first) via a name index cleared on vault create/delete/rename; the owner's older daily notes aren't all at the configured path.
- `fsq` may be a list: Swarm's old venue ids and Places API ids differ for some places. Matching: id, else same name within 150 m (any id), else the only blank same-name note.
- `ask()` resolves null when closed with X; callers treat that as cancel and write nothing.
- The tag chips and Projects field are one component, `TagPicker` (`tag-picker.ts`), used by both the check-in and the review screens. Category tags are looked up by id, then by category name.
- The owner's check-in tags include `nyc` (they tag everything local to NYC); `nycTagAdded` makes the one-time addition stick if they remove it.
- The `event_id` property is hidden with the body class `bc-hide-event-id` (setting `hideEventId`).
- `settings.imported` remembers which events already got a note, so deleted notes aren't recreated.
- Don't give subclasses of Obsidian classes members that may clash with internals; use a `pw` prefix.
