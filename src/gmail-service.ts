import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { OAuth2Client } from "google-auth-library";
import { type gmail_v1, google } from "googleapis";
import { AccountStorage } from "./account-storage.js";
import { GmailOAuthFlow } from "./gmail-oauth-flow.js";
import type { EmailAccount } from "./types.js";

type GmailThread = gmail_v1.Schema$Thread;
type GmailMessage = gmail_v1.Schema$Message;

export const GMAIL_LABEL_COLORS = new Set([
	"#000000", "#434343", "#666666", "#999999", "#cccccc", "#efefef", "#f3f3f3", "#ffffff",
	"#fb4c2f", "#ffad47", "#fad165", "#16a766", "#43d692", "#4a86e8", "#a479e2", "#f691b3",
	"#f6c5be", "#ffe6c7", "#fef1d1", "#b9e4d0", "#c6f3de", "#c9daf8", "#e4d7f5", "#fcdee8",
	"#efa093", "#ffd6a2", "#fce8b3", "#89d3b2", "#a0eac9", "#a4c2f4", "#d0bcf1", "#fbc8d9",
	"#e66550", "#ffbc6b", "#fcda83", "#44b984", "#68dfa9", "#6d9eeb", "#b694e8", "#f7a7c0",
	"#cc3a21", "#eaa041", "#f2c960", "#149e60", "#3dc789", "#3c78d8", "#8e63ce", "#e07798",
	"#ac2b16", "#cf8933", "#d5ae49", "#0b804b", "#2a9c68", "#285bac", "#653e9b", "#b65775",
	"#822111", "#a46a21", "#aa8831", "#076239", "#1a764d", "#1c4587", "#41236d", "#83334c",
	"#464646", "#e7e7e7", "#0d3472", "#b6cff5", "#0d3b44", "#98d7e4", "#3d188e", "#e3d7ff",
	"#711a36", "#fbd3e0", "#8a1c0a", "#f2b2a8", "#7a2e0b", "#ffc8af", "#7a4706", "#ffdeb5",
	"#594c05", "#fbe983", "#684e07", "#fdedc1", "#0b4f30", "#b3efd3", "#04502e", "#a2dcc1",
	"#c2c2c2", "#4986e7", "#2da2bb", "#b99aff", "#994a64", "#f691b2", "#ff7537", "#ffad46",
	"#662e37", "#ebdbde", "#cca6ac", "#094228", "#42d692", "#16a765",
]);

export function validateLabelColor(color: string, name: string): void {
	const normalized = color.toLowerCase();
	if (!GMAIL_LABEL_COLORS.has(normalized)) {
		throw new Error(`Invalid ${name} color: ${color}. Must be a hex code from Gmail's allowed palette.`);
	}
}

export function decodeBase64Url(data: string): string {
	if (!data) return "";
	const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
	return Buffer.from(base64, "base64").toString("utf-8");
}

