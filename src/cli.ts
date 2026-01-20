#!/usr/bin/env node

import * as fs from "fs";
import { parseArgs } from "util";
import { GmailService, EnhancedThread } from "./gmail-service.js";

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
      --download saves attachments to ~/.gmail-cli/attachments/

  gmail labels list
      List all labels with ID, name, type, and colors.

  gmail labels create <name> [--text HEX] [--bg HEX]
      Create a new label with optional colors.
      Colors must be hex codes from Gmail's palette (e.g., #000000, #434343).

  gmail labels edit <label> [--name <newName>] [--text HEX] [--bg HEX]
      Edit a label's name and/or colors. Accepts label name or ID.
      Colors must be hex codes from Gmail's palette.

  gmail labels <threadIds...> [--add L] [--remove L]
      Modify labels on threads (comma-separated for multiple).
      Accepts label names or IDs (names are case-insensitive).
      System labels: INBOX, UNREAD, STARRED, IMPORTANT, TRASH, SPAM

  gmail url <threadIds...>
      Generate Gmail web URLs for threads.
      Uses canonical URL format with email parameter.

RESTRICTED OPERATIONS (will return guidance instead of executing)

  gmail send             - Not permitted: sending requires human review
  gmail delete           - Not permitted: deletion requires human confirmation

EXAMPLES

  gmail config default you@gmail.com
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
			const from = msg?.from?.replace(/\t/g, " ") || "";
			const subject = msg?.subject?.replace(/\t/g, " ") || "(no subject)";
			// Aggregate labels from all messages in thread to match Gmail web behavior
			const allLabelIds = new Set<string>();
			for (const m of t.messages) {
				for (const labelId of m.labelIds || []) {
					allLabelIds.add(labelId);
				}
			}
			const labels = [...allLabelIds].map((id) => idToName.get(id) || id).join(",");
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
		const thread = result as EnhancedThread;
		for (const msg of thread.messages || []) {
			console.log(`Message-ID: ${msg.id}`);
			console.log(`From: ${msg.parsed.headers.from || ""}`);
			console.log(`To: ${msg.parsed.headers.to || ""}`);
			console.log(`Date: ${msg.parsed.headers.date || ""}`);
			console.log(`Subject: ${msg.parsed.headers.subject || ""}`);
			console.log("");
			console.log(msg.parsed.body);
			console.log("");
			if (msg.parsed.attachments.length > 0) {
				console.log("Attachments:");
				for (const att of msg.parsed.attachments) {
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

async function handleLabels(account: string, args: string[]) {
	const { values, positionals } = parseArgs({
		args,
		options: {
			add: { type: "string", short: "a" },
			remove: { type: "string", short: "r" },
			name: { type: "string", short: "n" },
			text: { type: "string" },
			bg: { type: "string" },
		},
		allowPositionals: true,
	});

	if (positionals.length === 0) {
		error("Usage: gmail labels list | create <name> | edit <label> --name <new> | <threadIds...> [--add L] [--remove L]");
	}

	// labels list
	if (positionals[0] === "list") {
		const labels = await service.listLabels(account);
		console.log("ID\tNAME\tTYPE\tTEXT_COLOR\tBG_COLOR");
		for (const l of labels) {
			console.log(`${l.id}\t${l.name}\t${l.type}\t${l.textColor || ""}\t${l.backgroundColor || ""}`);
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
		let output = `Created label: ${label.name} (${label.id})`;
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
		let output = `Updated label: ${label.name} (${label.id})`;
		if (label.textColor || label.backgroundColor) {
			output += ` [text: ${label.textColor || "default"}, bg: ${label.backgroundColor || "default"}]`;
		}
		console.log(output);
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
		const url = `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${id}`;
		console.log(`${id}\t${url}`);
	}
}

main();
