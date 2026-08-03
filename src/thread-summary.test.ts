import { describe, expect, test } from "bun:test";
import type { ThreadSearchMessage } from "./thread-summary.js";
import { formatSearchRowDate, selectLatestThreadMessage } from "./thread-summary.js";

function message(
	id: string,
	internalDate: string,
	date = "Thu, 1 Jan 1970 00:00:00 +0000",
): ThreadSearchMessage {
	return {
		id,
		threadId: "thread-1",
		labelIds: [],
		snippet: "",
		historyId: "1",
		internalDate,
		from: `${id}@example.com`,
		to: "recipient@example.com",
		subject: id,
		date,
		hasAttachments: false,
	};
}

describe("selectLatestThreadMessage", () => {
	test("uses the greatest internal date regardless of array order", () => {
		const first = message("first", "1785530880000");
		const latest = message("latest", "1785783222000");
		const middle = message("middle", "1785600000000");

		expect(selectLatestThreadMessage([first, latest, middle])?.id).toBe("latest");
	});

	test("compares numeric timestamps rather than strings", () => {
		expect(selectLatestThreadMessage([message("nine", "9"), message("ten", "10")])?.id).toBe("ten");
	});

	test("uses the later array entry when timestamps tie", () => {
		expect(selectLatestThreadMessage([message("first", "10"), message("second", "10")])?.id).toBe("second");
	});

	test("rejects coercible and invalid timestamp strings", () => {
		const invalid = ["", "   ", "1.5", "+2", "Infinity", "not-a-date", "999999999999999999999"];
		const messages = invalid.map((value, index) => message(`invalid-${index}`, value));
		messages.splice(3, 0, message("valid", "3"));

		expect(selectLatestThreadMessage(messages)?.id).toBe("valid");
	});

	test("falls back to the final message when every internal date is invalid", () => {
		expect(selectLatestThreadMessage([message("first", ""), message("last", "invalid")])?.id).toBe("last");
	});

	test("returns undefined for an empty thread", () => {
		expect(selectLatestThreadMessage([])).toBeUndefined();
	});
});

describe("formatSearchRowDate", () => {
	test("renders the selected message internal date instead of a stale Date header", () => {
		const latest = message(
			"latest",
			"1785783222000",
			"Fri, 31 Jul 2026 20:48:00 +0000",
		);

		expect(formatSearchRowDate(latest)).toBe("2026-08-03 18:53");
	});

	test("falls back to the Date header when internal date is invalid", () => {
		const latest = message("latest", "invalid", "Mon, 3 Aug 2026 18:53:42 +0000");

		expect(formatSearchRowDate(latest)).toBe("2026-08-03 18:53");
	});

	test("returns blank for a missing message or invalid dates", () => {
		expect(formatSearchRowDate(undefined)).toBe("");
		expect(formatSearchRowDate(message("invalid", "", "not-a-date"))).toBe("");
	});
});
