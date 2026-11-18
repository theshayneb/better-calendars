/** Pure import decisions (no Obsidian APIs). */

/**
 * What to do with an event in the import window: follow its existing note,
 * leave it (a note was created before: deleted since, or made on another
 * device and not synced here yet), wait (background run while Sync is
 * busy), or create its note.
 */
export function importAction(o: {
	hasNote: boolean;
	recorded: boolean;
	background: boolean;
	settled: boolean;
}): "follow" | "skip" | "wait" | "create" {
	if (o.hasNote) return "follow";
	if (o.recorded) return "skip";
	if (o.background && !o.settled) return "wait";
	return "create";
}
