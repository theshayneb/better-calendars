import { App, Modal, Platform, apiVersion } from "obsidian";

export interface DeviceLocation {
	lat: number;
	lng: number;
	/** Accuracy radius in metres. */
	accuracy: number;
}

/** Why a location could not be read, in words the owner can act on. */
export class LocationError extends Error {}

/** The device's current position (GPS on mobile). Rejects with a LocationError. */
export function getDeviceLocation(timeoutMs = 20_000): Promise<DeviceLocation> {
	return new Promise((resolve, reject) => {
		const geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
		if (!geo) {
			reject(new LocationError("This device doesn't offer location to plugins."));
			return;
		}
		geo.getCurrentPosition(
			(pos) =>
				resolve({
					lat: pos.coords.latitude,
					lng: pos.coords.longitude,
					accuracy: pos.coords.accuracy,
				}),
			(err) => {
				const reason =
					err.code === err.PERMISSION_DENIED
						? "Location permission was denied"
						: err.code === err.POSITION_UNAVAILABLE
							? "The location isn't available"
							: err.code === err.TIMEOUT
								? "Timed out waiting for a location"
								: "Location failed";
				reject(new LocationError(`${reason} (${err.message || `code ${err.code}`}).`));
			},
			{ enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 }
		);
	});
}

/** "Test location (GPS)": shows what the device reports, so we know whether check-ins can use GPS here. */
export class LocationTestModal extends Modal {
	onOpen(): void {
		this.setTitle("Location test");
		const { contentEl } = this;
		const platform = Platform.isAndroidApp
			? "Android"
			: Platform.isIosApp
				? "iOS"
				: Platform.isMobile
					? "mobile"
					: "desktop";
		contentEl.createEl("p", {
			text: `Obsidian ${apiVersion} on ${platform}. Asking for your location…`,
		});
		const result = contentEl.createEl("p");
		const started = Date.now();
		getDeviceLocation()
			.then((loc) => {
				const secs = ((Date.now() - started) / 1000).toFixed(1);
				result.setText(
					`It works: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}, accurate to ${Math.round(loc.accuracy)} m (took ${secs} s).`
				);
			})
			.catch((e: unknown) => {
				result.setText(
					`It didn't work: ${e instanceof Error ? e.message : String(e)}`
				);
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export function openLocationTest(app: App): void {
	new LocationTestModal(app).open();
}
