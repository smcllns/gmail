import type {
	ThreadSearchResult,
	EnhancedThread,
	DownloadedAttachment,
	LabelOperationResult,
} from "./gmail-service.js";
import type { EmailAccount } from "./types.js";

export interface MockLabel {
	id: string;
	name: string;
	type: string;
	textColor?: string;
	backgroundColor?: string;
}

export interface MockCallRecord<T = unknown[]> {
	args: T;
	timestamp: number;
}

export interface MockGmailServiceCalls {
	searchThreads: MockCallRecord<[string, string, number?, string?, string[]?]>[];
	getThread: MockCallRecord<[string, string, boolean?]>[];
	modifyLabels: MockCallRecord<[string, string[], string[], string[]]>[];
	listLabels: MockCallRecord<[string]>[];
	createLabel: MockCallRecord<[string, string, { showInList?: boolean; showInMessageList?: boolean; textColor?: string; backgroundColor?: string }?]>[];
	updateLabel: MockCallRecord<[string, string, { name?: string; textColor?: string; backgroundColor?: string }]>[];
	getLabelMap: MockCallRecord<[string]>[];
}

export interface MockError {
	method: keyof MockGmailServiceCalls;
	error: Error;
	once?: boolean;
}

/**
 * A mock implementation of GmailService for testing purposes.
 * Allows setting fake data, tracking method calls, and simulating errors.
 */
export class MockGmailService {
	private threads: Map<string, EnhancedThread> = new Map();
	private searchResults: Map<string, ThreadSearchResult> = new Map();
	private labels: MockLabel[] = [];
	private errors: MockError[] = [];
	private nextLabelId = 1;

	public calls: MockGmailServiceCalls = {
		searchThreads: [],
		getThread: [],
		modifyLabels: [],
		listLabels: [],
		createLabel: [],
		updateLabel: [],
		getLabelMap: [],
	};

	// --- Configuration Methods ---

	/**
	 * Set a thread that will be returned by getThread().
	 */
	setThread(threadId: string, thread: EnhancedThread): void {
		this.threads.set(threadId, thread);
	}

	/**
	 * Set multiple threads at once.
	 */
	setThreads(threads: EnhancedThread[]): void {
		for (const thread of threads) {
			if (thread.id) {
				this.threads.set(thread.id, thread);
			}
		}
	}

	/**
	 * Set search results for a specific query.
	 * If query is "*", it will be used as the default for any unmatched query.
	 */
	setSearchResults(query: string, results: ThreadSearchResult): void {
		this.searchResults.set(query, results);
	}

	/**
	 * Set the labels that will be returned by listLabels().
	 */
	setLabels(labels: MockLabel[]): void {
		this.labels = [...labels];
	}

	/**
	 * Configure an error to be thrown when a method is called.
	 * If once is true, the error will only be thrown once.
	 */
	setError(method: keyof MockGmailServiceCalls, error: Error, once = false): void {
		this.errors.push({ method, error, once });
	}

	/**
	 * Accept account tokens for API parity with GmailService.
	 * The mock doesn't use tokens, so this is a no-op.
	 */
	setAccountTokens(_account: EmailAccount): void {
		// No-op: mock doesn't need real tokens
	}

	/**
	 * Clear all configured errors.
	 */
	clearErrors(): void {
		this.errors = [];
	}

	/**
	 * Clear error for a specific method.
	 */
	clearError(method: keyof MockGmailServiceCalls): void {
		this.errors = this.errors.filter((e) => e.method !== method);
	}

	/**
	 * Reset all mock state: threads, labels, errors, and call records.
	 */
	reset(): void {
		this.threads.clear();
		this.searchResults.clear();
		this.labels = [];
		this.errors = [];
		this.nextLabelId = 1;
		this.calls = {
			searchThreads: [],
			getThread: [],
			modifyLabels: [],
			listLabels: [],
			createLabel: [],
			updateLabel: [],
			getLabelMap: [],
		};
	}

	// --- Private Helpers ---

	private checkError(method: keyof MockGmailServiceCalls): void {
		const errorIndex = this.errors.findIndex((e) => e.method === method);
		if (errorIndex !== -1) {
			const { error, once } = this.errors[errorIndex];
			if (once) {
				this.errors.splice(errorIndex, 1);
			}
			throw error;
		}
	}

	private recordCall<K extends keyof MockGmailServiceCalls>(
		method: K,
		args: MockGmailServiceCalls[K][number]["args"],
	): void {
		(this.calls[method] as MockCallRecord[]).push({
			args,
			timestamp: Date.now(),
		});
	}

	// --- Mock GmailService Methods ---

	async searchThreads(
		email: string,
		query: string,
		maxResults = 10,
		pageToken?: string,
		labelIds?: string[],
	): Promise<ThreadSearchResult> {
		this.recordCall("searchThreads", [email, query, maxResults, pageToken, labelIds]);
		this.checkError("searchThreads");

		// Check for exact query match first, then fall back to "*" default
		const results = this.searchResults.get(query) ?? this.searchResults.get("*");

		if (results) {
			// Apply maxResults limit
			const limitedThreads = results.threads.slice(0, maxResults);
			return {
				threads: limitedThreads,
				nextPageToken: results.nextPageToken,
			};
		}

		return { threads: [] };
	}

