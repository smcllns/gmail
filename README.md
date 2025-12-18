# @smcllns/gmail

A fork of [@mariozechner/gmcli](https://github.com/badlogic/gmcli) designed for use with Claude Code and other AI coding agents.

## Why This Fork?

The original gmcli is excellent but requests full Gmail access (`mail.google.com` scope). This fork:

1. **Narrows OAuth scopes** for safer agent usage:
   - `gmail.readonly` - Read messages, threads, settings
   - `gmail.labels` - Create, update, delete labels
   - `gmail.compose` - Create drafts (no direct send permission)

2. **Restricts dangerous operations** in the CLI:
   - `send`, `drafts send`, `drafts delete` are blocked
   - Returns guidance directing users to the Gmail web interface
   - Drafts can be created for human review before sending

3. **Simplifies CLI for agent usage**:
   - Renamed binary from `gmcli` to `gmail`
   - Default account config so commands don't require email prefix
   - Usage: `bunx @smcllns/gmail <command>` or `npx @smcllns/gmail <command>`

## Installation

```bash
npm install -g @smcllns/gmail
```

Or use directly with bunx/npx:

```bash
bunx @smcllns/gmail <command>
```

## Setup

### 1. Create OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the Gmail API
4. Go to "APIs & Services" → "Credentials"
5. Create "OAuth client ID" → "Desktop app"
6. Download the credentials JSON file

### 2. Configure the CLI

```bash
# Set credentials (once per machine)
gmail accounts credentials ~/Downloads/credentials.json

# Add your Gmail account
gmail accounts add you@gmail.com

# The first account is automatically set as default
# Or set manually:
gmail config default you@gmail.com
```

## Usage

```
gmail - Gmail CLI for Claude Code agents

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

RESTRICTED OPERATIONS

  gmail send            - Returns guidance to use Gmail web interface
  gmail drafts send     - Returns guidance to use Gmail web interface
  gmail drafts delete   - Returns guidance to use Gmail web interface

EXAMPLES

  gmail search "in:inbox is:unread"
  gmail search "from:boss@company.com" --max 50
  gmail thread 19aea1f2f3532db5
  gmail thread 19aea1f2f3532db5 --download
  gmail labels list
  gmail labels abc123 --add Work --remove UNREAD
  gmail url 19aea1f2f3532db5

DATA STORAGE

  ~/.gmail-cli/credentials.json   OAuth client credentials
  ~/.gmail-cli/accounts.json      Account tokens
  ~/.gmail-cli/config.json        CLI configuration (default account)
  ~/.gmail-cli/attachments/       Downloaded attachments
```

## Key Differences from Upstream

| Feature | @mariozechner/gmcli | @smcllns/gmail |
|---------|---------------------|----------------|
| OAuth scopes | Full access (`mail.google.com`) | Read-only + labels + compose |
| Send email | ✅ Supported | ❌ Blocked (returns guidance) |
| Create drafts | ✅ Supported | ✅ Supported |
| Send drafts | ✅ Supported | ❌ Blocked |
| Delete drafts | ✅ Supported | ❌ Blocked |
| Binary name | `gmcli` | `gmail` |
| Default account | Not supported | ✅ `gmail config default` |
| Data directory | `~/.gmcli/` | `~/.gmail-cli/` |

## License

MIT
