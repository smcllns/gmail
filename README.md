# @smcllns/gmail

A minimal Gmail CLI with restricted permissions so Claude Code and other agents can autonomously read and organize your inbox.

```bash
bunx @smcllns/gmail search "in:inbox is:unread" --max 10
```

## Why use this?

This is a fork of the excellent [@mariozechner/gmcli](https://github.com/badlogic/gmcli). The original requests full Gmail permissions (read, send, delete, etc). This version limits the capabilities of the CLI tool so I'm comfortable letting agents run autonomously to understand and manage my email, but requires a human to make any one-way door decisions like sending or deleting email.

1. **Narrows OAuth scopes** for safer agent usage:
   - `gmail.readonly` - Read messages, threads, settings
   - `gmail.labels` - Create, edit, and manage labels
   - `gmail.compose` - Create drafts (sending and deleting blocked)

2. **Restricts dangerous operations** in the CLI:
   - `send`, `delete`, `drafts send`, `drafts delete` are blocked
   - Returns guidance directing users to the Gmail web interface
   - Drafts can be created for human review before sending

3. **Simplifies CLI for agent usage**:
   - Renamed binary from `gmcli` to `gmail`
   - Default account config so commands don't require email prefix
   - Usage: `bunx @smcllns/gmail <command>` or `npx @smcllns/gmail <command>`

### Comparison

| Feature | @mariozechner/gmcli (original) | @smcllns/gmail (this fork) |
| --- | --- | --- |
| Gmail permissions | Full access | Read-only + manage labels + create drafts |
| OAuth scopes | `mail.google.com` | `gmail.readonly`, `gmail.labels`, `gmail.compose` |
| Read email | ✅ Yes | ✅ Yes |
| Create drafts | ✅ Yes | ✅ Yes |
| Send email/drafts | ✅ Yes | ❌ No |
| Delete email/drafts | ✅ Yes | ❌ No |
| Create/edit labels | ❌ No | ✅ Yes |
| Delete labels | ❌ No | ❌ No |
| Shell command | `gmcli` | `gmail` |
| Set default account | ❌ No | ✅ Yes |

## Install

```bash
npm install -g @smcllns/gmail
```

Or run directly:

```bash
npx @smcllns/gmail <command>
```

## Quickstart

After [setup](#setup-one-time), search your inbox:

```bash
gmail search "in:inbox is:unread"
```
```
19aea1f2f35...  Dec 20  alice@example.com   "Re: Project update"   [INBOX, UNREAD]
19aea1f3a21...  Dec 19  notifications@...   "Your weekly digest"   [INBOX, UNREAD]
```

Read a thread:

```bash
gmail thread 19aea1f2f35
```

Create a draft for review:

```bash
gmail drafts create --to="bob@example.com" --subject="Quick question" --body="Hey, are we still on for Tuesday?"
```

Open in Gmail to review and send:

```bash
gmail url 19aea1f2f35
```

## Setup (one-time)

### 1. Create OAuth credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the Gmail API
4. Go to "APIs & Services" → "Credentials"
5. Create "OAuth client ID" → "Desktop app"
6. Download the credentials JSON file

### 2. Configure the CLI

```bash
# Config saved in ~/.gmail-cli/

# Set up OAuth Client credentials (once per machine)
gmail accounts credentials ~/path/to/credentials.json

# Add your Gmail account (opens google sign-in in browser to auth)
gmail accounts add you@gmail.com

# Or use --manual for headless/server environments
gmail accounts add you@gmail.com --manual
```

## Usage

### Search

Uses [Gmail search syntax](https://support.google.com/mail/answer/7190):

```bash
gmail search "in:inbox"
gmail search "from:boss@company.com is:unread"
gmail search "has:attachment filename:pdf after:2024/01/01"
gmail search "label:Work subject:urgent" --max 50
```

### Read threads

```bash
gmail thread <threadId>
gmail thread <threadId> --download  # saves attachments to ~/.gmail-cli/attachments/
```

### Manage labels

```bash
gmail labels list
gmail labels create "My Label"
gmail labels <threadId> --add Receipts --remove INBOX # add label "Receipts" and archive thread
```

### Create drafts

```bash
gmail drafts create \
  --to="recipient@example.com" \
  --subject="Subject line" \
  --body="Email body" \
  --cc="cc@example.com" \
  --attach="./report.pdf"
```

### Get Gmail URLs to view messages in browser

```bash
gmail url <threadId>
```

## Full command reference

```
USAGE

  gmail accounts <action>              Account management
  gmail config <action>                Configuration management
  gmail <command> [options]            Gmail operations (uses default account)
  gmail --account <email> <command>    Gmail operations with specific account

ACCOUNT COMMANDS

  gmail accounts credentials <file>    Set OAuth credentials (once)
  gmail accounts list                  List configured accounts
  gmail accounts add <email>           Add account (--manual for browserless OAuth)
  gmail accounts remove <email>        Remove account

CONFIG COMMANDS

  gmail config default <email>         Set default account
  gmail config show                    Show current configuration

GMAIL COMMANDS

  gmail search <query> [--max N] [--page TOKEN]
      Search threads. Returns: thread ID, date, sender, subject, labels.

  gmail thread <threadId> [--download]
      Get full thread. --download saves attachments.

  gmail labels list
      List all labels with ID, name, and type.

  gmail labels create <name>
      Create a new label.

  gmail labels edit <label> --name <newName>
      Rename a label.

  gmail labels <threadIds...> [--add L] [--remove L]
      Modify labels on threads.
      System labels: INBOX, UNREAD, STARRED, IMPORTANT, TRASH, SPAM

  gmail drafts list
      List all drafts.

  gmail drafts get <draftId> [--download]
      View draft with attachments.

  gmail drafts create --to=<email> --subject=<s> --body=<b> [options]
      Create draft. Options: --cc, --bcc, --thread, --reply-to, --attach

  gmail url <threadIds...>
      Generate Gmail web URLs for threads.

RESTRICTED (returns guidance to use Gmail web UI)

  gmail send
  gmail delete
  gmail drafts send
  gmail drafts delete

DATA STORAGE

  ~/.gmail-cli/credentials.json   OAuth client credentials
  ~/.gmail-cli/accounts.json      Account tokens
  ~/.gmail-cli/config.json        CLI configuration
  ~/.gmail-cli/attachments/       Downloaded attachments
```

## How to use with Claude Code

Here's an abbreviated example of how I use this with Claude Code:

### 1. Create a `gmail` skill

Show Claude how to use the CLI (independent of your specific preferences). The full content is similar to this README. Abbreviated:

```yaml
# .claude/skills/gmail/SKILL.md
---
name: gmail
description: Fetches and manages Gmail using @smcllns/gmail. Use when the user asks about their email, wants an email summary, or needs to search/read/archive messages.
allowed-tools: Bash(bunx @smcllns/gmail:*)
---
# ...

# Fetch first 25 unread messages in inbox
bunx @smcllns/gmail search "in:inbox is:unread" --max 25

# ...
```

### 2. Create an `/email` command

This contains all my subjective instructions and preferences for how to organize my inbox and what I want done. An abbreviated version:

```yaml
# .claude/commands/email.md
---
description: Read recent emails, organize into categories and write email reports to Obsidian
allowed-tools: Skill(gmail)
---
You are an executive assistant. Your task is to process email so it is efficient to review and take action.

Every email gets exactly one category

| Category | What belongs here |
|----------|-------------------|
| ⚠️ **Action** | Decision needed or response required |
| 📅 **Calendar** | Appointments, RSVPs, event reminders |
| 📦 **Packages** | Shipping, returns, food delivery |

What to elevate to my inbox for attention (everything else skips inbox)
- ...
```

## License

MIT
