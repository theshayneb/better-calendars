import { App, PluginSettingTab, Setting, moment } from "obsidian";
import type BetterCalendarsPlugin from "./main";
import { WeekStart } from "./settings";
import { AttendeeFilter, AttendeeFormat } from "./util/attendees";
import { CalendarSource } from "./types";
import { CalendarEditModal, ConfirmModal } from "./ui/modals";
import { FileSuggest, FolderSuggest } from "./ui/suggest";
import { DEFAULT_DAILY_FORMAT, coreDailyNoteOptions } from "./daily/daily-notes";
import { resolveTemplateFile } from "./util/vault";

export class BetterCalendarsSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: BetterCalendarsPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const settings = this.plugin.settings;
		const save = async () => {
			await this.plugin.saveSettings();
			this.plugin.refreshViews();
		};
		const intSetting = (
			setting: Setting,
			get: () => number,
			set: (n: number) => void,
			min: number,
			max: number
		) =>
			setting.addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.min = String(min);
				t.inputEl.max = String(max);
				t.setValue(String(get())).onChange(async (v) => {
					const n = parseInt(v, 10);
					if (!Number.isFinite(n) || n < min || n > max) return;
					set(n);
					await save();
				});
			});

		// Calendars
		new Setting(containerEl).setName("Calendars").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "Add a Google Calendar with its secret iCal address. Its events are loaded into the calendar view and, if enabled, turned into notes automatically.",
		});
		for (const calendar of settings.calendars) this.renderCalendar(calendar);
		new Setting(containerEl).addButton((b) =>
			b
				.setButtonText("Add calendar")
				.setCta()
				.onClick(() => {
					const draft: CalendarSource = {
						id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
						name: "Google calendar",
						url: "",
						color: "#4285f4",
						enabled: true,
						autoImport: true,
						folder: "",
						template: "",
						titlePattern: "",
						excludeAllDay: true,
					};
					new CalendarEditModal(this.app, this.plugin, draft, async (c) => {
						settings.calendars.push(c);
						await save();
						this.display();
						void this.plugin.refreshAndImport(true);
					}).open();
				})
		);

		// Event notes
		new Setting(containerEl).setName("Event notes").setHeading();
		new Setting(containerEl)
			.setName("Import events automatically")
			.setDesc("Create a note for each upcoming event without being asked. Each event gets one note; if you delete it, it is not created again.")
			.addToggle((t) =>
				t.setValue(settings.autoImport).onChange(async (v) => {
					settings.autoImport = v;
					await save();
					this.display();
				})
			);
		new Setting(containerEl)
			.setName("Import on this device")
			.setDesc("Turn off on devices that should only receive notes through sync. This avoids duplicates when two devices import at the same time. Stored per device.")
			.addToggle((t) =>
				t.setValue(this.plugin.importsOnThisDevice()).onChange((v) => {
					this.plugin.setImportsOnThisDevice(v);
				})
			);
		intSetting(
			new Setting(containerEl)
				.setName("Days ahead")
				.setDesc("Import events from today up to this many days ahead."),
			() => settings.importDaysAhead,
			(n) => (settings.importDaysAhead = n),
			0,
			90
		);
		intSetting(
			new Setting(containerEl)
				.setName("Days back")
				.setDesc("Also import events from this many past days."),
			() => settings.importDaysBack,
			(n) => (settings.importDaysBack = n),
			0,
			30
		);
		intSetting(
			new Setting(containerEl)
				.setName("Refresh every (minutes)")
				.setDesc("How often calendars are checked for new events."),
			() => settings.refreshMinutes,
			(n) => {
				settings.refreshMinutes = n;
				this.plugin.scheduleRefresh();
			},
			5,
			1440
		);
		new Setting(containerEl)
			.setName("Folder")
			.setDesc("Default folder for event notes.")
			.addText((t) => {
				t.setPlaceholder("Events").setValue(settings.eventFolder).onChange(async (v) => {
					settings.eventFolder = v.trim();
					await save();
				});
				new FolderSuggest(this.app, t.inputEl, (v) => {
					settings.eventFolder = v;
					void save();
				});
			});
		const tpl = new Setting(containerEl)
			.setName("Template")
			.addText((t) => {
				t.setPlaceholder("Built-in template").setValue(settings.eventTemplate).onChange(async (v) => {
					settings.eventTemplate = v.trim();
					await save();
				});
				new FileSuggest(this.app, t.inputEl, (v) => {
					settings.eventTemplate = v;
					void save();
				});
			});
		tpl.descEl.appendText("Template file for event notes. Variables: ");
		tpl.descEl.createEl("code", {
			text: "{{title}} {{date}} {{start}} {{end}} {{end_date}} {{time}} {{duration}} {{location}} {{meeting_url}} {{description}} {{organizer}} {{attendees}} {{attendees_list}} {{attendees_wikilinks}} {{attendees_property}} {{calendar}} {{daily_note}}",
		});
		tpl.descEl.appendText(". Dates take a format, e.g. {{start:h:mm A}}.");
		new Setting(containerEl)
			.setName("File name")
			.setDesc("File name pattern for event notes, using the same variables.")
			.addText((t) =>
				t.setValue(settings.eventTitlePattern).onChange(async (v) => {
					settings.eventTitlePattern = v.trim() || "{{date}} {{title}}";
					await save();
				})
			);
		new Setting(containerEl)
			.setName("Date property")
			.setDesc("Property that holds the event's date. If your template doesn't set it, it is added. When an event moves to another day, this property and the file name are updated.")
			.addText((t) =>
				t
					.setPlaceholder("Date")
					.setValue(settings.eventDateProperty)
					.onChange(async (v) => {
						settings.eventDateProperty = v.trim();
						await save();
					})
			);
		new Setting(containerEl)
			.setName("Fill empty properties")
			.setDesc("Fill properties your template leaves empty, by name: the date, end date and people properties below, and title, start, end, time, location, link, organizer, calendar and description. Properties with a value or a variable are left as they are.")
			.addToggle((t) =>
				t.setValue(settings.fillEmptyProperties).onChange(async (v) => {
					settings.fillEmptyProperties = v;
					await save();
				})
			);
		new Setting(containerEl)
			.setName("Include times")
			.setDesc("Write the start and end time into the date and end date properties of timed events, e.g. 2026-10-12T15:00 (an Obsidian date & time property). All-day events get just the date.")
			.addToggle((t) =>
				t.setValue(settings.includeTimes).onChange(async (v) => {
					settings.includeTimes = v;
					await save();
				})
			);
		new Setting(containerEl)
			.setName("Keep people up to date")
			.setDesc("When guests accept later, add them to the people property of the event note. Guests the plugin added are removed again if they decline or are taken off the invite. People you added yourself are never removed.")
			.addToggle((t) =>
				t.setValue(settings.syncPeople).onChange(async (v) => {
					settings.syncPeople = v;
					await save();
				})
			);
		new Setting(containerEl)
			.setName("People property")
			.setDesc("Property that gets the guests list when it is empty in your template.")
			.addText((t) =>
				t
					.setPlaceholder("People")
					.setValue(settings.eventPeopleProperty)
					.onChange(async (v) => {
						settings.eventPeopleProperty = v.trim();
						await save();
					})
			);
		new Setting(containerEl)
			.setName("End date property")
			.setDesc("Property that holds the event's end date, e.g. End_Date: {{end_date}} in your template. It is updated when an event moves, but never added.")
			.addText((t) =>
				t
					.setPlaceholder("End_Date")
					.setValue(settings.eventEndDateProperty)
					.onChange(async (v) => {
						settings.eventEndDateProperty = v.trim();
						await save();
					})
			);
		new Setting(containerEl)
			.setName("Hide event_id property")
			.setDesc("Hide the event_id property in the properties panel. It stays in the note, because that's how event notes are recognized.")
			.addToggle((t) =>
				t.setValue(settings.hideEventId).onChange(async (v) => {
					settings.hideEventId = v;
					this.plugin.applyHideEventId();
					await save();
				})
			);
		new Setting(containerEl)
			.setName("Attendees")
			.setDesc("Which guests go into new event notes, by their reply to the invite.")
			.addDropdown((d) =>
				d
					.addOption("accepted", "Accepted")
					.addOption("accepted-maybe", "Accepted or maybe")
					.addOption("not-declined", "Everyone who didn't decline")
					.addOption("all", "Everyone invited")
					.setValue(settings.attendeeFilter)
					.onChange(async (v) => {
						settings.attendeeFilter = v as AttendeeFilter;
						await save();
					})
			);
		new Setting(containerEl)
			.setName("Show guests without a note as")
			.addDropdown((d) =>
				d
					.addOption("name", "Display name (email if there is none)")
					.addOption("email", "Email address")
					.setValue(settings.attendeeFormat)
					.onChange(async (v) => {
						settings.attendeeFormat = v as AttendeeFormat;
						await save();
					})
			);
		new Setting(containerEl)
			.setName("People folder")
			.setDesc("Guests are linked to a note in this folder when its name, one of its aliases, or its email property matches. Empty searches the whole vault.")
			.addText((t) => {
				t.setPlaceholder("People")
					.setValue(settings.peopleFolder)
					.onChange(async (v) => {
						settings.peopleFolder = v.trim();
						await save();
					});
				new FolderSuggest(this.app, t.inputEl, (v) => {
					settings.peopleFolder = v;
					void save();
				});
			});
		new Setting(containerEl)
			.setName("Link guests without a note")
			.setDesc("Write guests that have no person note as links too, so you can create their note later. When off, they are plain text.")
			.addToggle((t) =>
				t.setValue(settings.linkUnmatchedAttendees).onChange(async (v) => {
					settings.linkUnmatchedAttendees = v;
					await save();
				})
			);
		new Setting(containerEl)
			.setName("Leave out attendees")
			.setDesc("Names or email addresses to never list, separated by commas. For example your own.")
			.addText((t) =>
				t
					.setPlaceholder("me@gmail.com")
					.setValue(settings.attendeeExclude)
					.onChange(async (v) => {
						settings.attendeeExclude = v;
						await save();
					})
			);
		new Setting(containerEl)
			.setName("Import now")
			.setDesc("Refresh all calendars, import new events, and create the daily notes set under \"Create daily notes ahead\".")
			.addButton((b) =>
				b.setButtonText("Import now").onClick(() => void this.plugin.refreshAndImport(true))
			);
		new Setting(containerEl)
			.setName("Forget import history")
			.setDesc(`Notes for ${Object.keys(settings.imported).length} events were created. Forgetting this lets deleted event notes be created again.`)
			.addButton((b) =>
				b.setButtonText("Forget").setWarning().onClick(() => {
					new ConfirmModal(
						this.app,
						"Forget import history?",
						"Event notes you deleted in the import window will be created again on the next import.",
						"Forget",
						async () => {
							settings.imported = {};
							settings.peopleAdded = {};
							settings.noteNames = {};
							await save();
							this.display();
						}
					).open();
				})
			);

		// Daily notes
		const core = coreDailyNoteOptions(this.app);
		new Setting(containerEl).setName("Daily notes").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "Empty fields use the daily note settings of the Periodic Notes plugin if its daily notes are on, otherwise those of the core daily notes plugin.",
		});
		new Setting(containerEl)
			.setName("Date format")
			.setDesc(`Preview: ${moment().format(settings.dailyFormat || core.format || DEFAULT_DAILY_FORMAT)}`)
			.addText((t) =>
				t
					.setPlaceholder(core.format || DEFAULT_DAILY_FORMAT)
					.setValue(settings.dailyFormat)
					.onChange(async (v) => {
						settings.dailyFormat = v.trim();
						await save();
					})
			);
		new Setting(containerEl)
			.setName("Folder")
			.setDesc("Where daily notes are created.")
			.addText((t) => {
				t.setPlaceholder(core.folder || "Vault root")
					.setValue(settings.dailyFolder)
					.onChange(async (v) => {
						settings.dailyFolder = v.trim();
						await save();
					});
				new FolderSuggest(this.app, t.inputEl, (v) => {
					settings.dailyFolder = v;
					void save();
				});
			});
		const dailyTemplate = settings.dailyTemplate || core.template || "";
		const templateStatus = !dailyTemplate
			? "No template is set, so new daily notes start empty."
			: resolveTemplateFile(this.app, dailyTemplate)
				? `Using "${dailyTemplate}".`
				: `"${dailyTemplate}" was not found.`;
		new Setting(containerEl)
			.setName("Template")
			.setDesc(templateStatus + " Template file for new daily notes. Supports {{date}}, {{time}}, {{title}}, {{date:FORMAT}}, {{date+1d:FORMAT}}, {{yesterday}} and {{tomorrow}}, all relative to the note's own date.")
			.addText((t) => {
				t.setPlaceholder(core.template || "No template")
					.setValue(settings.dailyTemplate)
					.onChange(async (v) => {
						settings.dailyTemplate = v.trim();
						await save();
					});
				new FileSuggest(this.app, t.inputEl, (v) => {
					settings.dailyTemplate = v;
					void save();
				});
			});
		intSetting(
			new Setting(containerEl)
				.setName("Create daily notes ahead")
				.setDesc("Automatically keep daily notes for today and this many days ahead. Set to zero to turn this off; you can still create them from the calendar or with the command."),
			() => settings.dailyAutoCreateDays,
			(n) => {
				settings.dailyAutoCreateDays = n;
				void this.plugin.autoCreateDailyNotes();
			},
			0,
			60
		);

		// Templater + view
		new Setting(containerEl).setName("Calendar view").setHeading();
		new Setting(containerEl)
			.setName("Run Templater on new notes")
			.setDesc("If the Templater plugin is installed, process its commands in new daily and event notes.")
			.addToggle((t) =>
				t.setValue(settings.runTemplater).onChange(async (v) => {
					settings.runTemplater = v;
					await save();
				})
			);
		new Setting(containerEl)
			.setName("Confirm before creating a daily note")
			.setDesc("Ask before creating a daily note when you click a day that has none.")
			.addToggle((t) =>
				t.setValue(settings.confirmBeforeCreate).onChange(async (v) => {
					settings.confirmBeforeCreate = v;
					await save();
				})
			);
		new Setting(containerEl)
			.setName("Start week on")
			.addDropdown((d) =>
				d
					.addOption("locale", "Locale default")
					.addOption("sunday", "Sunday")
					.addOption("monday", "Monday")
					.setValue(settings.weekStart)
					.onChange(async (v) => {
						settings.weekStart = v as WeekStart;
						await save();
					})
			);
		new Setting(containerEl)
			.setName("Show week numbers")
			.addToggle((t) =>
				t.setValue(settings.showWeekNumbers).onChange(async (v) => {
					settings.showWeekNumbers = v;
					await save();
				})
			);
		new Setting(containerEl)
			.setName("Open calendar on startup")
			.setDesc("Open the calendar in the right sidebar on startup.")
			.addToggle((t) =>
				t.setValue(settings.openOnStartup).onChange(async (v) => {
					settings.openOnStartup = v;
					await save();
				})
			);
	}

	private renderCalendar(calendar: CalendarSource): void {
		const settings = this.plugin.settings;
		const status = this.plugin.manager.getStatus(calendar.id);
		let desc = calendar.enabled ? "" : "Disabled. ";
		if (status.kind === "ok") desc += `${status.count} events loaded.`;
		else if (status.kind === "error") desc += `Error: ${status.message}`;
		else if (status.kind === "fetching") desc += "Loading…";
		if (calendar.enabled && !calendar.autoImport) desc += " Not imported automatically.";

		const row = new Setting(this.containerEl).setName(calendar.name).setDesc(desc.trim());
		const swatch = row.nameEl.createSpan({ cls: "bc-swatch" });
		swatch.style.setProperty("--bc-dot", calendar.color);
		row.nameEl.prepend(swatch);
		row.addExtraButton((b) =>
			b
				.setIcon("pencil")
				.setTooltip("Edit")
				.onClick(() => {
					new CalendarEditModal(this.app, this.plugin, calendar, async (c) => {
						const i = settings.calendars.findIndex((x) => x.id === c.id);
						if (i >= 0) settings.calendars[i] = c;
						await this.plugin.saveSettings();
						this.display();
						void this.plugin.refreshAndImport(true);
					}).open();
				})
		);
		row.addExtraButton((b) =>
			b
				.setIcon("trash")
				.setTooltip("Remove")
				.onClick(() => {
					new ConfirmModal(
						this.app,
						`Remove "${calendar.name}"?`,
						"Notes already created from this calendar are kept.",
						"Remove",
						async () => {
							settings.calendars = settings.calendars.filter((c) => c.id !== calendar.id);
							this.plugin.manager.forget(calendar.id);
							await this.plugin.saveSettings();
							this.display();
						}
					).open();
				})
		);
	}
}
