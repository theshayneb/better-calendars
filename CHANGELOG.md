# Changelog

## [1.3.0] - 2026-11-11

- Rating: the check-in and history review screens have a Rating field with the ratings you already use in your notes' `Rating` property (most used first) as chips, plus "+ new". It starts on the note's current rating and is saved to the place note; leaving it empty never removes a rating.
- Swarm history review: "Link to an existing note…" / "Link to a different note…" searches all your notes (places folder first), so a visit can go to a note that's named differently. That note then gets the place's Foursquare id, so the next visit finds it by itself. "Undo" goes back to the automatic match.
- The section headers (Note name, Tags, Projects, Rating) are bigger and bold.

## [1.2.7] - 2026-11-11

- Fixed different locations of a chain (e.g. Chili's in Queens and Chili's in Reno) ending up in one place note. A note with the same name but no coordinates is now only used when its Address matches the place's street (or postcode and city), and a note the plugin has just updated is never mistaken for an empty one while Obsidian is still re-reading it.

## [1.2.6] - 2026-11-11

- New "Note name" field when checking in or reviewing a place that has no note yet: the suggested name, which you can change. Characters Windows and Obsidian don't allow (\\ / : * ? " < > | # ^ [ ]) are removed, and the field shows how the name will be saved when you type one.
- Note names are also kept from starting with a dot, ending with a dot or space, or being a name Windows reserves (CON, NUL, ...).

## [1.2.5] - 2026-11-11

- Fixed the Swarm history review: "Apply to all N visits here" (and its list of visits) only appeared after pressing "Create … from your template" since 1.2.3. It's shown again whenever a place has more than one visit to review.
- Fixed "Add the name as plain text (not a link)" showing while "Add to daily note" was unticked.

## [1.2.4] - 2026-11-11

- Swarm history review: new option under "Add to daily note": "Add the name as plain text (not a link)". Off by default; when ticked, the daily note's `Places` gets the place's name without making it a link.

## [1.2.3] - 2026-11-11

