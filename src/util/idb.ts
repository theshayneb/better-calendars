/**
 * A tiny key-value store in IndexedDB, for per-device caches. IndexedDB is
 * local to the device and never synced (unlike files in the vault or the
 * plugin folder).
 */
const STORE = "cache";

function open(dbName: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(dbName, 1);
		req.onupgradeneeded = () => {
			if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
	});
}

async function run<T>(dbName: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
	const db = await open(dbName);
	try {
		return await new Promise<T>((resolve, reject) => {
			const req = fn(db.transaction(STORE, mode).objectStore(STORE));
			req.onsuccess = () => resolve(req.result as T);
			req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
		});
	} finally {
		db.close();
	}
}

export function idbGet<T>(dbName: string, key: string): Promise<T | undefined> {
	return run<T | undefined>(dbName, "readonly", (s) => s.get(key));
}

export async function idbSet(dbName: string, key: string, value: unknown): Promise<void> {
	await run(dbName, "readwrite", (s) => s.put(value, key));
}
