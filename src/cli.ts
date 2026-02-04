#!/usr/bin/env node

import * as fs from "fs";
import { parseArgs } from "util";
import {
	DEFAULT_GMAIL_SCOPES,
	EnhancedThread,
	GMAIL_MODIFY_SCOPE,
	GMAIL_READONLY_SCOPE,
	GmailService,
	READONLY_GMAIL_SCOPES,
} from "./gmail-service.js";

let service!: GmailService;

const DANGEROUS_LABELS = new Set(["TRASH", "SPAM"]);
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

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
  gmail --config-dir <path> <command>  Use custom config directory (default: ~/.gmail-cli/)

ACCOUNT COMMANDS

  gmail accounts credentials <file.json>           Set OAuth credentials (once)
  gmail accounts list                              List configured accounts
  gmail accounts add <email> [--manual] [--readonly]  Add account (--readonly for dry-run)
  gmail accounts upgrade <email> [--manual]        Upgrade to live access (modify labels)
  gmail accounts remove <email>                    Remove account

CONFIG COMMANDS

  gmail config default <email>         Set default account for all commands
  gmail config show                    Show current configuration

GMAIL COMMANDS

  gmail search [query] [--max N] [--page TOKEN] [--label L]
  gmail list [query] [--max N] [--page TOKEN] [--label L]
      Search threads. Query uses Gmail syntax, --label filters by name or ID.
      Returns: thread ID, date, sender, subject, labels.

      Examples:
        gmail search in:inbox is:unread
        gmail search "from:boss@company.com" --max 50
        gmail search --label INBOX                    (by label only)
        gmail search --label Label_123 -l IMPORTANT   (multiple labels)
        gmail search "newer_than:7d" --label Label_123

  gmail thread <threadId> [--download]
      Get thread with all messages.
      Shows: Message-ID, headers, body, attachments.
      --download saves attachments to <config-dir>/attachments/

  gmail labels list
      List all labels with ID, name, type, and colors.

  gmail labels create <name> [--text HEX] [--bg HEX]
      Create a new label with optional colors.
      Colors must be hex codes from Gmail's palette (e.g., #000000, #434343).

  gmail labels edit <label> [--name <newName>] [--text HEX] [--bg HEX]
      Edit a label's name and/or colors. Accepts label name or ID.
      Colors must be hex codes from Gmail's palette.

  gmail labels <threadIds...> [--add L] [--remove L] [--allow-dangerous-labels]
      Modify labels on threads (comma-separated for multiple).
      Accepts label names or IDs (names are case-insensitive).
      System labels: INBOX, UNREAD, STARRED, IMPORTANT, TRASH, SPAM
      Adding TRASH or SPAM is blocked unless --allow-dangerous-labels is set.

  gmail url <threadIds...>
      Generate Gmail web URLs for threads.
      Uses canonical URL format with email parameter.

RESTRICTED OPERATIONS (will return guidance instead of executing)

  gmail send             - Not permitted: sending requires human review
  gmail delete           - Not permitted: deletion requires human confirmation

EXAMPLES

  gmail config default you@gmail.com
  gmail accounts add you@gmail.com --readonly
  gmail accounts upgrade you@gmail.com
  gmail search "in:inbox is:unread"
  gmail search "from:boss@company.com" --max 50
  gmail thread 19aea1f2f3532db5
  gmail thread 19aea1f2f3532db5 --download
  gmail labels list
  gmail labels create "My Label"
  gmail labels create "Urgent" --text "#ffffff" --bg "#fb4c2f"
  gmail labels edit "My Label" --name "Renamed Label"
  gmail labels edit "My Label" --bg "#16a765"
  gmail labels abc123 --add Work --remove UNREAD
  gmail url 19aea1f2f3532db5 19aea1f2f3532db6

