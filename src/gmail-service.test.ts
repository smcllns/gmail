import { describe, test, expect } from "bun:test";
import { resolveLabelIds, validateLabelColor, GMAIL_LABEL_COLORS } from "./gmail-service";

describe("resolveLabelIds", () => {
	const nameToId = new Map([
		["inbox", "INBOX"],
		["work", "Label_123"],
	]);

	test("resolves known label names to IDs", () => {
		expect(resolveLabelIds(["work"], nameToId)).toEqual(["Label_123"]);
	});

	test("passes through unknown values as IDs", () => {
		expect(resolveLabelIds(["Label_456"], nameToId)).toEqual(["Label_456"]);
	});

	test("matches case-insensitively", () => {
		expect(resolveLabelIds(["WORK", "Work", "work"], nameToId)).toEqual([
			"Label_123",
			"Label_123",
			"Label_123",
		]);
	});
});

describe("validateLabelColor", () => {
	test("accepts valid Gmail palette colors", () => {
		expect(() => validateLabelColor("#fb4c2f", "bg")).not.toThrow();
	});

	test("accepts uppercase colors", () => {
		expect(() => validateLabelColor("#FB4C2F", "bg")).not.toThrow();
	});

	test("rejects invalid hex codes with clear error", () => {
		expect(() => validateLabelColor("#123456", "bg")).toThrow(/Invalid bg color: #123456/);
	});
});

describe("GMAIL_LABEL_COLORS", () => {
	test("contains expected palette colors", () => {
		expect(GMAIL_LABEL_COLORS.has("#fb4c2f")).toBe(true);
		expect(GMAIL_LABEL_COLORS.has("#ffffff")).toBe(true);
		expect(GMAIL_LABEL_COLORS.has("#000000")).toBe(true);
	});
});
