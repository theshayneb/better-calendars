// The pure modules only need Obsidian's moment (and requestUrl for typing).
import moment from "moment";
export { moment };
export const requestUrl = () => {
	throw new Error("not available in tests");
};
