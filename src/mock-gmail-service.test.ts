import { describe, test, expect, beforeEach } from "bun:test";
import { MockGmailService } from "./mock-gmail-service";
import type { EnhancedThread, ThreadSearchResult } from "./gmail-service";
import type { EmailAccount } from "./types";

describe("MockGmailService", () => {
	let mock: MockGmailService;

	beforeEach(() => {
		mock = new MockGmailService();
	});

	describe("searchThreads", () => {
		test("returns empty results by default", async () => {
			const result = await mock.searchThreads("test@example.com", "in:inbox");
			expect(result.threads).toEqual([]);
		});

		test("returns configured search results for specific query", async () => {
			const searchResult: ThreadSearchResult = {
				threads: [
					{
						id: "thread1",
						historyId: "12345",
						messages: [
							{
								id: "msg1",
								threadId: "thread1",
								labelIds: ["INBOX"],
								snippet: "Test snippet",
								historyId: "12345",
								internalDate: "1234567890",
								from: "sender@example.com",
								to: "recipient@example.com",
								subject: "Test Subject",
								date: "2024-01-01",
								hasAttachments: false,
							},
						],
					},
				],
				nextPageToken: "token123",
			};

			mock.setSearchResults("in:inbox", searchResult);

			const result = await mock.searchThreads("test@example.com", "in:inbox");
			expect(result.threads).toHaveLength(1);
			expect(result.threads[0].id).toBe("thread1");
			expect(result.nextPageToken).toBe("token123");
		});

		test("uses wildcard query as fallback", async () => {
			const searchResult: ThreadSearchResult = {
				threads: [{ id: "default-thread", historyId: "1", messages: [] }],
			};

			mock.setSearchResults("*", searchResult);

			const result = await mock.searchThreads("test@example.com", "random query");
			expect(result.threads[0].id).toBe("default-thread");
		});

		test("respects maxResults limit", async () => {
			const searchResult: ThreadSearchResult = {
				threads: [
					{ id: "thread1", historyId: "1", messages: [] },
					{ id: "thread2", historyId: "2", messages: [] },
					{ id: "thread3", historyId: "3", messages: [] },
				],
			};

			mock.setSearchResults("*", searchResult);

			const result = await mock.searchThreads("test@example.com", "query", 2);
			expect(result.threads).toHaveLength(2);
		});

		test("records call parameters", async () => {
			await mock.searchThreads("test@example.com", "in:inbox", 10, "pageToken", ["INBOX"]);

			expect(mock.calls.searchThreads).toHaveLength(1);
			expect(mock.calls.searchThreads[0].args).toEqual([
				"test@example.com",
				"in:inbox",
				10,
				"pageToken",
				["INBOX"],
			]);
		});
	});

	describe("getThread", () => {
		test("throws error when thread not found", async () => {
			await expect(mock.getThread("test@example.com", "nonexistent")).rejects.toThrow(
				"Thread not found: nonexistent",
			);
		});

		test("returns configured thread", async () => {
			const thread: EnhancedThread = {
				id: "thread123",
				historyId: "456",
				messages: [
					{
						id: "msg1",
						threadId: "thread123",
						labelIds: ["INBOX"],
						parsed: {
							body: "Hello world",
							headers: {
								from: "sender@example.com",
								to: "recipient@example.com",
								subject: "Test Subject",
							},
							attachments: [],
						},
					},
				],
			};

			mock.setThread("thread123", thread);

			const result = await mock.getThread("test@example.com", "thread123");
			expect(result).toEqual(thread);
		});

		test("returns downloaded attachments when downloadAttachments is true", async () => {
			const thread: EnhancedThread = {
				id: "thread123",
				historyId: "456",
				messages: [
					{
						id: "msg1",
						threadId: "thread123",
						parsed: {
							body: "Email with attachment",
							headers: {},
							attachments: [
								{ filename: "doc.pdf", mimeType: "application/pdf", size: 1024 },
								{ filename: "image.png", mimeType: "image/png", size: 2048 },
							],
						},
					},
				],
			};

			mock.setThread("thread123", thread);

			const result = await mock.getThread("test@example.com", "thread123", true);
			expect(Array.isArray(result)).toBe(true);
			expect(result).toHaveLength(2);

			const downloads = result as any[];
			expect(downloads[0].filename).toBe("doc.pdf");
			expect(downloads[0].mimeType).toBe("application/pdf");
			expect(downloads[1].filename).toBe("image.png");
		});

		test("returns empty downloads when no attachments", async () => {
			const thread: EnhancedThread = {
				id: "thread123",
				historyId: "456",
				messages: [
					{
						id: "msg1",
						threadId: "thread123",
						parsed: {
							body: "No attachments",
							headers: {},
							attachments: [],
						},
					},
				],
			};

			mock.setThread("thread123", thread);

			const result = await mock.getThread("test@example.com", "thread123", true);
			expect(result).toEqual([]);
		});

		test("records call parameters", async () => {
			mock.setThread("thread123", { id: "thread123", historyId: "1" });
			await mock.getThread("test@example.com", "thread123", false);

			expect(mock.calls.getThread).toHaveLength(1);
			expect(mock.calls.getThread[0].args).toEqual(["test@example.com", "thread123", false]);
		});
	});

	describe("modifyLabels", () => {
		test("adds and removes labels from threads", async () => {
			const thread: EnhancedThread = {
				id: "thread1",
				historyId: "1",
				messages: [
					{
						id: "msg1",
						threadId: "thread1",
						labelIds: ["INBOX", "UNREAD"],
					},
				],
			};

			mock.setThread("thread1", thread);

			const result = await mock.modifyLabels(
				"test@example.com",
				["thread1"],
				["STARRED"],
				["UNREAD"],
			);

			expect(result[0].success).toBe(true);

			// Verify the thread was updated
			const updatedThread = (await mock.getThread("test@example.com", "thread1")) as EnhancedThread;
			expect(updatedThread.messages?.[0].labelIds).toContain("INBOX");
			expect(updatedThread.messages?.[0].labelIds).toContain("STARRED");
			expect(updatedThread.messages?.[0].labelIds).not.toContain("UNREAD");
		});

		test("handles messages without labelIds", async () => {
			const thread: EnhancedThread = {
				id: "thread1",
				historyId: "1",
				messages: [
					{
						id: "msg1",
						threadId: "thread1",
					},
				],
			};

			mock.setThread("thread1", thread);

			const result = await mock.modifyLabels(
				"test@example.com",
				["thread1"],
				["STARRED"],
				["UNREAD"],
			);

			expect(result[0].success).toBe(true);
			const updatedThread = (await mock.getThread("test@example.com", "thread1")) as EnhancedThread;
			expect(updatedThread.messages?.[0].labelIds).toEqual(["STARRED"]);
		});

		test("returns error for nonexistent thread", async () => {
			const result = await mock.modifyLabels("test@example.com", ["nonexistent"], ["STARRED"], []);
			expect(result[0].success).toBe(false);
			expect(result[0].error).toContain("Thread not found");
		});

		test("records call parameters", async () => {
			mock.setThread("thread1", { id: "thread1", historyId: "1", messages: [] });
			await mock.modifyLabels("test@example.com", ["thread1"], ["STARRED"], ["UNREAD"]);

			expect(mock.calls.modifyLabels).toHaveLength(1);
			expect(mock.calls.modifyLabels[0].args).toEqual([
				"test@example.com",
				["thread1"],
				["STARRED"],
				["UNREAD"],
			]);
		});
	});

	describe("listLabels", () => {
		test("returns empty array by default", async () => {
			const result = await mock.listLabels("test@example.com");
			expect(result).toEqual([]);
		});

		test("returns configured labels", async () => {
			mock.setLabels([
				{ id: "INBOX", name: "INBOX", type: "system" },
				{ id: "Label_1", name: "Work", type: "user", textColor: "#ffffff", backgroundColor: "#fb4c2f" },
			]);

			const result = await mock.listLabels("test@example.com");
			expect(result).toHaveLength(2);
			expect(result[0].name).toBe("INBOX");
			expect(result[1].name).toBe("Work");
			expect(result[1].backgroundColor).toBe("#fb4c2f");
		});
	});

	describe("createLabel", () => {
		test("creates a new label and returns it", async () => {
			const result = await mock.createLabel("test@example.com", "New Label", {
				textColor: "#ffffff",
				backgroundColor: "#fb4c2f",
			});

			expect(result.name).toBe("New Label");
			expect(result.type).toBe("user");
			expect(result.id).toMatch(/^Label_\d+$/);
			expect(result.textColor).toBe("#ffffff");

			// Verify it was added to the list
			const labels = await mock.listLabels("test@example.com");
			expect(labels).toHaveLength(1);
			expect(labels[0].name).toBe("New Label");
		});

		test("assigns unique IDs to each label", async () => {
			const result1 = await mock.createLabel("test@example.com", "Label 1");
			const result2 = await mock.createLabel("test@example.com", "Label 2");

			expect(result1.id).not.toBe(result2.id);
		});
	});

	describe("updateLabel", () => {
		test("updates existing label", async () => {
			mock.setLabels([{ id: "Label_1", name: "Old Name", type: "user" }]);

			const result = await mock.updateLabel("test@example.com", "Label_1", {
				name: "New Name",
				textColor: "#ffffff",
			});

			expect(result.name).toBe("New Name");
			expect(result.textColor).toBe("#ffffff");

			// Verify it was updated in the list
			const labels = await mock.listLabels("test@example.com");
			expect(labels[0].name).toBe("New Name");
		});

		test("throws error for nonexistent label", async () => {
			await expect(
				mock.updateLabel("test@example.com", "nonexistent", { name: "New Name" }),
			).rejects.toThrow("Label not found: nonexistent");
		});
	});

	describe("getLabelMap", () => {
		test("returns maps for label lookup", async () => {
			mock.setLabels([
				{ id: "INBOX", name: "INBOX", type: "system" },
				{ id: "Label_1", name: "Work", type: "user" },
			]);

			const result = await mock.getLabelMap("test@example.com");

			expect(result.idToName.get("INBOX")).toBe("INBOX");
			expect(result.idToName.get("Label_1")).toBe("Work");
			expect(result.nameToId.get("inbox")).toBe("INBOX");
			expect(result.nameToId.get("work")).toBe("Label_1");
		});
	});

	describe("resolveLabelIds", () => {
		test("resolves label names to IDs", () => {
			const nameToId = new Map([
				["inbox", "INBOX"],
				["work", "Label_1"],
			]);

			const result = mock.resolveLabelIds(["work", "INBOX"], nameToId);
			expect(result).toEqual(["Label_1", "INBOX"]);
		});

		test("passes through unknown labels", () => {
			const nameToId = new Map<string, string>();
			const result = mock.resolveLabelIds(["Unknown_Label"], nameToId);
			expect(result).toEqual(["Unknown_Label"]);
		});
	});

	describe("error simulation", () => {
		test("throws configured error", async () => {
			mock.setError("searchThreads", new Error("API Error"));

			await expect(mock.searchThreads("test@example.com", "query")).rejects.toThrow("API Error");
		});

		test("throws configured error for modifyLabels", async () => {
			mock.setError("modifyLabels", new Error("Modify Error"));

			await expect(
				mock.modifyLabels("test@example.com", ["thread1"], ["STARRED"], []),
			).rejects.toThrow("Modify Error");
		});

		test("throws error only once when once=true", async () => {
			mock.setSearchResults("*", { threads: [] });
			mock.setError("searchThreads", new Error("Temporary Error"), true);

			// First call throws
			await expect(mock.searchThreads("test@example.com", "query")).rejects.toThrow("Temporary Error");

			// Second call succeeds
			const result = await mock.searchThreads("test@example.com", "query");
			expect(result.threads).toEqual([]);
		});

		test("clearError removes specific method error", async () => {
			mock.setError("searchThreads", new Error("Error 1"));
			mock.setError("getThread", new Error("Error 2"));

			mock.clearError("searchThreads");
			mock.setSearchResults("*", { threads: [] });

			// searchThreads should work now
			const result = await mock.searchThreads("test@example.com", "query");
			expect(result.threads).toEqual([]);

			// getThread should still throw
			await expect(mock.getThread("test@example.com", "thread1")).rejects.toThrow("Error 2");
		});

		test("clearErrors removes all errors", async () => {
			mock.setError("searchThreads", new Error("Error 1"));
			mock.setError("getThread", new Error("Error 2"));

			mock.clearErrors();
			mock.setSearchResults("*", { threads: [] });
			mock.setThread("thread1", { id: "thread1", historyId: "1" });

			// Both should work now
			await mock.searchThreads("test@example.com", "query");
			await mock.getThread("test@example.com", "thread1");
		});
	});

	describe("reset", () => {
		test("clears all state", async () => {
			// Set up some state
			mock.setThread("thread1", { id: "thread1", historyId: "1" });
			mock.setLabels([{ id: "Label_1", name: "Test", type: "user" }]);
			mock.setSearchResults("query", { threads: [] });
			mock.setError("searchThreads", new Error("Test"));
			await mock.createLabel("test@example.com", "New Label");

			// Record some calls
			mock.clearErrors();
			mock.setSearchResults("*", { threads: [] });
			await mock.searchThreads("test@example.com", "query");

			// Reset
			mock.reset();

			// Verify everything is cleared
			expect(mock.calls.searchThreads).toHaveLength(0);
			expect(mock.calls.createLabel).toHaveLength(0);

			const labels = await mock.listLabels("test@example.com");
			expect(labels).toHaveLength(0);

			const searchResult = await mock.searchThreads("test@example.com", "query");
			expect(searchResult.threads).toHaveLength(0);

			await expect(mock.getThread("test@example.com", "thread1")).rejects.toThrow("Thread not found");
		});
	});

	describe("call tracking", () => {
		test("tracks timestamps for calls", async () => {
			const before = Date.now();
			mock.setSearchResults("*", { threads: [] });
			await mock.searchThreads("test@example.com", "query");
			const after = Date.now();

			expect(mock.calls.searchThreads[0].timestamp).toBeGreaterThanOrEqual(before);
			expect(mock.calls.searchThreads[0].timestamp).toBeLessThanOrEqual(after);
		});

		test("tracks multiple calls", async () => {
			mock.setSearchResults("*", { threads: [] });

			await mock.searchThreads("test@example.com", "query1");
			await mock.searchThreads("test@example.com", "query2");
			await mock.searchThreads("test@example.com", "query3");

			expect(mock.calls.searchThreads).toHaveLength(3);
			expect(mock.calls.searchThreads[0].args[1]).toBe("query1");
			expect(mock.calls.searchThreads[1].args[1]).toBe("query2");
			expect(mock.calls.searchThreads[2].args[1]).toBe("query3");
		});
	});

	describe("setThreads convenience method", () => {
		test("sets multiple threads at once", async () => {
			mock.setThreads([
				{ id: "thread1", historyId: "1" },
				{ id: "thread2", historyId: "2" },
				{ id: "thread3", historyId: "3" },
			]);

			const thread1 = await mock.getThread("test@example.com", "thread1");
			const thread2 = await mock.getThread("test@example.com", "thread2");
			const thread3 = await mock.getThread("test@example.com", "thread3");

			expect((thread1 as EnhancedThread).id).toBe("thread1");
			expect((thread2 as EnhancedThread).id).toBe("thread2");
			expect((thread3 as EnhancedThread).id).toBe("thread3");
		});
	});

	describe("setAccountTokens", () => {
		test("is a callable method for API parity with GmailService", () => {
			expect(typeof mock.setAccountTokens).toBe("function");
		});

		test("accepts an EmailAccount and is a no-op", () => {
			mock.setAccountTokens({
				email: "user@example.com",
				oauth2: {
					clientId: "id",
					clientSecret: "secret",
					refreshToken: "refresh",
				},
			});
			// No error thrown — mock accepts but doesn't need tokens
		});
	});
});
