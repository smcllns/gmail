#!/usr/bin/env node

import * as fs from "fs";
import { parseArgs } from "util";
import { GmailService } from "./gmail-service.js";

const service = new GmailService();

// Custom error class for restricted operations
class RestrictedOperationError extends Error {
	constructor(operation: string, guidance: string) {
		super(`RESTRICTED: ${operation}\n\n${guidance}`);
		this.name = "RestrictedOperationError";
	}
}

function usage(): never {
	console.log(`gmail - Gmail CLI for Claude Code agents

USAGE

  gmail accounts <action>              Account management
  gmail config <action>                Configuration management
  gmail <command> [options]            Gmail operations (uses default account)
  gmail --account <email> <command>    Gmail operations with specific account

ACCOUNT COMMANDS

  gmail accounts credentials <file.json>    Set OAuth credentials (once)
  gmail accounts list                       List configured accounts
  gmail accounts add <email> [--manual]     Add account (--manual for browserless OAuth)
  gmail accounts remove <email>             Remove account

CONFIG COMMANDS

  gmail config default <email>         Set default account for all commands
  gmail config show                    Show current configuration

GMAIL COMMANDS

  gmail search <query> [--max N] [--page TOKEN]
      Search threads using Gmail query syntax.
      Returns: thread ID, date, sender, subject, labels.

      Query examples:
        in:inbox, in:sent, in:drafts, in:trash
        is:unread, is:starred, is:important
        from:sender@example.com, to:recipient@example.com
        subject:keyword, has:attachment, filename:pdf
        after:2024/01/01, before:2024/12/31
        label:Work, label:UNREAD
        Combine: "in:inbox is:unread from:boss@company.com"

  gmail thread <threadId> [--download]
      Get thread with all messages.
      Shows: Message-ID, headers, body, attachments.
      --download saves attachments to ~/.gmail-cli/attachments/

  gmail labels list
      List all labels with ID, name, and type.

  gmail labels create <name>
      Create a new label.

  gmail labels edit <label> --name <newName>
      Rename a label. Accepts label name or ID.

  gmail labels <threadIds...> [--add L] [--remove L]
      Modify labels on threads (comma-separated for multiple).
      Accepts label names or IDs (names are case-insensitive).
      System labels: INBOX, UNREAD, STARRED, IMPORTANT, TRASH, SPAM

  gmail drafts list
      List all drafts. Returns: draft ID, message ID.

  gmail drafts get <draftId> [--download]
      View draft with attachments.
      --download saves attachments to ~/.gmail-cli/attachments/

  gmail drafts create --to=<email> --subject=<subject> --body=<body> [options]
      Create a new draft email.
      --to          Recipient email (required, comma-separated for multiple)
      --subject     Email subject (required)
      --body        Email body text (required)
      --cc          CC recipients (optional, comma-separated)
      --bcc         BCC recipients (optional, comma-separated)
      --thread      Thread ID to add draft to (optional)
      --reply-to    Message ID to reply to (optional)
      --attach      File paths to attach (optional, comma-separated)

  gmail url <threadIds...>
      Generate Gmail web URLs for threads.
      Uses canonical URL format with email parameter.

RESTRICTED OPERATIONS (will return guidance instead of executing)

  gmail drafts send      - Not permitted: sending requires human review
  gmail drafts delete    - Not permitted: deletion requires human confirmation
  gmail send             - Not permitted: sending requires human review

EXAMPLES

  gmail config default you@gmail.com
  gmail search "in:inbox is:unread"
  gmail search "from:boss@company.com" --max 50
  gmail thread 19aea1f2f3532db5
  gmail thread 19aea1f2f3532db5 --download
  gmail labels list
  gmail labels create "My Label"
  gmail labels edit "My Label" --name "Renamed Label"
  gmail labels abc123 --add Work --remove UNREAD
  gmail url 19aea1f2f3532db5 19aea1f2f3532db6

DATA STORAGE

  ~/.gmail-cli/credentials.json   OAuth client credentials
  ~/.gmail-cli/accounts.json      Account tokens
  ~/.gmail-cli/config.json        CLI configuration (default account)
  ~/.gmail-cli/attachments/       Downloaded attachments`);
	process.exit(1);
}

