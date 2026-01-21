# @smcllns/gmail

A minimal Gmail CLI with restricted permissions so Claude Code and other agents can autonomously read and organize your inbox.

```bash
bunx @smcllns/gmail search "in:inbox is:unread" --max 10
```

## Why use this?

This is a fork of the excellent [@mariozechner/gmcli](https://github.com/badlogic/gmcli). The original requests full Gmail permissions (`mail.google.com`), and I wanted to restrict capabilities to prevent agents from accidentally sending or deleting email. The intent is to let agents run autonomously to understand and manage the inbox, while requiring a human to make any one-way door decisions.

1. **Restricted OAuth scopes** - The original uses `mail.google.com` (full access). This fork requests only:
   - `gmail.modify` - to read messages, threads, and change labels
   - `gmail.labels` - to create and edit labels

2. **Dangerous operations blocked in CLI** - Even where OAuth scopes allow, the CLI blocks:
   - `send` and `delete` commands are disabled
   - Disabled commands return guidance directing users to the Gmail web interface

3. **Simplified for agent usage**:
   - Renamed binary from `gmcli` to `gmail`
   - Default account config so commands don't require email prefix
   - Usage: `bunx @smcllns/gmail <command>` or `npx @smcllns/gmail <command>`

### Comparison

| Feature | @mariozechner/gmcli (original) | @smcllns/gmail (this fork) |
| --- | --- | --- |
| Gmail permissions | Full access | Read and organize mail (no send/delete) |
| OAuth scopes | `mail.google.com` | `gmail.modify`, `gmail.labels` |
| Read email | ✅ Yes | ✅ Yes |
| Send email | ✅ Yes | ❌ No |
| Delete email | ✅ Yes | ❌ No |
| Manage labels | ❌ No | ✅ Yes |
| Shell command | `gmcli` | `gmail` |
| Set default account | ❌ No | ✅ Yes |

## Install

```bash
npm install -g @smcllns/gmail
```

Or run directly without global install:

```bash
npx @smcllns/gmail <command>
```

## Quickstart

After [setup](#setup-one-time), search your inbox:

```bash
gmail search "in:inbox is:unread" --max 10
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
gmail search --label Label_123              # filter by label ID (from 'labels list')
gmail search "is:unread" --label INBOX      # combine query with label filter
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
gmail labels create "Urgent" --text "#ffffff" --bg "#fb4c2f"  # with colors
gmail labels edit "My Label" --name "Renamed" --bg "#16a765"
gmail labels <threadId> --add Receipts --remove INBOX  # add label "Receipts" and archive thread
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

  gmail search [query] [--max N] [--page TOKEN] [--label L]
      Search threads. Query uses Gmail syntax, --label filters by name or ID.
      Returns: thread ID, date, sender, subject, labels.

  gmail thread <threadId> [--download]
      Get full thread. --download saves attachments.

  gmail labels list
      List all labels with ID, name, type, and colors.

  gmail labels create <name> [--text HEX] [--bg HEX]
      Create a new label with optional colors.

  gmail labels edit <label> [--name <newName>] [--text HEX] [--bg HEX]
      Edit a label's name and/or colors.

  gmail labels <threadIds...> [--add L] [--remove L]
      Modify labels on threads.
      System labels: INBOX, UNREAD, STARRED, IMPORTANT, TRASH, SPAM

  gmail url <threadIds...>
      Generate Gmail web URLs for threads.

RESTRICTED (returns guidance to use Gmail web UI)

  gmail send
  gmail delete

DATA STORAGE

  ~/.gmail-cli/credentials.json   OAuth client credentials
  ~/.gmail-cli/accounts.json      Account tokens
  ~/.gmail-cli/config.json        CLI configuration
  ~/.gmail-cli/attachments/       Downloaded attachments
```

## Programmatic Usage

### GmailService

```typescript
import { GmailService } from '@smcllns/gmail';

const gmail = new GmailService();
const thread = await gmail.getThread('you@gmail.com', 'threadId123');
```

Note: `getThread()` normalizes Google API responses, converting `null` values to `undefined`.

### MockGmailService

A mock implementation for testing code that depends on GmailService:

```typescript
import { MockGmailService } from '@smcllns/gmail/testing';

const mock = new MockGmailService();

// Configure test data
mock.setThread('thread123', { id: 'thread123', historyId: '1', messages: [] });
mock.setSearchResults('in:inbox', { threads: [] });
mock.setLabels([{ id: 'Label_1', name: 'Work', type: 'user' }]);

// Simulate errors
mock.setError('getThread', new Error('API Error'));
mock.setError('searchThreads', new Error('Rate limited'), true); // once only

// Inspect calls after test
expect(mock.calls.searchThreads).toHaveLength(1);
expect(mock.calls.searchThreads[0].args[1]).toBe('in:inbox');

// Reset between tests
mock.reset();
```

## License

MIT
