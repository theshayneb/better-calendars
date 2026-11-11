# Better Calendars

An Obsidian plugin that combines the useful parts of [Calendar](https://github.com/liamcain/obsidian-calendar-plugin) and [Meetings Plus](https://github.com/jabaho9523/obsidian-meetings-plus):

- **Daily notes in advance, with your template.** A month calendar in the sidebar; click any day (past, today or future) to open its daily note or create it from your template.
- **Google Calendar events become notes automatically.** Add your calendar once; every upcoming event gets its own note without opening a panel or clicking anything.
- **Check in to places.** Pick a nearby place on your phone (or search by name), and get a note per place with your visits, the place in your daily note, and the check-in posted to Swarm.

## Install with BRAT

1. Install and enable **BRAT** from the community plugins.
2. Run **BRAT: Add a beta plugin for testing** and enter `theshayneb/better-calendars`.
3. Enable **Better Calendars** under Settings → Community plugins.

## Daily notes

- Click a day in the calendar to open its daily note. If it doesn't exist, it is created from your template (you are asked first, unless you turn that off). Ctrl/Cmd-click opens it in a new tab; right-click for more options.
- **Create daily notes in advance** (command palette): pick a start date and a number of days, and all missing daily notes are created at once.
- **Create daily notes ahead** (setting): keep daily notes for today and the next N days created automatically.
- Folder, date format and template come from **Periodic Notes** (if its daily notes are on) or the core **Daily notes** plugin, unless you set them in Better Calendars' settings. The settings show which template is being used.

Template variables, all relative to the note's own date (so a note created in advance gets the right dates):

| Variable | Result |
|---|---|
| `{{date}}` | The note's date in the daily note format |
| `{{date:dddd, MMMM D}}` | The date in any [moment format](https://momentjs.com/docs/#/displaying/format/) |
| `{{date+1d:YYYY-MM-DD}}`, `{{date-1w:...}}` | Offset dates (`y`, `Q`, `M`, `w`, `d`, `h`, `m`, `s`) |
| `{{yesterday}}`, `{{tomorrow}}` | The days before and after |
| `{{time}}` | The current time |
| `{{title}}` | The note's name |

If Templater is installed, its commands run on new notes too (setting **Run Templater on new notes**). For notes created in advance, use `tp.file.title` rather than `tp.date.now()`, which is the day you created the note.

## Google Calendar events

1. In Google Calendar on the web, open Settings, click the calendar under **Settings for my calendars**, go to **Integrate calendar** and copy the **Secret address in iCal format**.
2. In Better Calendars' settings, click **Add calendar** and paste it. Add as many calendars as you like; other ICS feeds (Outlook, iCloud, ...) work too.

From then on, Better Calendars checks your calendars every 30 minutes (configurable) and creates a note for every event in the next 7 days (configurable) that doesn't have one yet. Notes go to the `Events` folder by default, named `{{date}} {{title}}`.

- Each event gets exactly one note. If you delete it, it is not created again ("Forget import history" resets that).
- If an event is renamed, the title in its note's file name (and a `Title` property with the old title) follows. Notes you renamed yourself are left alone.
- If an event moves to another day, its note's date property (`Date` by default), end date property (`End_Date` by default, e.g. `End_Date: {{end_date}}` in your template) and file name follow.
- Turn off **Import automatically** for a calendar to only create notes when you click an event in the calendar view.
- If you use several devices with Obsidian Sync, consider turning off **Import on this device** on all but one, so two devices don't create the same note at the same moment.

### Attendees

Event notes can list the guests of a meeting, read from the invite in Google Calendar:

- **Who**: guests who accepted (default), accepted or said maybe, everyone who didn't decline, or everyone invited. Meeting rooms are never listed. "Leave out attendees" skips people such as yourself.
- **Linked to your people notes**: a guest is linked to a note in your People folder when the note's `email` property, its name, or one of its `aliases` matches the guest's email or display name. Other guests are written as plain text (display name, or email if Google has no name), or as links if you turn on "Link guests without a note".
- **Kept up to date**: guests who accept later are added to `People`; guests the plugin added are removed when they decline or are taken off the invite. People you added yourself stay, and a guest you removed isn't added back. ("Keep people up to date")
- In a template, `People: {{attendees_property}}` in the properties block gives a list property like `["[[Ann Lee]]", "bob@example.com"]`; `{{attendees_list}}` gives a bulleted list.

### Properties are filled in by name

For timed events `Date` and `End_Date` get the date and time (`2026-10-14T15:00`), for all-day events just the date; turn off "Include times" for dates only. You don't need variables for the usual properties: leave them empty in your template and Better Calendars fills them in. `Date`, `End_Date` and `People` (names configurable), plus `Title`, `Start`, `End`, `Time`, `Location`, `Link`, `Organizer`, `Calendar` and `Description`. For example:

```
---
Date:
End_Date:
People:
Location:
---
```

Properties with a value or a `{{variable}}` are left as they are. Turn this off with "Fill empty properties".

Event note templates (a file you choose in settings, or the built-in one) can use:

`{{title}}` `{{date}}` `{{start}}` `{{end}}` `{{end_date}}` (the last day of the event) `{{time}}` `{{duration}}` `{{location}}` `{{meeting_url}}` `{{description}}` `{{organizer}}` `{{attendees}}` `{{attendees_list}}` `{{attendees_wikilinks}}` `{{attendees_property}}` `{{calendar}}` `{{daily_note}}` (a link to that day's daily note) `{{uid}}`. Date variables take a format: `{{start:h:mm A}}`.

Better Calendars adds an `event_id` property to each event note; that's how it recognizes the note later. It is hidden in the properties panel unless you turn off "Hide event_id property". It also sets the date property (`Date` by default) if your template doesn't.

## Check-ins

Check in to places from Obsidian, Swarm/Foursquare style. Each check-in records a visit in a note for the place, adds the place to your daily note, and (optionally) posts the check-in to your Swarm account.

**Check in** (ribbon map-pin icon, or the "Check in" command):

- **On your phone**, Better Calendars reads your location (Obsidian Mobile 1.11 or later; allow location when Android asks) and lists the places around you, nearest first, with their category and how often you've been there. The search box finds places by name. "Test location (GPS)" shows whether location works on a device.
- **From anywhere**: the link `obsidian://better-calendars-checkin` opens the check-in screen, e.g. from Tasker (Net → Browse URL) or a home-screen shortcut. Add `?vault=Your%20Vault` to choose a vault.
- **On desktop** there is no GPS: search places by name. Results are biased to where you last checked in.
- Pick a place, then choose tags, add projects and an optional note (which becomes your Swarm shout), and press **Check in**.

**Tags.** Place notes get real tags in `tags`:

- **Always add** (default `place`) goes on every place note.
- Each Foursquare category remembers one tag ("every Pizzeria is pizza"), preselected at check-in. The first time a category has no tag, you're asked; "No tag for this category" is remembered too. Change these under **Tag per category**.
- **Tags that add another tag**: `pizza: food` gives every pizza place `food` as well (preset for pizza, tea and dessert).
- Any of your tags can be added to one place as chips, and "+ new" adds a tag.

**Place notes** live in the places folder (default `Planning & Productivity/Travel`), one per place, named after the place; when another place already has that name, the street is added: "Starbucks (Austin St)". A check-in fills in:

```
tags:
  - place
  - food
  - tea
Address: 15 Station Square, Forest Hills, NY 11375
Geolink: 40.72218, -73.84395
Projects:
  - Forest Hills
Link:
  - http://princeteahouseorders.com/
  - https://www.google.com/maps/search/?api=1&query=...
Visits:
  - 2026-11-11 12:40 · first time back
fsq: 4b8f9c2af964a520a6f533e3
```

- An existing note with the same name and coordinates within about 150 m (or the same `fsq`) is used instead of creating a new one. Existing values are kept: only empty properties are filled, tags and links are added to, and `Visits` only grows.
- `Projects` is yours to fill in: the check-in screen suggests values you've already used in `Projects` anywhere in the vault.
- `fsq` is the Foursquare place ID, used to recognise the place and to post to Swarm. It's hidden in the properties panel ("Hide fsq property").

**Daily note.** The place is added to the daily note's `Places` property (a list of links, once per day). If today's daily note doesn't exist yet, you're asked whether to create it.

**Swarm.** When "Also check in on Swarm" is ticked, the check-in is posted publicly to your Swarm account, with your note as the shout. Without a connection (no signal, Foursquare down), the visit is still saved and the Swarm post is retried on the next refresh, by the same device only.

### Swarm history

Run **Catch up on Swarm history** (command palette, or the "Catch up" button in the settings) to go through your past Swarm check-ins one at a time, newest first. The first time, it loads your whole history from Swarm, which takes a moment.

For each check-in you see the date and time (the place's local time), the place, its address, suggested tags and your original note, plus your progress ("1,204 of 6,830"). Choose:

- **Create or link place note**: records the visit in the place's note, like a check-in.
- **Add to daily note YYYY-MM-DD**: adds the place to that day's `Places`. On when the daily note exists; when it doesn't, a button creates it from your template.
- **Apply to all N visits here**: saves every visit to this place at once. If some of those days have no daily note, you're asked whether to create them.

Then **Skip** or **Save and next**. Close the review any time; your progress syncs, so you can continue on another device. New check-ins you make in the Swarm app join the queue (pulled by the device with "Import on this device" on); check-ins you made from Obsidian never appear.

### Setting up check-ins

1. In the [Foursquare developer console](https://foursquare.com/developers/), open your project, go to **Service API Keys** and generate a key (for place search). Copy it right away; it is shown only once. This is not the Client Secret.
2. In the same project's OAuth settings, set the **Redirect URL** to `obsidian://better-calendars-swarm`, and copy the **Client ID** and **Client Secret**.
3. In Settings → Better Calendars → **Check-ins**, enter the Service API Key under "Place search" (the **Check key** button tries it) and the Client ID and Client Secret under "Swarm", then press **Connect** and approve the access in your browser. You come back to Obsidian connected. Do this once, on desktop; the connection syncs to your other devices with the plugin's settings.

## Privacy

Better Calendars talks to:

- **The calendar addresses you add.** Keep your secret iCal address private: anyone with it can read that calendar.
- **Foursquare, only when you use check-ins**: place searches send your location (or your search text) to Foursquare's Places API, and posting a check-in sends the place and your note to your Swarm account. Signing in to Swarm goes through foursquare.com.

Your API key, client secret and Swarm access token are stored in the plugin's `data.json` in your vault, which Obsidian Sync copies to your other devices. Nothing else leaves your devices; there is no analytics.

## Credits

Adapted from [obsidian-calendar-plugin](https://github.com/liamcain/obsidian-calendar-plugin) by Liam Cain (MIT) and [Meetings Plus](https://github.com/jabaho9523/obsidian-meetings-plus) by Jacob Holm (0BSD).