	async getThread(
		email: string,
		threadId: string,
		downloadAttachments = false,
	): Promise<EnhancedThread | DownloadedAttachment[]> {
		this.recordCall("getThread", [email, threadId, downloadAttachments]);
		this.checkError("getThread");

		const thread = this.threads.get(threadId);
		if (!thread) {
			throw new Error(`Thread not found: ${threadId}`);
		}

		if (downloadAttachments) {
			// Return mock downloaded attachments based on attachment metadata in thread
			const downloads: DownloadedAttachment[] = [];
			for (const message of thread.messages || []) {
				if (message.parsed?.attachments) {
					for (const att of message.parsed.attachments) {
						downloads.push({
							messageId: message.id || "",
							filename: att.filename,
							path: `/mock/attachments/${att.filename}`,
							size: att.size,
							mimeType: att.mimeType,
							cached: false,
						});
					}
				}
			}
			return downloads;
		}

		return thread;
	}

	async modifyLabels(
		email: string,
		threadIds: string[],
		addLabels: string[] = [],
		removeLabels: string[] = [],
	): Promise<LabelOperationResult[]> {
		this.recordCall("modifyLabels", [email, threadIds, addLabels, removeLabels]);
		this.checkError("modifyLabels");

		return threadIds.map((threadId) => {
			const thread = this.threads.get(threadId);
			if (!thread) {
				return { threadId, success: false, error: `Thread not found: ${threadId}` };
			}

			// Update labels on all messages in the thread
			if (thread.messages) {
				for (const message of thread.messages) {
					const currentLabels = new Set(message.labelIds || []);
					for (const label of addLabels) {
						currentLabels.add(label);
					}
					for (const label of removeLabels) {
						currentLabels.delete(label);
					}
					message.labelIds = Array.from(currentLabels);
				}
			}

			return { threadId, success: true };
		});
	}

	async listLabels(
		email: string,
	): Promise<Array<{ id: string; name: string; type: string; textColor?: string; backgroundColor?: string }>> {
		this.recordCall("listLabels", [email]);
		this.checkError("listLabels");

		return this.labels.map((l) => ({
			id: l.id,
			name: l.name,
			type: l.type,
			textColor: l.textColor,
			backgroundColor: l.backgroundColor,
		}));
	}

	async createLabel(
		email: string,
		name: string,
		options: {
			showInList?: boolean;
			showInMessageList?: boolean;
			textColor?: string;
			backgroundColor?: string;
		} = {},
	): Promise<{ id: string; name: string; type: string; textColor?: string; backgroundColor?: string }> {
		this.recordCall("createLabel", [email, name, options]);
		this.checkError("createLabel");

		const newLabel: MockLabel = {
			id: `Label_${this.nextLabelId++}`,
			name,
			type: "user",
			textColor: options.textColor,
			backgroundColor: options.backgroundColor,
		};

		this.labels.push(newLabel);

		return {
			id: newLabel.id,
			name: newLabel.name,
			type: newLabel.type,
			textColor: newLabel.textColor,
			backgroundColor: newLabel.backgroundColor,
		};
	}

	async updateLabel(
		email: string,
		labelId: string,
		options: {
			name?: string;
			textColor?: string;
			backgroundColor?: string;
		},
	): Promise<{ id: string; name: string; type: string; textColor?: string; backgroundColor?: string }> {
		this.recordCall("updateLabel", [email, labelId, options]);
		this.checkError("updateLabel");

		const label = this.labels.find((l) => l.id === labelId);
		if (!label) {
			throw new Error(`Label not found: ${labelId}`);
		}

		if (options.name !== undefined) {
			label.name = options.name;
		}
		if (options.textColor !== undefined) {
			label.textColor = options.textColor;
		}
		if (options.backgroundColor !== undefined) {
			label.backgroundColor = options.backgroundColor;
		}

		return {
			id: label.id,
			name: label.name,
			type: label.type,
			textColor: label.textColor,
			backgroundColor: label.backgroundColor,
		};
	}

	async getLabelMap(email: string): Promise<{ idToName: Map<string, string>; nameToId: Map<string, string> }> {
		this.recordCall("getLabelMap", [email]);
		this.checkError("getLabelMap");

		const labels = await this.listLabels(email);
		const idToName = new Map<string, string>();
		const nameToId = new Map<string, string>();

		for (const l of labels) {
			idToName.set(l.id, l.name);
			nameToId.set(l.name.toLowerCase(), l.id);
		}

		return { idToName, nameToId };
	}

	resolveLabelIds(labels: string[], nameToId: Map<string, string>): string[] {
		return labels.map((l) => nameToId.get(l.toLowerCase()) || l);
	}
}
