import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'eslint.config.mts',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		rules: {
			"obsidianmd/ui/sentence-case": [
				"warn",
				{ brands: ["Better Calendars", "Templater", "Google", "Google Calendar", "iCal"] },
			],
		},
	},
	{
		// moment is only used by the unit tests; the plugin uses Obsidian's copy.
		files: ["package.json"],
		rules: { "depend/ban-dependencies": "off" },
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"eslint.config.mts",
		"version-bump.mjs",
		"versions.json",
		"main.js",
		"vitest.config.ts",
		"tests",
	]),
);
