// The pure modules only need Obsidian's moment (and requestUrl for typing).
import moment from "moment";
export { moment };
export const requestUrl = () => {
	throw new Error("not available in tests");
};
export class TFile {
	path = "";
	basename = "";
}
export class TFolder {}
export const normalizePath = (p: string) => p.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
/** Good enough for the tests: JSON values are valid YAML. */
export const stringifyYaml = (obj: Record<string, unknown>) =>
	Object.entries(obj)
		.map(([k, v]) => `${k}: ${JSON.stringify(v)}\n`)
		.join("");
