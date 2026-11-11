import { describe, expect, it } from "vitest";
import moment from "moment";
import { TFile } from "obsidian";
import { getDailyNote } from "../src/daily/daily-notes";

function vault(paths: string[]) {
	const files = paths.map((path) =>
		Object.assign(new TFile(), { path, basename: path.split("/").pop()!.replace(/\.md$/, "") })
	);
	const byPath = new Map(files.map((f) => [f.path, f]));
	return {
		vault: {
			getMarkdownFiles: () => files,
			getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
			getFileByPath: (p: string) => byPath.get(p) ?? null,
		},
	} as never;
}

const config = { folder: "Journal", format: "YYYY-MM-DD", template: "" };
const day = moment("2017-06-03", "YYYY-MM-DD");

describe("getDailyNote", () => {
	it("finds the note at the configured path", () => {
		const app = vault(["Journal/2017-06-03.md"]);
		expect(getDailyNote(app, config, day)?.path).toBe("Journal/2017-06-03.md");
	});

	it("finds older notes moved into subfolders", () => {
		const app = vault(["Journal/2017/06/2017-06-03.md", "Other/2017-06-04.md"]);
		expect(getDailyNote(app, config, day)?.path).toBe("Journal/2017/06/2017-06-03.md");
	});

	it("prefers the daily notes folder, then anywhere", () => {
		expect(getDailyNote(vault(["Archive/2017-06-03.md", "Journal/old/2017-06-03.md"]), config, day)?.path).toBe(
			"Journal/old/2017-06-03.md"
		);
		expect(getDailyNote(vault(["Archive/2017-06-03.md"]), config, day)?.path).toBe("Archive/2017-06-03.md");
		expect(getDailyNote(vault(["Journal/2017-06-04.md"]), config, day)).toBeNull();
	});
});