function error(msg: string): never {
	console.error("Error:", msg);
	process.exit(1);
}

function getAccount(args: string[]): { account: string; remainingArgs: string[] } {
	// Check for --account flag
	const accountIndex = args.indexOf("--account");
	if (accountIndex !== -1 && args[accountIndex + 1]) {
		const account = args[accountIndex + 1];
		const remainingArgs = [...args.slice(0, accountIndex), ...args.slice(accountIndex + 2)];
		return { account, remainingArgs };
	}

	// Use default account
	const defaultAccount = service.getDefaultAccount();
	if (!defaultAccount) {
		error("No default account configured. Run: gmail config default <email>");
	}
	return { account: defaultAccount, remainingArgs: args };
}

async function main() {
	const args = process.argv.slice(2);
	if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
		usage();
	}

	const first = args[0];
	const rest = args.slice(1);

	try {
		// Handle 'accounts' command separately (no email required)
		if (first === "accounts") {
			await handleAccounts(rest);
			return;
		}

		// Handle 'config' command
		if (first === "config") {
			await handleConfig(rest);
			return;
		}

		// All other commands use account resolution
		const { account, remainingArgs } = getAccount(args);
		const command = remainingArgs[0];
		const commandArgs = remainingArgs.slice(1);

		if (!command) {
			error("Missing command. Use --help for usage.");
		}

		switch (command) {
			case "search":
				await handleSearch(account, commandArgs);
				break;
			case "thread":
				await handleThread(account, commandArgs);
				break;
			case "labels":
				await handleLabels(account, commandArgs);
				break;
			case "drafts":
				await handleDrafts(account, commandArgs);
				break;
			case "send":
				handleRestrictedSend();
				break;
			case "url":
				handleUrl(account, commandArgs);
				break;
			default:
				error(`Unknown command: ${command}`);
		}
	} catch (e) {
		if (e instanceof RestrictedOperationError) {
			console.error(e.message);
			process.exit(2);
		}
		error(e instanceof Error ? e.message : String(e));
	}
}

async function handleConfig(args: string[]) {
	const action = args[0];
	if (!action) error("Missing action: default|show");

	switch (action) {
		case "default": {
			const email = args[1];
			if (!email) error("Usage: gmail config default <email>");
			// Verify the account exists
			const accounts = service.listAccounts();
			const exists = accounts.some((a) => a.email === email);
			if (!exists) {
				error(`Account '${email}' not found. Add it first with: gmail accounts add ${email}`);
			}
			service.setDefaultAccount(email);
			console.log(`Default account set to: ${email}`);
			break;
		}
		case "show": {
			const defaultAccount = service.getDefaultAccount();
			console.log("Configuration:");
			console.log(`  Default account: ${defaultAccount || "(not set)"}`);
			break;
		}
		default:
			error(`Unknown action: ${action}`);
	}
}

