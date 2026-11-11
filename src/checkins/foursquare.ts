import { RequestUrlResponse, requestUrl } from "obsidian";
import { FsqPlace, LatLng } from "./logic";

const PLACES_API = "https://places-api.foursquare.com";
const PLACES_VERSION = "2025-06-17";
const V2_API = "https://api.foursquare.com/v2";
/** The v2 API wants a version date. */
const V2_VERSION = "20261101";
export const SWARM_REDIRECT = "obsidian://better-calendars-swarm";

export class FoursquareError extends Error {
	constructor(
		message: string,
		/** 0 when the request didn't get an answer (no signal, timeout). */
		readonly status: number
	) {
		super(message);
	}
}

const PLACE_FIELDS = "fsq_place_id,name,latitude,longitude,location,categories,distance,website";

interface RawPlace {
	fsq_place_id?: string;
	name?: string;
	latitude?: number;
	longitude?: number;
	distance?: number;
	website?: string;
	location?: { address?: string; formatted_address?: string; locality?: string; region?: string; postcode?: string };
	categories?: { fsq_category_id?: string; name?: string }[];
}

function toPlace(r: RawPlace): FsqPlace | null {
	if (!r.fsq_place_id || !r.name || typeof r.latitude !== "number" || typeof r.longitude !== "number") {
		return null;
	}
	const loc = r.location ?? {};
	const address =
		loc.formatted_address ||
		[loc.address, loc.locality, [loc.region, loc.postcode].filter(Boolean).join(" ")]
			.filter(Boolean)
			.join(", ");
	return {
		id: r.fsq_place_id,
		name: r.name,
		lat: r.latitude,
		lng: r.longitude,
		street: loc.address ?? "",
		address,
		categories: (r.categories ?? [])
			.filter((c) => c.fsq_category_id && c.name)
			.map((c) => ({ id: c.fsq_category_id as string, name: c.name as string })),
		website: r.website ?? "",
		distance: typeof r.distance === "number" ? r.distance : null,
	};
}

/** Status we give a response that Foursquare cut off before its body (see `call`). */
export const BROKEN_ANSWER = -1;

/**
 * Foursquare's Places API answers a rejected key with a 401 whose body it
 * never sends: it announces a length, then closes the connection. Android
 * reports that as "unexpected end of stream", desktop as a protocol error.
 */
const BROKEN_ANSWER_RE =
	/end of stream|transfer closed|not closed cleanly|protocol[_ ]?error|content[_ ]length|incomplete|premature|ECONNRESET|socket hang up/i;

async function call(
	url: string,
	init: { method?: string; headers?: Record<string, string>; body?: string; contentType?: string },
	/** What a cut-off answer most likely means for this request. */
	brokenAnswerMeans: string
): Promise<RequestUrlResponse> {
	let res: RequestUrlResponse;
	try {
		res = await requestUrl({ url, throw: false, ...init });
	} catch (e) {
		const raw = e instanceof Error ? e.message : String(e);
		if (BROKEN_ANSWER_RE.test(raw)) {
			throw new FoursquareError(`${brokenAnswerMeans} (${raw})`, BROKEN_ANSWER);
		}
		throw new FoursquareError(`Couldn't reach Foursquare (${raw}).`, 0);
	}
	if (res.status >= 400) {
		let detail = "";
		try {
			const body = res.json as { message?: string; meta?: { errorDetail?: string } };
			detail = body?.meta?.errorDetail ?? body?.message ?? "";
		} catch {
			/* not JSON */
		}
		throw new FoursquareError(
			`Foursquare said ${res.status}${detail ? `: ${detail}` : ""}.`,
			res.status
		);
	}
	return res;
}

/**
 * Places near `near`, nearest first, or (with `query`) places matching it,
 * near `near` when given and near the device's IP location otherwise.
 */
