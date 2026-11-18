import type { App, TAbstractFile } from "obsidian";

/** After startup (or the app coming back after a while), wait at least this long. */
export const SETTLE_AFTER_START_MS = 3 * 60_000;
/** ...and until no vault file has changed (except our own writes) for this long. */
export const SETTLE_QUIET_MS = 60_000;
/** Coming back after this long away counts as a fresh start. */
export const RESUME_AFTER_MS = 5 * 60_000;
/** Our own writes are ignored for this long. */
const OWN_WRITE_MS = 10_000;

export interface SettleState {
	now: number;
	/** When the plugin started, or the app came back after a while. */
	startedAt: number;
	/** Last vault change that wasn't ours (0 = none). */
	lastChange: number;
	/** The core Sync plugin says it's syncing (null = unknown or not in use). */
	syncing: boolean | null;
}

/**
 * Whether Obsidian Sync has likely caught up: the app has been open a few
 * minutes, no file has changed for a minute (Sync delivers other devices'
 * work as file changes), and Sync, where it says so, isn't syncing.
 */
export function isSettled(s: SettleState): boolean {
	if (s.now - s.startedAt < SETTLE_AFTER_START_MS) return false;
	if (s.lastChange > 0 && s.now - s.lastChange < SETTLE_QUIET_MS) return false;
	return s.syncing !== true;
}

/** Paths this plugin just wrote, so its own writes don't count as Sync activity. */
const own = new Map<string, number>();

export function markOwnWrite(...paths: string[]): void {
	const until = Date.now() + OWN_WRITE_MS;
	for (const p of paths) own.set(p, until);
}

function isOwn(path: string, now: number): boolean {
	const until = own.get(path);
	if (until === undefined) return false;
	if (until < now) {
		own.delete(path);
		return false;
	}
	return true;
}

/** Whether the core Sync plugin reports it is syncing. Undocumented internals, so guarded. */
function coreSyncSyncing(app: App): boolean | null {
	try {
		const sync = (
			app as unknown as {
				internalPlugins?: {
					getPluginById?: (id: string) => { enabled?: boolean; instance?: { syncing?: unknown } } | null;
				};
			}
		).internalPlugins?.getPluginById?.("sync");
		if (!sync?.enabled) return null;
		const syncing = sync.instance?.syncing;
		return typeof syncing === "boolean" ? syncing : null;
	} catch {
		return null;
	}
}

/** Tracks vault activity and app resumes to tell when Sync has settled. */
export class SyncSettle {
	private startedAt = Date.now();
	private lastChange = 0;
	private hiddenAt = 0;

	constructor(private readonly app: App) {}

	/** Feed every vault create/modify/delete/rename here. */
	onVaultChange(file: TAbstractFile, oldPath?: string): void {
		const now = Date.now();
		if (isOwn(file.path, now) || (oldPath !== undefined && isOwn(oldPath, now))) return;
		this.lastChange = now;
	}

	/** Feed document visibility changes here (phones and tablets resuming). */
	onVisibilityChange(hidden: boolean): void {
		const now = Date.now();
		if (hidden) {
			this.hiddenAt = now;
		} else if (this.hiddenAt > 0 && now - this.hiddenAt >= RESUME_AFTER_MS) {
			this.startedAt = now;
		}
	}

	/** The network came back: whatever was missed is about to sync. */
	onOnline(): void {
		this.startedAt = Date.now();
	}

	settled(): boolean {
		return isSettled({
			now: Date.now(),
			startedAt: this.startedAt,
			lastChange: this.lastChange,
			syncing: coreSyncSyncing(this.app),
		});
	}

	/** For the settings tab. */
	describe(): string {
		if (this.settled()) return "sync has settled";
		return "waiting for Obsidian Sync to settle";
	}
}
