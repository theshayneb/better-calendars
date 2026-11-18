/** Local-storage keys (per device, never synced). */
export const BACKGROUND_KEY = "better-calendars-background";
/** Before 1.4.0: "off" when "Import on this device" was turned off. */
export const LEGACY_IMPORT_KEY = "better-calendars-import-here";
export const LAST_RUN_KEY = "better-calendars-last-background-run";
export const LAST_LOCATION_KEY = "better-calendars-last-location";

/**
 * Whether this device runs background work (imports, renames, daily notes
 * ahead, Swarm pulls). Your own choice wins; a device where import was
 * turned off before 1.4.0 stays off; otherwise on for desktop, off for
 * phones and tablets.
 */
export function backgroundOn(stored: unknown, legacy: unknown, isDesktopApp: boolean): boolean {
	if (stored === "on") return true;
	if (stored === "off") return false;
	if (legacy === "off") return false;
	return isDesktopApp;
}