async function handleAccounts(args: string[]) {
	const action = args[0];
	if (!action) error("Missing action: list|add|remove|credentials");

	switch (action) {
		case "list": {
			const accounts = service.listAccounts();
			const defaultAccount = service.getDefaultAccount();
			if (accounts.length === 0) {
				console.log("No accounts configured");
			} else {
				for (const a of accounts) {
					const isDefault = a.email === defaultAccount ? " (default)" : "";
					console.log(`${a.email}${isDefault}`);
				}
			}
			break;
		}
		case "credentials": {
			const credFile = args[1];
			if (!credFile) error("Usage: gmail accounts credentials <credentials.json>");
			const creds = JSON.parse(fs.readFileSync(credFile, "utf8"));
			const installed = creds.installed || creds.web;
			if (!installed) error("Invalid credentials file");
			service.setCredentials(installed.client_id, installed.client_secret);
			console.log("Credentials saved");
			break;
		}
		case "add": {
			const manual = args.includes("--manual");
			const filtered = args.slice(1).filter((a) => a !== "--manual");
			const email = filtered[0];
			if (!email) error("Usage: gmail accounts add <email> [--manual]");
			const creds = service.getCredentials();
			if (!creds) error("No credentials configured. Run: gmail accounts credentials <credentials.json>");
			await service.addGmailAccount(email, creds.clientId, creds.clientSecret, manual);
			console.log(`Account '${email}' added`);

			// Set as default if it's the first account
			const accounts = service.listAccounts();
			if (accounts.length === 1) {
				service.setDefaultAccount(email);
				console.log(`Set as default account`);
			}
			break;
		}
		case "remove": {
			const email = args[1];
			if (!email) error("Usage: gmail accounts remove <email>");
			const wasDefault = service.getDefaultAccount() === email;
			const deleted = service.deleteAccount(email);
			if (deleted) {
				if (wasDefault) service.clearDefaultAccount();
				console.log(`Removed '${email}'${wasDefault ? " (was default)" : ""}`);
			} else {
				console.log(`Not found: ${email}`);
			}
			break;
		}
		default:
			error(`Unknown action: ${action}`);
	}
}

async function handleSearch(account: string, args: string[]) {
	const { values, positionals } = parseArgs({
		args,
		options: {
			max: { type: "string", short: "m" },
			page: { type: "string", short: "p" },
		},
		allowPositionals: true,
	});

	const query = positionals.join(" ");
	if (!query) error("Usage: gmail search <query>");

	const results = await service.searchThreads(account, query, Number(values.max) || 10, values.page);
	const { idToName } = await service.getLabelMap(account);

	if (results.threads.length === 0) {
		console.log("No results");
	} else {
		console.log("ID\tDATE\tFROM\tSUBJECT\tLABELS");
		for (const t of results.threads) {
			const msg = t.messages[0];
			const date = msg?.date ? new Date(msg.date).toISOString().slice(0, 16).replace("T", " ") : "";
			const from = msg?.from?.replace(/\t/g, " ") || "";
			const subject = msg?.subject?.replace(/\t/g, " ") || "(no subject)";
			const labels = msg?.labelIds?.map((id) => idToName.get(id) || id).join(",") || "";
			console.log(`${t.id}\t${date}\t${from}\t${subject}\t${labels}`);
		}
		if (results.nextPageToken) {
			console.log(`\n# Next page: --page ${results.nextPageToken}`);
		}
	}
}

async function handleThread(account: string, args: string[]) {
	const download = args.includes("--download");
	const filtered = args.filter((a) => a !== "--download");
	const threadId = filtered[0];

	if (!threadId) error("Usage: gmail thread <threadId>");

	const result = await service.getThread(account, threadId, download);

	if (download) {
		const attachments = result as any[];
		if (attachments.length === 0) {
			console.log("No attachments");
		} else {
			console.log("FILENAME\tPATH\tSIZE");
			for (const a of attachments) {
				console.log(`${a.filename}\t${a.path}\t${a.size}`);
			}
		}
	} else {
		const thread = result as any;
		for (const msg of thread.messages || []) {
			const headers = msg.payload?.headers || [];
			const getHeader = (name: string) =>
				headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
			console.log(`Message-ID: ${msg.id}`);
			console.log(`From: ${getHeader("from")}`);
			console.log(`To: ${getHeader("to")}`);
			console.log(`Date: ${getHeader("date")}`);
			console.log(`Subject: ${getHeader("subject")}`);
			console.log("");
			console.log(decodeBody(msg.payload));
			console.log("");
			const attachments = getAttachments(msg.payload);
			if (attachments.length > 0) {
				console.log("Attachments:");
				for (const att of attachments) {
					console.log(`  - ${att.filename} (${formatSize(att.size)}, ${att.mimeType})`);
				}
				console.log("");
			}
			console.log("---");
		}
	}
}

function formatSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function decodeBody(payload: any): string {
	if (!payload) return "";
	if (payload.body?.data) {
		return Buffer.from(payload.body.data, "base64url").toString();
	}
	if (payload.parts) {
		for (const part of payload.parts) {
			if (part.mimeType === "text/plain" && part.body?.data) {
				return Buffer.from(part.body.data, "base64url").toString();
			}
		}
		for (const part of payload.parts) {
			const nested = decodeBody(part);
			if (nested) return nested;
		}
	}
	return "";
}

interface AttachmentInfo {
	filename: string;
	size: number;
	mimeType: string;
}

function getAttachments(payload: any): AttachmentInfo[] {
	const attachments: AttachmentInfo[] = [];
	if (!payload?.parts) return attachments;
	for (const part of payload.parts) {
		if (part.filename && part.body?.attachmentId) {
			attachments.push({
				filename: part.filename,
				size: part.body.size || 0,
				mimeType: part.mimeType || "application/octet-stream",
			});
		}
		attachments.push(...getAttachments(part));
	}
	return attachments;
}

async function handleLabels(account: string, args: string[]) {
	const { values, positionals } = parseArgs({
		args,
		options: {
			add: { type: "string", short: "a" },
			remove: { type: "string", short: "r" },
			name: { type: "string", short: "n" },
		},
		allowPositionals: true,
	});

	if (positionals.length === 0) {
		error("Usage: gmail labels list | create <name> | edit <label> --name <new> | <threadIds...> [--add L] [--remove L]");
	}

	// labels list
	if (positionals[0] === "list") {
		const labels = await service.listLabels(account);
		console.log("ID\tNAME\tTYPE");
		for (const l of labels) {
			console.log(`${l.id}\t${l.name}\t${l.type}`);
		}
		return;
	}

	// labels create <name>
	if (positionals[0] === "create") {
		const name = positionals[1];
		if (!name) error("Usage: gmail labels create <name>");
		const label = await service.createLabel(account, name);
		console.log(`Created label: ${label.name} (${label.id})`);
		return;
	}

	// labels edit <label> --name <newName>
	if (positionals[0] === "edit") {
		const labelArg = positionals[1];
		if (!labelArg) error("Usage: gmail labels edit <label> --name <newName>");
		if (!values.name) error("--name is required for editing a label");

		const { nameToId } = await service.getLabelMap(account);
		const labelId = nameToId.get(labelArg.toLowerCase()) || labelArg;

		const label = await service.updateLabel(account, labelId, values.name);
		console.log(`Updated label: ${label.name} (${label.id})`);
		return;
	}

	// labels <threadIds...> [--add] [--remove]
	const threadIds = positionals;

	const { nameToId, idToName } = await service.getLabelMap(account);

	// Check if any labels to add don't exist and provide helpful error
	if (values.add) {
		const labelNames = values.add.split(",");
		const missing: string[] = [];
		for (const name of labelNames) {
			const id = nameToId.get(name.toLowerCase());
			if (!id && !idToName.has(name)) {
				missing.push(name);
			}
		}
		if (missing.length > 0) {
			error(
				`Label(s) not found: ${missing.join(", ")}\n` +
					`Create them first with: gmail labels create <name>\n` +
					`Or list existing labels with: gmail labels list`,
			);
		}
	}

	const addLabels = values.add ? service.resolveLabelIds(values.add.split(","), nameToId) : [];
	const removeLabels = values.remove ? service.resolveLabelIds(values.remove.split(","), nameToId) : [];

	const results = await service.modifyLabels(account, threadIds, addLabels, removeLabels);

	for (const r of results) {
		console.log(`${r.threadId}: ${r.success ? "ok" : r.error}`);
	}
}

// Restricted operation handlers with clear guidance
function handleRestrictedSend(): never {
	throw new RestrictedOperationError(
		"Sending emails is not permitted via this CLI.",
		`This CLI is configured for read-only email access with label management only.

To send an email, you should:
1. Open the thread in Gmail using: gmail url <threadId>
2. Compose and send the email manually in the Gmail web interface

This restriction ensures human review before any outbound communication.`,
	);
}

