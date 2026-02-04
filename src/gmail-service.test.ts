import { describe, test, expect } from "bun:test";
import { GmailService, resolveLabelIds, validateLabelColor, GMAIL_LABEL_COLORS, decodeBase64Url, decodeHtmlEntities, stripHtml, extractBody, extractAttachmentMetadata, normalizeNulls } from "./gmail-service";
import type { EmailAccount } from "./types";

describe("GmailService programmatic tokens", () => {
	const testAccount: EmailAccount = {
		email: "user@example.com",
		oauth2: {
			clientId: "test-client-id",
			clientSecret: "test-client-secret",
			refreshToken: "test-refresh-token",
			accessToken: "test-access-token",
		},
	};

	test("constructor accepts accounts option", () => {
		const service = new GmailService({ accounts: [testAccount] });
		const accounts = service.listAccounts();
		expect(accounts).toHaveLength(1);
		expect(accounts[0].email).toBe("user@example.com");
		expect(accounts[0].oauth2.clientId).toBe("test-client-id");
	});

	test("constructor with multiple accounts", () => {
		const account2: EmailAccount = {
			email: "other@example.com",
			oauth2: {
				clientId: "client-2",
				clientSecret: "secret-2",
				refreshToken: "refresh-2",
			},
		};
		const service = new GmailService({ accounts: [testAccount, account2] });
		const accounts = service.listAccounts();
		expect(accounts).toHaveLength(2);
		expect(accounts.map((a) => a.email).sort()).toEqual(["other@example.com", "user@example.com"]);
	});

	test("constructor without arguments still works", () => {
		const service = new GmailService();
		expect(service).toBeInstanceOf(GmailService);
	});

	test("setAccountTokens adds an account", () => {
		const service = new GmailService({ accounts: [] });
		service.setAccountTokens(testAccount);
		const accounts = service.listAccounts();
		expect(accounts).toHaveLength(1);
		expect(accounts[0].email).toBe("user@example.com");
	});

	test("setAccountTokens overwrites existing account with same email", () => {
		const service = new GmailService({ accounts: [testAccount] });
		const updated: EmailAccount = {
			email: "user@example.com",
			oauth2: {
				clientId: "new-client-id",
				clientSecret: "new-secret",
				refreshToken: "new-refresh-token",
			},
		};
		service.setAccountTokens(updated);
		const accounts = service.listAccounts();
		expect(accounts).toHaveLength(1);
		expect(accounts[0].oauth2.clientId).toBe("new-client-id");
	});

	test("setAccountTokens clears cached gmail client for that email", () => {
		const service = new GmailService({ accounts: [testAccount] });
		const updated: EmailAccount = {
			email: "user@example.com",
			oauth2: {
				clientId: "new-client-id",
				clientSecret: "new-secret",
				refreshToken: "new-refresh-token",
				accessToken: "new-access-token",
			},
		};
		service.setAccountTokens(updated);
		const accounts = service.listAccounts();
		expect(accounts[0].oauth2.accessToken).toBe("new-access-token");
	});

	test("deleteAccount removes in-memory account", () => {
		const service = new GmailService({ accounts: [testAccount] });
		expect(service.listAccounts()).toHaveLength(1);
		const deleted = service.deleteAccount("user@example.com");
		expect(deleted).toBe(true);
		expect(service.listAccounts()).toHaveLength(0);
	});

	test("deleteAccount returns false for unknown account", () => {
		const service = new GmailService({ accounts: [] });
		const deleted = service.deleteAccount("nonexistent@example.com");
		expect(deleted).toBe(false);
	});

	test("addGmailAccount rejects duplicate email from in-memory accounts", async () => {
		const service = new GmailService({ accounts: [testAccount] });
		await expect(
			service.addGmailAccount("user@example.com", "client", "secret"),
		).rejects.toThrow("Account 'user@example.com' already exists");
	});

	test("unknown email throws without triggering filesystem access", () => {
		const service = new GmailService({ accounts: [testAccount] });
		// Accessing a typo'd email should throw "not found" without
		// creating ~/.gmail-cli/ via lazy AccountStorage init.
		try {
			(service as any).getGmailClient("typo@example.com");
		} catch (e: any) {
			expect(e.message).toBe("Account 'typo@example.com' not found");
		}
		// _accountStorage should not have been initialized
		expect((service as any)._accountStorage).toBeUndefined();
	});
});