- Swarm history review: ticking "Apply to all N visits here" now lists those visits (date, time, your note) and whether each day has a daily note, and the daily note checkbox reads "Add to the daily notes of all N visits", saying how many days have no daily note yet (you're asked about those when you save).

## [1.2.2] - 2026-11-11

- Swarm history review: new "Later" button. It moves on without recording anything; the check-in comes back at the end of this session and the next time you open the review.
- "Skip" still means "don't show again", but skipped check-ins are now kept apart: Settings → Check-ins → Swarm history → "Bring skipped back" puts them in the queue again. (Check-ins skipped with 1.2.0 or 1.2.1 can't be told apart from saved ones, so they can't be brought back.)

## [1.2.1] - 2026-11-11

- Daily notes are found even when they aren't at the exact path from the daily note settings (e.g. older notes moved into year folders): Better Calendars looks for a note with that date's name, preferring the daily notes folder. This also keeps it from creating a second daily note for such days.
- Existing place notes are recognised better: a note with the same name within about 150 m is the same place, even when it already has a different Foursquare id (Swarm's old ids and the Places API's can differ). Both ids are kept in `fsq`. Place notes outside the places folder are found too, by their `Geolink` or `fsq`.
- Closing a question with X now cancels: nothing is saved (a live check-in isn't saved or posted; a past check-in stays in the review). Closing the review while "Apply to all" is saving stops after the current visit; the rest stay in the review.

## [1.2.0] - 2026-11-11

Swarm history.

- New command "Catch up on Swarm history": go through your past Swarm check-ins one at a time, newest first, and choose what to bring into the vault. Each shows the date and time (in the place's local time), the place, its address, suggested tags, your original note, and your progress ("1,204 of 6,830").
- For each check-in: "Create or link place note" (on), "Add to daily note" (on when that daily note exists; a button creates it when it doesn't), and "Apply to all N visits here" to save every visit to that place at once. When some of those days have no daily note, you're asked whether to create them.
- Skip or Save and next; close any time. Your progress syncs, so you continue where you left off on any device.
- Check-ins you make in the Swarm app join the same queue: the device with "Import on this device" pulls them on every refresh (once you've opened the review there). Check-ins you made from Obsidian never show up.
- A visit that's already in a place note (same date and time) isn't added again.
- The history itself is cached on each device (not in the synced settings), so saving your progress stays quick.

## [1.1.3] - 2026-11-11

- New link `obsidian://better-calendars-checkin` opens the check-in screen, so you can start a check-in from Tasker, a home-screen shortcut or any other app. Add `?vault=Your%20Vault` to pick a vault.

## [1.1.2] - 2026-11-11

- Added `nyc` to the tags you can choose when checking in. It's added to your tag list once; if you remove it under "Your tags", it stays removed.

## [1.1.1] - 2026-11-11

- Check-in settings are clearer: "Place search" needs a Service API Key (developer console → your project → Service API Keys), "Swarm" needs the Client ID and Client Secret. A warning shows when the Service API key field holds the Client Secret, and the check-in screen says so too.
- New "Check key" button that tries one place search.
- When Foursquare rejects the key it breaks off its answer, which Android reported as "unexpected end of stream". Better Calendars now explains that the key was rejected and what to use instead.
- Swarm check-ins are sent as a form body (Android can fail a POST without one), and a queued Swarm check-in is given up after 20 tries.

## [1.1.0] - 2026-11-11

Check-ins, Swarm/Foursquare style.

- New "Check in" command and ribbon icon. On your phone it lists the places around you (GPS), nearest first, with their category and how often you've been there; search by name on any device.
- Each check-in records a visit in the place's note (in the places folder, default `Planning & Productivity/Travel`): `tags`, `Address`, `Geolink`, `Projects`, `Link` (website and Google Maps), `Visits` and `fsq`. Existing place notes with the same name nearby are used instead of creating new ones; their values are kept and only empty properties are filled.
- Tags: `place` on every place note, a remembered tag per Foursquare category (you're asked the first time, "no tag" can be remembered too), tags that bring others along (pizza, tea and dessert also add `food`), and extra tags per place.
- `Projects` suggests values you've already used in the vault.
- The place is added to the daily note's `Places` list once per day; if today's daily note doesn't exist yet, you're asked.
- Optionally posts the check-in to Swarm (public, your note as the shout). Failed posts are queued and retried on the next refresh.
- New "Check-ins" settings: Foursquare API key, Swarm connection (client ID, secret, connect/disconnect), places folder, property names, hide `fsq`, your tags and the tag per category.

## [1.0.13] - 2026-11-11

- New command "Test location (GPS)": shows whether this device gives Better Calendars its location, ahead of the check-in feature. On Android it should ask for location permission the first time.

## [1.0.12] - 2026-10-13

- When an event is renamed in the calendar, its note's file name follows: the old title in the file name is replaced by the new one. A `Title` property that still holds the old title is updated too. Notes you renamed yourself keep their name.

## [1.0.11] - 2026-10-11

- `People` now stays up to date (setting "Keep people up to date", on by default). Guests who accept later are added, linked to their person note as usual. Guests the plugin added are removed when they decline or are taken off the invite. People you added yourself are never removed, and a guest you removed by hand isn't added again. Only notes that have the `People` property are touched.

## [1.0.10] - 2026-10-11

- `Date` and `End_Date` now include the time for timed events, e.g. `2026-10-14T15:00` (an Obsidian date & time property). All-day events still get just the date. Setting "Include times" (on by default).
- When an event's time changes, even on the same day, its note's `Date` and `End_Date` are updated.

## [1.0.9] - 2026-10-11

- Event notes: properties your template leaves empty are now filled in by name (setting "Fill empty properties", on by default). `Date`, `End_Date` and `People` (names set in the settings), plus `Title`, `Start`, `End`, `Time`, `Location`, `Link`, `Organizer`, `Calendar` and `Description`. A template with just `Date:`, `End_Date:`, `People:` no longer gives empty properties. Properties with a value or a `{{variable}}` are left as they are.
- New setting "People property" (default `People`).

## [1.0.8] - 2026-10-11

- Renamed the command "Refresh calendars and import events" to "Refresh calendars, import events and create daily notes ahead", since it also creates the daily notes set under "Create daily notes ahead". The refresh button and "Import now" setting say so too. Hotkeys assigned to the command keep working.

## [1.0.7] - 2026-10-11

- Fixed daily notes getting another day's template when several notes are created in a row (create in advance, auto-create, event import). Templater's own "trigger on new file creation" could run on the previous note while Better Calendars ran Templater on the next one; Templater shares one `tp` state, so `tp.file.title` could belong to the wrong note. New notes are now handled one at a time, and Templater's trigger stays off them for two seconds after they're done.

## [1.0.6] - 2026-10-11

- Templater now runs on new daily and event notes only after Obsidian has read the note's properties, so templates that use `tp.frontmatter` (for example a meta template that picks a layout from the `Date` property) see the note's own date instead of nothing. Templater's own "trigger on new file creation" no longer processes these notes early.

## [1.0.5] - 2026-10-11

- New template variable `{{end_date}}`: the day the event ends (`YYYY-MM-DD`, or any format like `{{end_date:D MMM}}`). For all-day events it gives the last day of the event, not the day after.
- New setting "End date property" (default `End_Date`): when an event moves, this property is updated along with the date property. It is never added to notes that don't have it.

## [1.0.4] - 2026-10-11

- The built-in event template puts the guests in a `People` property instead of `Attendees`. In your own template, any property name works: `People: {{attendees_property}}`.

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
