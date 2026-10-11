# Better Calendars

An Obsidian plugin that combines the useful parts of [Calendar](https://github.com/liamcain/obsidian-calendar-plugin) and [Meetings Plus](https://github.com/jabaho9523/obsidian-meetings-plus):

- **Daily notes in advance, with your template.** A month calendar in the sidebar; click any day (past, today or future) to open its daily note or create it from your template.
- **Google Calendar events become notes automatically.** Add your calendar once; every upcoming event gets its own note without opening a panel or clicking anything.

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

## Privacy

The only network requests are to the calendar addresses you add. Keep your secret iCal address private: anyone with it can read that calendar.

## Credits

Adapted from [obsidian-calendar-plugin](https://github.com/liamcain/obsidian-calendar-plugin) by Liam Cain (MIT) and [Meetings Plus](https://github.com/jabaho9523/obsidian-meetings-plus) by Jacob Holm (0BSD).