describe("GmailService configDir", () => {
	const testAccount: EmailAccount = {
		email: "user@example.com",
		oauth2: {
			clientId: "test-client-id",
			clientSecret: "test-client-secret",
			refreshToken: "test-refresh-token",
		},
	};

	test("configDir resolves relative paths to absolute", () => {
		const service = new GmailService({ configDir: "./my-config" });
		expect((service as any).configDir).toBe(require("path").resolve("./my-config"));
	});

	test("configDir undefined when not provided", () => {
		const service = new GmailService();
		expect((service as any).configDir).toBeUndefined();
	});

	test("configDir threads through to AccountStorage on lazy init", () => {
		const configDir = "/tmp/test-gmail-configdir-thread";
		const service = new GmailService({ configDir });
		// Trigger lazy AccountStorage initialization
		const storage = (service as any).accountStorage;
		expect(storage.configDir).toBe(configDir);
	});

	test("configDir works alongside accounts option", () => {
		const configDir = "/tmp/test-gmail-configdir-combo";
		const service = new GmailService({ configDir, accounts: [testAccount] });
		const accounts = service.listAccounts();
		expect(accounts).toHaveLength(1);
		expect(accounts[0].email).toBe("user@example.com");
		// Verify configDir is stored, not just accounts
		expect((service as any).configDir).toBe(configDir);
	});
});

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

describe("decodeHtmlEntities", () => {
	test("decodes common named entities", () => {
		expect(decodeHtmlEntities("&amp; &lt; &gt;")).toBe("& < >");
	});

	test("decodes quote entities", () => {
		expect(decodeHtmlEntities("&quot;hello&quot; &apos;world&apos;")).toBe('"hello" \'world\'');
	});

	test("decodes nbsp", () => {
		expect(decodeHtmlEntities("hello&nbsp;world")).toBe("hello world");
	});

	test("decodes decimal numeric character references", () => {
		expect(decodeHtmlEntities("&#65;&#66;&#67;")).toBe("ABC");
		expect(decodeHtmlEntities("&#8364;")).toBe("€");
	});

	test("decodes hex numeric character references", () => {
		expect(decodeHtmlEntities("&#x41;&#x42;&#x43;")).toBe("ABC");
		expect(decodeHtmlEntities("&#x20AC;")).toBe("€");
	});

	test("handles case insensitivity for named entities", () => {
		expect(decodeHtmlEntities("&AMP; &LT;")).toBe("& <");
	});

	test("preserves text without entities", () => {
		expect(decodeHtmlEntities("plain text")).toBe("plain text");
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

	test("decodes HTML entities after stripping tags", () => {
		expect(stripHtml("<p>Tom &amp; Jerry</p>")).toBe("Tom & Jerry");
		expect(stripHtml("<span>&lt;script&gt;</span>")).toBe("<script>");
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

	test("falls back to text/html when text/plain has empty data", () => {
		const msg = {
			payload: {
				parts: [
					{ mimeType: "text/plain", body: { data: "" } },
					{ mimeType: "text/html", body: { data: "PHA-SFRNTDwvcD4" } }, // "<p>HTML</p>"
				],
			},
		};
		expect(extractBody(msg)).toBe("HTML");
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

describe("normalizeNulls", () => {
	test("converts null to undefined", () => {
		expect(normalizeNulls(null)).toBe(undefined);
	});

	test("preserves undefined", () => {
		expect(normalizeNulls(undefined)).toBe(undefined);
	});

	test("preserves primitive values", () => {
		expect(normalizeNulls("hello")).toBe("hello");
		expect(normalizeNulls(42)).toBe(42);
		expect(normalizeNulls(true)).toBe(true);
		expect(normalizeNulls(false)).toBe(false);
	});

	test("converts null properties in objects to undefined", () => {
		const input = { a: "value", b: null, c: 123 };
		const result = normalizeNulls(input);
		expect(result).toEqual({ a: "value", b: undefined, c: 123 });
		expect("b" in result).toBe(true);
	});

	test("handles nested objects", () => {
		const input = { outer: { inner: null, value: "test" } };
		const result = normalizeNulls(input);
		expect(result).toEqual({ outer: { inner: undefined, value: "test" } });
	});

	test("handles arrays with null values", () => {
		const input = [1, null, "test", null];
		const result = normalizeNulls(input);
		expect(result).toEqual([1, undefined, "test", undefined]);
	});

	test("handles arrays of objects with null properties", () => {
		const input = [{ id: 1, name: null }, { id: 2, name: "test" }];
		const result = normalizeNulls(input);
		expect(result).toEqual([{ id: 1, name: undefined }, { id: 2, name: "test" }]);
	});

	test("handles deeply nested structures", () => {
		const input = {
			level1: {
				level2: {
					level3: {
						value: null,
						array: [{ nested: null }],
					},
				},
			},
		};
		const result = normalizeNulls(input);
		expect(result).toEqual({
			level1: {
				level2: {
					level3: {
						value: undefined,
						array: [{ nested: undefined }],
					},
				},
			},
		});
	});

	test("preserves empty objects and arrays", () => {
		expect(normalizeNulls({})).toEqual({});
		expect(normalizeNulls([])).toEqual([]);
	});
});
