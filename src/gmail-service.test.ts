import { describe, test, expect } from "bun:test";
import { resolveLabelIds, validateLabelColor, GMAIL_LABEL_COLORS, decodeBase64Url, stripHtml, extractBody, extractAttachmentMetadata } from "./gmail-service";

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

describe("decodeBase64Url", () => {
	test("decodes standard base64url encoded string", () => {
		// "Hello World" in base64url
		const encoded = "SGVsbG8gV29ybGQ";
		expect(decodeBase64Url(encoded)).toBe("Hello World");
	});

	test("handles URL-safe characters (- and _)", () => {
		// String with characters that require URL-safe base64
		// Base64: "a+b/c=" becomes base64url: "a-b_c"
		const encoded = "YS1iX2M"; // "a-b_c" decoded
		expect(decodeBase64Url(encoded)).toBe("a-b_c");
	});

	test("decodes empty string", () => {
		expect(decodeBase64Url("")).toBe("");
	});

	test("decodes unicode content", () => {
		// "Hello 世界" in base64url
		const encoded = "SGVsbG8g5LiW55WM";
		expect(decodeBase64Url(encoded)).toBe("Hello 世界");
	});
});

describe("stripHtml", () => {
	test("removes HTML tags", () => {
		expect(stripHtml("<p>Hello</p>")).toBe("Hello");
	});

	test("converts multiple whitespace to single space", () => {
		expect(stripHtml("<p>Hello</p>   <p>World</p>")).toBe("Hello World");
	});

	test("handles nested tags", () => {
		expect(stripHtml("<div><p><strong>Bold</strong> text</p></div>")).toBe("Bold text");
	});

	test("handles empty string", () => {
		expect(stripHtml("")).toBe("");
	});

	test("preserves plain text", () => {
		expect(stripHtml("No HTML here")).toBe("No HTML here");
	});
});

describe("extractBody", () => {
	test("extracts body from simple message with direct body data", () => {
		const msg = {
			payload: {
				body: { data: "SGVsbG8gV29ybGQ" }, // "Hello World"
			},
		};
		expect(extractBody(msg)).toBe("Hello World");
	});

	test("prefers text/plain part over text/html", () => {
		const msg = {
			payload: {
				parts: [
					{ mimeType: "text/html", body: { data: "PHA-SFRNTDwvcD4" } }, // "<p>HTML</p>"
					{ mimeType: "text/plain", body: { data: "UGxhaW4gdGV4dA" } }, // "Plain text"
				],
			},
		};
		expect(extractBody(msg)).toBe("Plain text");
	});

	test("falls back to text/html when no text/plain", () => {
		const msg = {
			payload: {
				parts: [
					{ mimeType: "text/html", body: { data: "PHA-SFRNTDwvcD4" } }, // "<p>HTML</p>"
				],
			},
		};
		expect(extractBody(msg)).toBe("HTML"); // HTML tags stripped
	});

	test("returns empty string when no body found", () => {
		const msg = { payload: {} };
		expect(extractBody(msg)).toBe("");
	});

	test("returns empty string for null payload", () => {
		const msg = {};
		expect(extractBody(msg)).toBe("");
	});

	test("handles nested multipart structure", () => {
		const msg = {
			payload: {
				mimeType: "multipart/alternative",
				parts: [
					{
						mimeType: "multipart/related",
						parts: [
							{ mimeType: "text/plain", body: { data: "TmVzdGVkIHBsYWlu" } }, // "Nested plain"
						],
					},
				],
			},
		};
		expect(extractBody(msg)).toBe("Nested plain");
	});
});

describe("extractAttachmentMetadata", () => {
	test("extracts attachment metadata from message parts", () => {
		const msg = {
			payload: {
				parts: [
					{ mimeType: "text/plain", body: { data: "dGV4dA" } },
					{
						mimeType: "application/pdf",
						filename: "document.pdf",
						body: { attachmentId: "att123", size: 12345 },
					},
				],
			},
		};
		expect(extractAttachmentMetadata(msg)).toEqual([
			{ filename: "document.pdf", mimeType: "application/pdf", size: 12345 },
		]);
	});

	test("returns empty array when no attachments", () => {
		const msg = {
			payload: {
				parts: [{ mimeType: "text/plain", body: { data: "dGV4dA" } }],
			},
		};
		expect(extractAttachmentMetadata(msg)).toEqual([]);
	});

	test("handles multiple attachments", () => {
		const msg = {
			payload: {
				parts: [
					{
						mimeType: "image/png",
						filename: "image.png",
						body: { attachmentId: "att1", size: 1000 },
					},
					{
						mimeType: "application/pdf",
						filename: "doc.pdf",
						body: { attachmentId: "att2", size: 2000 },
					},
				],
			},
		};
		expect(extractAttachmentMetadata(msg)).toEqual([
			{ filename: "image.png", mimeType: "image/png", size: 1000 },
			{ filename: "doc.pdf", mimeType: "application/pdf", size: 2000 },
		]);
	});

	test("handles nested parts with attachments", () => {
		const msg = {
			payload: {
				mimeType: "multipart/mixed",
				parts: [
					{
						mimeType: "multipart/alternative",
						parts: [{ mimeType: "text/plain", body: { data: "dGV4dA" } }],
					},
					{
						mimeType: "application/pdf",
						filename: "nested.pdf",
						body: { attachmentId: "att1", size: 5000 },
					},
				],
			},
		};
		expect(extractAttachmentMetadata(msg)).toEqual([
			{ filename: "nested.pdf", mimeType: "application/pdf", size: 5000 },
		]);
	});

	test("uses default mimeType when not provided", () => {
		const msg = {
			payload: {
				parts: [
					{
						filename: "unknown.bin",
						body: { attachmentId: "att1", size: 100 },
					},
				],
			},
		};
		expect(extractAttachmentMetadata(msg)).toEqual([
			{ filename: "unknown.bin", mimeType: "application/octet-stream", size: 100 },
		]);
	});

	test("returns empty array for null payload", () => {
		expect(extractAttachmentMetadata({})).toEqual([]);
	});
});