export async function searchPlaces(
	apiKey: string,
	opts: { near: LatLng | null; query?: string; limit?: number }
): Promise<FsqPlace[]> {
	if (!apiKey) throw new FoursquareError("Add your Foursquare API key in the settings first.", 401);
	const params = new URLSearchParams({ fields: PLACE_FIELDS, limit: String(opts.limit ?? 50) });
	if (opts.near) {
		params.set("ll", `${opts.near.lat},${opts.near.lng}`);
		if (!opts.query) {
			params.set("radius", "1000");
			params.set("sort", "DISTANCE");
		}
	}
	if (opts.query) params.set("query", opts.query);
	let res: RequestUrlResponse;
	try {
		res = await call(
			`${PLACES_API}/places/search?${params.toString()}`,
			{
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"X-Places-Api-Version": PLACES_VERSION,
					Accept: "application/json",
				},
			},
			KEY_REJECTED
		);
	} catch (e) {
		if (e instanceof FoursquareError && (e.status === 401 || e.status === BROKEN_ANSWER)) {
			throw new FoursquareError(
				/^fsq3/i.test(apiKey) ? `${KEY_REJECTED} ${LEGACY_KEY}` : KEY_REJECTED,
				401
			);
		}
		throw e;
	}
	const results = (res.json as { results?: RawPlace[] }).results ?? [];
	return results.map(toPlace).filter((p): p is FsqPlace => p !== null);
}

const KEY_REJECTED =
	"Foursquare rejected the API key. The Places API needs a Service API Key: in the Foursquare developer console, open your project, then Service API Keys, generate one and paste it under Settings → Better Calendars → Check-ins.";
const LEGACY_KEY = "Keys starting with fsq3 are the older kind and no longer work here.";

export function swarmAuthorizeUrl(clientId: string): string {
	const params = new URLSearchParams({
		client_id: clientId,
		response_type: "code",
		redirect_uri: SWARM_REDIRECT,
	});
	return `https://foursquare.com/oauth2/authenticate?${params.toString()}`;
}

/** Trade the code from the redirect for an access token (which doesn't expire). */
export async function swarmExchangeCode(clientId: string, clientSecret: string, code: string): Promise<string> {
	const params = new URLSearchParams({
		client_id: clientId,
		client_secret: clientSecret,
		grant_type: "authorization_code",
		redirect_uri: SWARM_REDIRECT,
		code,
	});
	const res = await call(
		`https://foursquare.com/oauth2/access_token?${params.toString()}`,
		{ headers: { Accept: "application/json" } },
		"Foursquare broke off its answer while signing in. Check the client ID and secret, then connect again."
	);
	const token = (res.json as { access_token?: string }).access_token;
	if (!token) throw new FoursquareError("Foursquare didn't return an access token.", res.status);
	return token;
}

const SWARM_BROKEN =
	"Foursquare broke off its answer. If this keeps happening, disconnect and connect Swarm again in the settings.";

function v2Headers(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

/** The connected user's name. */
export async function swarmUserName(token: string): Promise<string> {
	const res = await call(
		`${V2_API}/users/self?v=${V2_VERSION}`,
		{ headers: v2Headers(token) },
		SWARM_BROKEN
	);
	const user = (res.json as { response?: { user?: { firstName?: string; lastName?: string } } })
		.response?.user;
	return [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Swarm user";
}

/** Post a public check-in. Returns the Swarm check-in id. */
export async function swarmCheckIn(
	token: string,
	venueId: string,
	shout: string,
	at: LatLng | null
): Promise<string> {
	const params = new URLSearchParams({ v: V2_VERSION, venueId, broadcast: "public" });
	if (shout) params.set("shout", shout);
	if (at) params.set("ll", `${at.lat},${at.lng}`);
	// Sent as a form body: Android's HTTP stack can fail a POST without one.
	const res = await call(
		`${V2_API}/checkins/add?v=${V2_VERSION}`,
		{
			method: "POST",
			headers: v2Headers(token),
			contentType: "application/x-www-form-urlencoded",
			body: params.toString(),
		},
		SWARM_BROKEN
	);
	const id = (res.json as { response?: { checkin?: { id?: string } } }).response?.checkin?.id;
	if (!id) throw new FoursquareError("Swarm didn't confirm the check-in.", res.status);
	return id;
}
