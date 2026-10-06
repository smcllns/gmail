import type { ThreadSearchResult } from "./gmail-service.js";

export type ThreadSearchMessage =
	ThreadSearchResult["threads"][number]["messages"][number];

function parseInternalDate(value: string | undefined): number | undefined {
	const normalized = value?.trim();
	// Gmail internalDate is a non-negative epoch-millisecond string.
	if (!normalized || !/^\d+$/.test(normalized)) return undefined;

	const timestamp = Number(normalized);
	if (!Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) {
		return undefined;
	}
	return timestamp;
}

export function selectLatestThreadMessage(
	messages: readonly ThreadSearchMessage[],
): ThreadSearchMessage | undefined {
	let latestMessage: ThreadSearchMessage | undefined;
	let latestTimestamp: number | undefined;

	// Gmail returns thread messages oldest-first, so later entries win ties and fallback.
	for (const message of messages) {
		const timestamp = parseInternalDate(message.internalDate);
		if (timestamp === undefined) continue;
		if (latestTimestamp === undefined || timestamp >= latestTimestamp) {
			latestMessage = message;
			latestTimestamp = timestamp;
		}
	}

	return latestMessage ?? messages.at(-1);
}

export function formatSearchRowDate(message: ThreadSearchMessage | undefined): string {
	if (!message) return "";

	const internalTimestamp = parseInternalDate(message.internalDate);
	const timestamp = internalTimestamp ?? (message.date ? Date.parse(message.date) : Number.NaN);
	if (!Number.isFinite(timestamp)) return "";

	return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}