DATA STORAGE (default: ~/.gmail-cli/, override with --config-dir)

  <config-dir>/credentials.json   OAuth client credentials
  <config-dir>/accounts.json      Account tokens
  <config-dir>/config.json        CLI configuration (default account)
  <config-dir>/attachments/       Downloaded attachments`);
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

	// Extract --config-dir before creating service
	let configDir: string | undefined;
	const configDirIndex = args.indexOf("--config-dir");
	if (configDirIndex !== -1) {
		configDir = args[configDirIndex + 1];
		if (!configDir) error("--config-dir requires a path argument");
		args.splice(configDirIndex, 2);
	}

	service = new GmailService(configDir ? { configDir } : undefined);

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
			case "list":
				await handleSearch(account, commandArgs);
				break;
			case "thread":
				await handleThread(account, commandArgs);
				break;
			case "labels":
				await handleLabels(account, commandArgs);
				break;
			case "send":
				handleRestrictedSend();
			case "delete":
				handleRestrictedDelete();
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
	if (!action) error("Missing action: list|add|upgrade|remove|credentials");

	switch (action) {
		case "list": {
			const accounts = service.listAccounts();
			const defaultAccount = service.getDefaultAccount();
			if (accounts.length === 0) {
				console.log("No accounts configured");
			} else {
				for (const a of accounts) {
					const isDefault = a.email === defaultAccount ? " (default)" : "";
					const scopeLabel = describeAccountScopes(a.scopes);
					const email = sanitizeSingleLine(a.email);
					console.log(`${email}${scopeLabel}${isDefault}`);
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
			const readonly = args.includes("--readonly");
			const filtered = args.slice(1).filter((a) => a !== "--manual" && a !== "--readonly");
			const email = filtered[0];
			if (!email) error("Usage: gmail accounts add <email> [--manual] [--readonly]");
			const creds = service.getCredentials();
			if (!creds) error("No credentials configured. Run: gmail accounts credentials <credentials.json>");
			const scopes = readonly ? READONLY_GMAIL_SCOPES : DEFAULT_GMAIL_SCOPES;
			await service.addGmailAccount(email, creds.clientId, creds.clientSecret, manual, {
				scopes,
				includeGrantedScopes: false,
			});
			console.log(`Account '${email}' added${readonly ? " (readonly)" : ""}`);

			// Set as default if it's the first account
			const accounts = service.listAccounts();
			if (accounts.length === 1) {
				service.setDefaultAccount(email);
				console.log(`Set as default account`);
			}
			break;
		}
		case "upgrade": {
			const manual = args.includes("--manual");
			const filtered = args.slice(1).filter((a) => a !== "--manual");
			const email = filtered[0];
			if (!email) error("Usage: gmail accounts upgrade <email> [--manual]");
			const creds = service.getCredentials();
			if (!creds) error("No credentials configured. Run: gmail accounts credentials <credentials.json>");
			const accounts = service.listAccounts();
			const exists = accounts.some((a) => a.email === email);
			if (!exists) {
				error(`Account '${email}' not found. Add it first with: gmail accounts add ${email}`);
			}
			await service.updateGmailAccount(email, creds.clientId, creds.clientSecret, manual, {
				scopes: DEFAULT_GMAIL_SCOPES,
				includeGrantedScopes: false,
				prompt: "consent",
			});
			console.log(`Account '${email}' upgraded to live access`);
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
			query: { type: "string", short: "q" },
			label: { type: "string", short: "l", multiple: true },
		},
		allowPositionals: true,
	});

	const query = values.query || positionals.join(" ");
	const labelArgs = values.label || [];
	if (!query && labelArgs.length === 0) error("Usage: gmail search <query> [--label LABEL]");

	// Resolve label names to IDs
	let labelIds: string[] = [];
	if (labelArgs.length > 0) {
		const { nameToId } = await service.getLabelMap(account);
		labelIds = labelArgs.map((l) => nameToId.get(l.toLowerCase()) || l);
	}

	const results = await service.searchThreads(account, query, Number(values.max) || 10, values.page, labelIds);
	const { idToName } = await service.getLabelMap(account);

	if (results.threads.length === 0) {
		console.log("No results");
	} else {
		console.log("ID\tDATE\tFROM\tSUBJECT\tLABELS");
		for (const t of results.threads) {
			const msg = t.messages[0];
			const date = msg?.date ? new Date(msg.date).toISOString().slice(0, 16).replace("T", " ") : "";
			const from = sanitizeSingleLine(msg?.from || "");
			const subject = sanitizeSingleLine(msg?.subject || "(no subject)");
			// Aggregate labels from all messages in thread to match Gmail web behavior
			const allLabelIds = new Set<string>();
			for (const m of t.messages) {
				for (const labelId of m.labelIds || []) {
					allLabelIds.add(labelId);
				}
			}
			const labels = [...allLabelIds]
				.map((id) => idToName.get(id) || id)
				.map((label) => sanitizeSingleLine(label))
				.join(",");
			console.log(`${sanitizeSingleLine(t.id)}\t${date}\t${from}\t${subject}\t${labels}`);
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
				const filename = sanitizeSingleLine(a.filename || "");
				const filePath = sanitizeSingleLine(a.path || "");
				console.log(`${filename}\t${filePath}\t${a.size}`);
			}
		}
	} else {
		const thread = result as EnhancedThread;
		for (const msg of thread.messages || []) {
			console.log(`Message-ID: ${sanitizeSingleLine(msg.id || "")}`);
			console.log(`From: ${sanitizeSingleLine(msg.parsed.headers.from || "")}`);
			console.log(`To: ${sanitizeSingleLine(msg.parsed.headers.to || "")}`);
			console.log(`Date: ${sanitizeSingleLine(msg.parsed.headers.date || "")}`);
			console.log(`Subject: ${sanitizeSingleLine(msg.parsed.headers.subject || "")}`);
			console.log("");
			console.log(sanitizeForTerminal(msg.parsed.body));
			console.log("");
			if (msg.parsed.attachments.length > 0) {
				console.log("Attachments:");
				for (const att of msg.parsed.attachments) {
					const filename = sanitizeSingleLine(att.filename);
					const mimeType = sanitizeSingleLine(att.mimeType);
					console.log(`  - ${filename} (${formatSize(att.size)}, ${mimeType})`);
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

function sanitizeForTerminal(value: string): string {
	return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(CONTROL_CHARS, "");
}

function sanitizeSingleLine(value: string): string {
	return sanitizeForTerminal(value).replace(/\n+/g, " ").replace(/\t/g, " ").trim();
}

function describeAccountScopes(scopes?: string[]): string {
	if (!scopes || scopes.length === 0) return " (unknown)";
	const hasModify = scopes.includes(GMAIL_MODIFY_SCOPE);
	const hasReadonly = scopes.includes(GMAIL_READONLY_SCOPE);
	if (hasReadonly && !hasModify) return " (readonly)";
	if (hasModify) return " (live)";
	return " (limited)";
}

async function handleLabels(account: string, args: string[]) {
	const { values, positionals } = parseArgs({
		args,
		options: {
			add: { type: "string", short: "a" },
			remove: { type: "string", short: "r" },
			name: { type: "string", short: "n" },
			text: { type: "string" },
			bg: { type: "string" },
			"allow-dangerous-labels": { type: "boolean" },
		},
		allowPositionals: true,
	});

	const allowDangerous = Boolean(values["allow-dangerous-labels"]);

	if (positionals.length === 0) {
		error(
			"Usage: gmail labels list | create <name> | edit <label> --name <new> | <threadIds...> [--add L] [--remove L] [--allow-dangerous-labels]",
		);
	}

	// labels list
	if (positionals[0] === "list") {
		const labels = await service.listLabels(account);
		console.log("ID\tNAME\tTYPE\tTEXT_COLOR\tBG_COLOR");
		for (const l of labels) {
			const id = sanitizeSingleLine(l.id);
			const name = sanitizeSingleLine(l.name);
			const type = sanitizeSingleLine(l.type);
			const textColor = sanitizeSingleLine(l.textColor || "");
			const backgroundColor = sanitizeSingleLine(l.backgroundColor || "");
			console.log(`${id}\t${name}\t${type}\t${textColor}\t${backgroundColor}`);
		}
		return;
	}

	// labels create <name>
	if (positionals[0] === "create") {
		const name = positionals[1];
		if (!name) error("Usage: gmail labels create <name> [--text HEX] [--bg HEX]");
		const label = await service.createLabel(account, name, {
			textColor: values.text,
			backgroundColor: values.bg,
		});
		const labelName = sanitizeSingleLine(label.name);
		const labelId = sanitizeSingleLine(label.id);
		let output = `Created label: ${labelName} (${labelId})`;
		if (label.textColor || label.backgroundColor) {
			output += ` [text: ${label.textColor || "default"}, bg: ${label.backgroundColor || "default"}]`;
		}
		console.log(output);
		return;
	}

	// labels edit <label> --name <newName> [--text HEX] [--bg HEX]
	if (positionals[0] === "edit") {
		const labelArg = positionals[1];
		if (!labelArg) error("Usage: gmail labels edit <label> [--name <newName>] [--text HEX] [--bg HEX]");
		if (!values.name && !values.text && !values.bg) {
			error("At least one of --name, --text, or --bg is required");
		}

		const { nameToId } = await service.getLabelMap(account);
		const labelId = nameToId.get(labelArg.toLowerCase()) || labelArg;

		const label = await service.updateLabel(account, labelId, {
			name: values.name,
			textColor: values.text,
			backgroundColor: values.bg,
		});
		const labelName = sanitizeSingleLine(label.name);
		const labelIdOutput = sanitizeSingleLine(label.id);
		let output = `Updated label: ${labelName} (${labelIdOutput})`;
		if (label.textColor || label.backgroundColor) {
			output += ` [text: ${label.textColor || "default"}, bg: ${label.backgroundColor || "default"}]`;
		}
		console.log(output);
		return;
	}

	// labels <threadIds...> [--add] [--remove]
	const threadIds = positionals;

	const { nameToId, idToName } = await service.getLabelMap(account);

	if (values.add && !allowDangerous) {
		const requested = values.add.split(",").map((label) => label.trim()).filter(Boolean);
		const dangerous = requested.filter((label) => DANGEROUS_LABELS.has(label.toUpperCase()));
		if (dangerous.length > 0) {
			error(
				`Refusing to add label(s): ${dangerous.join(", ")}
Use --allow-dangerous-labels to override.`,
			);
		}
	}

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
		const threadId = sanitizeSingleLine(r.threadId);
		const result = r.success ? "ok" : sanitizeSingleLine(r.error || "error");
		console.log(`${threadId}: ${result}`);
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

function handleRestrictedDelete(): never {
	throw new RestrictedOperationError(
		"Deleting emails is not permitted via this CLI.",
		`This CLI is configured for read-only email access with label management only.

To delete emails:
1. Open Gmail directly in your browser
2. Select the emails to delete
3. Delete them manually after confirmation

This restriction prevents accidental data loss.`,
	);
}

function handleUrl(account: string, args: string[]) {
	if (args.length === 0) {
		error("Usage: gmail url <threadIds...>");
	}

	for (const id of args) {
		const safeId = sanitizeSingleLine(id);
		const encodedId = encodeURIComponent(safeId);
		const url = `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${encodedId}`;
		console.log(`${safeId}\t${url}`);
	}
}

main();
