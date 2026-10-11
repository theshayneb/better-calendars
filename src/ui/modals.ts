import { App, Modal, Notice, Setting, moment } from "obsidian";
import type BetterCalendarsPlugin from "../main";
import { CalendarSource } from "../types";
import { FileSuggest, FolderSuggest } from "./suggest";

export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly pwTitle: string,
		private readonly pwText: string,
		private readonly pwCta: string,
		private readonly pwOnConfirm: () => void | Promise<void>
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.pwTitle);
		this.contentEl.createEl("p", { text: this.pwText });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(this.pwCta)
					.setCta()
					.onClick(() => {
						this.close();
						void this.pwOnConfirm();
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** "Create daily notes in advance": pick a start date and a number of days. */
export class CreateAheadModal extends Modal {
	private pwFrom = moment().startOf("day").format("YYYY-MM-DD");
	private pwDays = 7;

	constructor(app: App, private readonly plugin: BetterCalendarsPlugin) {
		super(app);
	}

	onOpen(): void {
		this.setTitle("Create daily notes in advance");
		const { contentEl } = this;
		new Setting(contentEl).setName("Start date").addText((t) => {
			t.inputEl.type = "date";
			t.setValue(this.pwFrom).onChange((v) => (this.pwFrom = v));
		});
		new Setting(contentEl)
			.setName("Number of days")
			.setDesc("Daily notes that already exist are left untouched.")
			.addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.min = "1";
				t.inputEl.max = "366";
				t.setValue(String(this.pwDays)).onChange((v) => {
					this.pwDays = parseInt(v, 10);
				});
			});
		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText("Create")
				.setCta()
				.onClick(async () => {
					const from = moment(this.pwFrom, "YYYY-MM-DD", true);
					const days = this.pwDays;
					if (!from.isValid() || !Number.isFinite(days) || days < 1 || days > 366) {
						new Notice("Pick a valid date and 1 to 366 days.");
						return;
					}
					this.close();
					await this.plugin.createDailyNotesAhead(from, days, true);
				})
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Add or edit one calendar. Works on a copy; `onSave` gets the result. */
export class CalendarEditModal extends Modal {
	private pwDraft: CalendarSource;

	constructor(
		app: App,
		private readonly plugin: BetterCalendarsPlugin,
		calendar: CalendarSource,
		private readonly pwOnSave: (calendar: CalendarSource) => Promise<void>
	) {
		super(app);
		this.pwDraft = { ...calendar };
	}

	onOpen(): void {
		const d = this.pwDraft;
		const settings = this.plugin.settings;
		this.setTitle(d.url ? "Edit calendar" : "Add calendar");
		const { contentEl } = this;

		new Setting(contentEl).setName("Name").addText((t) =>
			t.setValue(d.name).onChange((v) => (d.name = v))
		);

		const urlSetting = new Setting(contentEl)
			.setName("Secret iCal address")
			.addText((t) => {
				t.inputEl.addClass("bc-wide-input");
				t.setPlaceholder("https://calendar.google.com/calendar/ical/.../basic.ics")
					.setValue(d.url)
					.onChange((v) => (d.url = v.trim()));
			});
		urlSetting.descEl.appendText(
			"In Google Calendar on the web: settings, click the calendar under \"Settings for my calendars\", then \"Integrate calendar\" and copy \"Secret address in iCal format\". Any other ICS link works too."
		);

		new Setting(contentEl).setName("Color").addColorPicker((c) =>
			c.setValue(d.color).onChange((v) => (d.color = v))
		);

		new Setting(contentEl)
			.setName("Enabled")
			.setDesc("Show this calendar's events.")
			.addToggle((t) => t.setValue(d.enabled).onChange((v) => (d.enabled = v)));

		new Setting(contentEl)
			.setName("Import automatically")
			.setDesc("Create notes for this calendar's events automatically. When off, click an event in the calendar view to create its note.")
			.addToggle((t) => t.setValue(d.autoImport).onChange((v) => (d.autoImport = v)));

		new Setting(contentEl)
			.setName("Skip all-day events")
			.setDesc("Ignore all-day events such as birthdays and holidays.")
			.addToggle((t) =>
				t.setValue(d.excludeAllDay).onChange((v) => (d.excludeAllDay = v))
			);

		new Setting(contentEl)
			.setName("Folder")
			.setDesc(`Where this calendar's event notes go. Empty: "${settings.eventFolder || "vault root"}".`)
			.addText((t) => {
				t.setPlaceholder(settings.eventFolder).setValue(d.folder).onChange((v) => (d.folder = v.trim()));
				new FolderSuggest(this.app, t.inputEl, (v) => (d.folder = v));
			});

		new Setting(contentEl)
			.setName("Template")
			.setDesc("Template file for this calendar's event notes. Empty: the default event template.")
			.addText((t) => {
				t.setPlaceholder(settings.eventTemplate || "Built-in template")
					.setValue(d.template)
					.onChange((v) => (d.template = v.trim()));
				new FileSuggest(this.app, t.inputEl, (v) => (d.template = v));
			});

		new Setting(contentEl)
			.setName("File name")
			.setDesc(`Empty: "${settings.eventTitlePattern}".`)
			.addText((t) =>
				t
					.setPlaceholder(settings.eventTitlePattern)
					.setValue(d.titlePattern)
					.onChange((v) => (d.titlePattern = v))
			);

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Save")
					.setCta()
					.onClick(async () => {
						if (!d.url) {
							new Notice("Paste the calendar's iCal address first.");
							return;
						}
						if (!d.name.trim()) d.name = "Calendar";
						this.close();
						await this.pwOnSave(d);
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