function handleRestrictedDraftSend(): never {
	throw new RestrictedOperationError(
		"Sending drafts is not permitted via this CLI.",
		`This CLI is configured for read-only email access with label management only.

To send a draft:
1. Open Gmail directly in your browser
2. Review the draft content
3. Send it manually after verification

This restriction ensures human review before any outbound communication.`,
	);
}

function handleRestrictedDraftDelete(): never {
	throw new RestrictedOperationError(
		"Deleting drafts is not permitted via this CLI.",
		`This CLI is configured for read-only email access with label management only.

To delete a draft:
1. Open Gmail directly in your browser
2. Navigate to Drafts
3. Delete the draft manually after confirmation

This restriction prevents accidental data loss.`,
	);
}

async function handleDrafts(account: string, args: string[]) {
	const action = args[0];
	const rest = args.slice(1);
	if (!action) error("Usage: gmail drafts <action>");

	switch (action) {
		case "list": {
			const drafts = await service.listDrafts(account);
			if (drafts.length === 0) {
				console.log("No drafts");
			} else {
				console.log("ID\tMESSAGE_ID");
				for (const d of drafts) {
					console.log(`${d.id}\t${d.message?.id || ""}`);
				}
			}
			break;
		}
		case "get": {
			const download = rest.includes("--download");
			const filtered = rest.filter((a) => a !== "--download");
			const draftId = filtered[0];
			if (!draftId) error("Usage: gmail drafts get <draftId> [--download]");
			const draft = await service.getDraft(account, draftId);
			const msg = draft.message;
			if (msg) {
				if (download) {
					const downloaded = await service.downloadMessageAttachments(account, msg.id!);
					if (downloaded.length === 0) {
						console.log("No attachments");
					} else {
						console.log("FILENAME\tPATH\tSIZE");
						for (const a of downloaded) {
							console.log(`${a.filename}\t${a.path}\t${a.size}`);
						}
					}
				} else {
					const headers = msg.payload?.headers || [];
					const getHeader = (name: string) =>
						headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
					console.log(`Draft-ID: ${draft.id}`);
					console.log(`To: ${getHeader("to")}`);
					console.log(`Cc: ${getHeader("cc")}`);
					console.log(`Subject: ${getHeader("subject")}`);
					console.log("");
					console.log(decodeBody(msg.payload));
					console.log("");
					const attachments = getAttachments(msg.payload);
					if (attachments.length > 0) {
						console.log("Attachments:");
						for (const att of attachments) {
							console.log(`  - ${att.filename} (${formatSize(att.size)}, ${att.mimeType})`);
						}
					}
				}
			}
			break;
		}
		case "delete":
			handleRestrictedDraftDelete();
			break;
		case "send":
			handleRestrictedDraftSend();
			break;
		case "create": {
			const { values: createValues } = parseArgs({
				args: rest,
				options: {
					to: { type: "string" },
					subject: { type: "string" },
					body: { type: "string" },
					cc: { type: "string" },
					bcc: { type: "string" },
					thread: { type: "string" },
					"reply-to": { type: "string" },
					attach: { type: "string" },
				},
				allowPositionals: true,
			});

			if (!createValues.to) error("--to is required");
			if (!createValues.subject) error("--subject is required");
			if (!createValues.body) error("--body is required");

			const toList = createValues.to.split(",").map((s) => s.trim());
			const ccList = createValues.cc?.split(",").map((s) => s.trim());
			const bccList = createValues.bcc?.split(",").map((s) => s.trim());
			const attachList = createValues.attach?.split(",").map((s) => s.trim());

			const draft = await service.createDraft(account, toList, createValues.subject, createValues.body, {
				cc: ccList,
				bcc: bccList,
				threadId: createValues.thread,
				replyToMessageId: createValues["reply-to"],
				attachments: attachList,
			});

			console.log(`Draft created: ${draft.id}`);
			break;
		}
		default:
			error(`Unknown action: ${action}`);
	}
}

function handleUrl(account: string, args: string[]) {
	if (args.length === 0) {
		error("Usage: gmail url <threadIds...>");
	}

	for (const id of args) {
		const url = `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${id}`;
		console.log(`${id}\t${url}`);
	}
}

main();