export function stripHtml(html: string): string {
	return html
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

type MessagePayload = {
	body?: { data?: string | null };
	mimeType?: string | null;
	parts?: MessagePayload[];
	filename?: string | null;
};

export function extractBody(msg: { payload?: MessagePayload }): string {
	if (!msg.payload) return "";

	if (msg.payload.body?.data) {
		return decodeBase64Url(msg.payload.body.data);
	}

	const findTextPart = (parts: MessagePayload[] | undefined, mimeType: string): string | undefined => {
		if (!parts) return undefined;
		for (const part of parts) {
			if (part.mimeType === mimeType && part.body?.data) {
				return decodeBase64Url(part.body.data);
			}
			if (part.parts) {
				const nested = findTextPart(part.parts, mimeType);
				if (nested) return nested;
			}
		}
		return undefined;
	};

	const plainText = findTextPart(msg.payload.parts, "text/plain");
	if (plainText) return plainText;

	const htmlText = findTextPart(msg.payload.parts, "text/html");
	if (htmlText) return stripHtml(htmlText);

	return "";
}

export interface AttachmentMetadata {
	filename: string;
	mimeType: string;
	size: number;
}

export function extractAttachmentMetadata(msg: { payload?: MessagePayload }): AttachmentMetadata[] {
	const attachments: AttachmentMetadata[] = [];

	const collectAttachments = (parts: MessagePayload[] | undefined): void => {
		if (!parts) return;
		for (const part of parts) {
			if (part.filename && part.filename.length > 0) {
				attachments.push({
					filename: part.filename,
					mimeType: part.mimeType || "application/octet-stream",
					size: (part as any).body?.size || 0,
				});
			}
			if (part.parts) {
				collectAttachments(part.parts);
			}
		}
	};

	collectAttachments(msg.payload?.parts);
	return attachments;
}

export function resolveLabelIds(labels: string[], nameToId: Map<string, string>): string[] {
	return labels.map((l) => nameToId.get(l.toLowerCase()) || l);
}

export interface ThreadSearchResult {
	threads: Array<{
		id: string;
		historyId: string;
		messages: Array<{
			id: string;
			threadId: string;
			labelIds: string[];
			snippet: string;
			historyId: string;
			internalDate: string;
			from: string | undefined;
			to: string | undefined;
			subject: string | undefined;
			date: string | undefined;
			hasAttachments: boolean;
		}>;
	}>;
	nextPageToken?: string;
}

export interface AttachmentDownloadResult {
	success: boolean;
	filename: string;
	path?: string;
	error?: string;
	cached?: boolean;
}

export interface DownloadedAttachment {
	messageId: string;
	filename: string;
	path: string;
	size: number;
	mimeType: string;
	cached: boolean;
}

export interface LabelOperationResult {
	threadId: string;
	success: boolean;
	error?: string;
}

export interface ParsedHeaders {
	from?: string;
	to?: string;
	subject?: string;
	date?: string;
	replyTo?: string;
	listUnsubscribe?: string;
	xMailer?: string;
}

export interface ParsedMessageContent {
	body: string;
	headers: ParsedHeaders;
	attachments: AttachmentMetadata[];
}

export interface EnhancedMessage extends GmailMessage {
	parsed: ParsedMessageContent;
}

export interface EnhancedThread extends Omit<GmailThread, "messages"> {
	messages?: EnhancedMessage[];
}

export class GmailService {
	private accountStorage = new AccountStorage();
	private gmailClients: Map<string, any> = new Map();

	async addGmailAccount(email: string, clientId: string, clientSecret: string, manual = false): Promise<void> {
		if (this.accountStorage.hasAccount(email)) {
			throw new Error(`Account '${email}' already exists`);
		}

		const oauthFlow = new GmailOAuthFlow(clientId, clientSecret);
		const refreshToken = await oauthFlow.authorize(manual);

		const account: EmailAccount = {
			email,
			oauth2: { clientId, clientSecret, refreshToken },
		};

		this.accountStorage.addAccount(account);
	}

	deleteAccount(email: string): boolean {
		this.gmailClients.delete(email);
		return this.accountStorage.deleteAccount(email);
	}

	listAccounts(): EmailAccount[] {
		return this.accountStorage.getAllAccounts();
	}

	setCredentials(clientId: string, clientSecret: string): void {
		this.accountStorage.setCredentials(clientId, clientSecret);
	}

	getCredentials(): { clientId: string; clientSecret: string } | null {
		return this.accountStorage.getCredentials();
	}

	setDefaultAccount(email: string): void {
		this.accountStorage.setDefaultAccount(email);
	}

	getDefaultAccount(): string | null {
		return this.accountStorage.getDefaultAccount();
	}

	clearDefaultAccount(): void {
		this.accountStorage.clearDefaultAccount();
	}

	private getGmailClient(email: string): any {
		if (!this.gmailClients.has(email)) {
			const account = this.accountStorage.getAccount(email);
			if (!account) {
				throw new Error(`Account '${email}' not found`);
			}

			const oauth2Client = new OAuth2Client(
				account.oauth2.clientId,
				account.oauth2.clientSecret,
				"http://localhost",
			);

			oauth2Client.setCredentials({
				refresh_token: account.oauth2.refreshToken,
				access_token: account.oauth2.accessToken,
			});

			const gmail = google.gmail({ version: "v1", auth: oauth2Client });
			this.gmailClients.set(email, gmail);
		}

		return this.gmailClients.get(email)!;
	}

	async searchThreads(
		email: string,
		query: string,
		maxResults = 10,
		pageToken?: string,
		labelIds?: string[],
	): Promise<ThreadSearchResult> {
		const gmail = this.getGmailClient(email);
		const response = await gmail.users.threads.list({
			userId: "me",
			q: query || undefined,
			maxResults,
			pageToken,
			labelIds: labelIds?.length ? labelIds : undefined,
		});

		const threads = response.data.threads || [];
		const detailedThreads: GmailThread[] = [];

		for (const thread of threads) {
			const detail = (await this.getThread(email, thread.id, false)) as GmailThread;
			detailedThreads.push(detail);
		}

		return {
			threads: detailedThreads.map((thread) => ({
				id: thread.id || "",
				historyId: thread.historyId || "",
				messages: (thread.messages || []).map((msg) => ({
					id: msg.id || "",
					threadId: msg.threadId || "",
					labelIds: msg.labelIds || [],
					snippet: msg.snippet || "",
					historyId: msg.historyId || "",
					internalDate: msg.internalDate || "",
					from: this.getHeaderValue(msg, "from"),
					to: this.getHeaderValue(msg, "to"),
					subject: this.getHeaderValue(msg, "subject"),
					date: this.getHeaderValue(msg, "date"),
					hasAttachments: msg.payload?.parts?.some((part) => part.filename && part.filename.length > 0) || false,
				})),
			})),
			nextPageToken: response.data.nextPageToken,
		};
	}

	async getThread(
		email: string,
		threadId: string,
		downloadAttachments = false,
	): Promise<EnhancedThread | DownloadedAttachment[]> {
		const gmail = this.getGmailClient(email);
		const response = await gmail.users.threads.get({
			userId: "me",
			id: threadId,
		});

		const thread = response.data;

		if (!downloadAttachments) {
			const enhancedMessages: EnhancedMessage[] = (thread.messages || []).map((msg: GmailMessage) => ({
				...msg,
				parsed: {
					body: extractBody(msg),
					headers: {
						from: this.getHeaderValue(msg, "From"),
						to: this.getHeaderValue(msg, "To"),
						subject: this.getHeaderValue(msg, "Subject"),
						date: this.getHeaderValue(msg, "Date"),
						replyTo: this.getHeaderValue(msg, "Reply-To"),
						listUnsubscribe: this.getHeaderValue(msg, "List-Unsubscribe"),
						xMailer: this.getHeaderValue(msg, "X-Mailer"),
					},
					attachments: extractAttachmentMetadata(msg),
				},
			}));

			return {
				...thread,
				messages: enhancedMessages,
			} as EnhancedThread;
		}

		const attachmentsToDownload: Array<{
			messageId: string;
			attachmentId: string;
			filename: string;
			size: number;
			mimeType: string;
		}> = [];

		for (const message of thread.messages || []) {
			if (message.payload?.parts) {
				for (const part of message.payload.parts) {
					if (part.body?.attachmentId && part.filename) {
						attachmentsToDownload.push({
							messageId: message.id!,
							attachmentId: part.body.attachmentId,
							filename: part.filename,
							size: part.body.size || 0,
							mimeType: part.mimeType || "application/octet-stream",
						});
					}
				}
			}
		}

		const downloadResults = await this.downloadAttachments(
			email,
			attachmentsToDownload.map((att) => ({
				messageId: att.messageId,
				attachmentId: att.attachmentId,
				filename: att.filename,
			})),
		);

		const downloadedAttachments: DownloadedAttachment[] = [];

		for (let i = 0; i < attachmentsToDownload.length; i++) {
			const attachment = attachmentsToDownload[i];
			const result = downloadResults[i];

			if (result.success && result.path) {
				downloadedAttachments.push({
					messageId: attachment.messageId,
					filename: attachment.filename,
					path: result.path,
					size: attachment.size,
					mimeType: attachment.mimeType,
					cached: result.cached || false,
				});
			}
		}

		return downloadedAttachments;
	}

	async downloadAttachments(
		email: string,
		attachments: Array<{ messageId: string; attachmentId: string; filename: string }>,
	): Promise<AttachmentDownloadResult[]> {
		const gmail = this.getGmailClient(email);
		const results: AttachmentDownloadResult[] = [];

		const attachmentDir = path.join(os.homedir(), ".gmail-cli", "attachments");
		if (!fs.existsSync(attachmentDir)) {
			fs.mkdirSync(attachmentDir, { recursive: true });
		}

		for (const attachment of attachments) {
			try {
				const shortAttachmentId = attachment.attachmentId.substring(0, 8);
				const filename = `${attachment.messageId}_${shortAttachmentId}_${attachment.filename}`;
				const filePath = path.join(attachmentDir, filename);

				if (fs.existsSync(filePath)) {
					const existingSize = fs.statSync(filePath).size;
					const attachmentInfo = await gmail.users.messages.attachments.get({
						userId: "me",
						messageId: attachment.messageId,
						id: attachment.attachmentId,
					});

					if (existingSize === attachmentInfo.data.size) {
						results.push({ success: true, filename: attachment.filename, path: filePath, cached: true });
						continue;
					}
				}

				const response = await gmail.users.messages.attachments.get({
					userId: "me",
					messageId: attachment.messageId,
					id: attachment.attachmentId,
				});

				const data = Buffer.from(response.data.data, "base64url");
				fs.writeFileSync(filePath, data);

				results.push({ success: true, filename: attachment.filename, path: filePath, cached: false });
			} catch (e) {
				results.push({
					success: false,
					filename: attachment.filename,
					error: e instanceof Error ? e.message : String(e),
				});
			}
		}

		return results;
	}

	async modifyLabels(
		email: string,
		threadIds: string[],
		addLabels: string[] = [],
		removeLabels: string[] = [],
	): Promise<LabelOperationResult[]> {
		const gmail = this.getGmailClient(email);
		const results: LabelOperationResult[] = [];

		for (const threadId of threadIds) {
			try {
				if (addLabels.length > 0) {
					await gmail.users.threads.modify({
						userId: "me",
						id: threadId,
						requestBody: { addLabelIds: addLabels },
					});
				}
				if (removeLabels.length > 0) {
					await gmail.users.threads.modify({
						userId: "me",
						id: threadId,
						requestBody: { removeLabelIds: removeLabels },
					});
				}
				results.push({ threadId, success: true });
			} catch (e) {
				results.push({ threadId, success: false, error: e instanceof Error ? e.message : String(e) });
			}
		}

		return results;
	}

	async listLabels(
		email: string,
	): Promise<Array<{ id: string; name: string; type: string; textColor?: string; backgroundColor?: string }>> {
		const gmail = this.getGmailClient(email);
		const response = await gmail.users.labels.list({ userId: "me" });
		return (response.data.labels || []).map((l: any) => ({
			id: l.id || "",
			name: l.name || "",
			type: l.type || "",
			textColor: l.color?.textColor,
			backgroundColor: l.color?.backgroundColor,
		}));
	}

	async getLabelMap(email: string): Promise<{ idToName: Map<string, string>; nameToId: Map<string, string> }> {
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
		const gmail = this.getGmailClient(email);
		const requestBody: any = {
			name,
			labelListVisibility: options.showInList === false ? "labelHide" : "labelShow",
			messageListVisibility: options.showInMessageList === false ? "hide" : "show",
		};

		if (options.textColor || options.backgroundColor) {
			if (options.textColor) validateLabelColor(options.textColor, "text");
			if (options.backgroundColor) validateLabelColor(options.backgroundColor, "background");
			requestBody.color = {};
			if (options.textColor) {
				requestBody.color.textColor = options.textColor.toLowerCase();
			}
			if (options.backgroundColor) {
				requestBody.color.backgroundColor = options.backgroundColor.toLowerCase();
			}
		}

		const response = await gmail.users.labels.create({
			userId: "me",
			requestBody,
		});
		return {
			id: response.data.id || "",
			name: response.data.name || "",
			type: response.data.type || "user",
			textColor: response.data.color?.textColor,
			backgroundColor: response.data.color?.backgroundColor,
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
		const gmail = this.getGmailClient(email);

		const current = await gmail.users.labels.get({ userId: "me", id: labelId });
		const currentColor = current.data.color;

		const requestBody: any = {
			name: options.name || current.data.name,
		};

		if (options.textColor || options.backgroundColor) {
			if (options.textColor) validateLabelColor(options.textColor, "text");
			if (options.backgroundColor) validateLabelColor(options.backgroundColor, "background");
			requestBody.color = {
				textColor: (options.textColor || currentColor?.textColor || "#000000").toLowerCase(),
				backgroundColor: (options.backgroundColor || currentColor?.backgroundColor || "#ffffff").toLowerCase(),
			};
		}

		const response = await gmail.users.labels.update({
			userId: "me",
			id: labelId,
			requestBody,
		});
		return {
			id: response.data.id || "",
			name: response.data.name || "",
			type: response.data.type || "user",
			textColor: response.data.color?.textColor,
			backgroundColor: response.data.color?.backgroundColor,
		};
	}

	async downloadMessageAttachments(email: string, messageId: string): Promise<DownloadedAttachment[]> {
		const gmail = this.getGmailClient(email);
		const response = await gmail.users.messages.get({ userId: "me", id: messageId });
		const message = response.data;

		const attachmentsToDownload: Array<{
			messageId: string;
			attachmentId: string;
			filename: string;
			size: number;
			mimeType: string;
		}> = [];

		const collectAttachments = (payload: any) => {
			if (payload?.parts) {
				for (const part of payload.parts) {
					if (part.body?.attachmentId && part.filename) {
						attachmentsToDownload.push({
							messageId,
							attachmentId: part.body.attachmentId,
							filename: part.filename,
							size: part.body.size || 0,
							mimeType: part.mimeType || "application/octet-stream",
						});
					}
					collectAttachments(part);
				}
			}
		};
		collectAttachments(message.payload);

		const downloadResults = await this.downloadAttachments(
			email,
			attachmentsToDownload.map((att) => ({
				messageId: att.messageId,
				attachmentId: att.attachmentId,
				filename: att.filename,
			})),
		);

		const downloadedAttachments: DownloadedAttachment[] = [];
		for (let i = 0; i < attachmentsToDownload.length; i++) {
			const attachment = attachmentsToDownload[i];
			const result = downloadResults[i];
			if (result.success && result.path) {
				downloadedAttachments.push({
					messageId: attachment.messageId,
					filename: attachment.filename,
					path: result.path,
					size: attachment.size,
					mimeType: attachment.mimeType,
					cached: result.cached || false,
				});
			}
		}

		return downloadedAttachments;
	}

	private getHeaderValue(message: GmailMessage, headerName: string): string | undefined {
		const header = message.payload?.headers?.find((h) => h.name?.toLowerCase() === headerName.toLowerCase());
		return header?.value || undefined;
	}
}
