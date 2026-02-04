# @smcllns/gmail

A minimal Gmail CLI with restricted permissions so Claude Code and other agents can autonomously read and organize your inbox.

```bash
bunx @smcllns/gmail search "in:inbox is:unread" --max 10
```

## Why use this?

This is a fork of the excellent [@mariozechner/gmcli](https://github.com/badlogic/gmcli). The original requests full Gmail permissions (`mail.google.com`), and I wanted to restrict capabilities to prevent agents from accidentally sending or deleting email. The intent is to let agents run autonomously to understand and manage the inbox, while requiring a human to make any one-way door decisions.

1. **Restricted OAuth scopes** - The original uses `mail.google.com` (full access). This fork requests only:
   - `gmail.modify` (restricted) - required to add/remove labels and archive
   - `gmail.labels` - to create and edit labels
   - Optional dry-run mode uses `gmail.readonly` for read-only access

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
| OAuth scopes | `mail.google.com` | `gmail.modify`, `gmail.labels` (live) / `gmail.readonly` (dry-run) |
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
# Set up OAuth Client credentials (once per machine)
gmail accounts credentials ~/path/to/credentials.json

# Add your Gmail account (opens google sign-in in browser to auth)
gmail accounts add you@gmail.com

# Or use --manual for headless/server environments
gmail accounts add you@gmail.com --manual

# Dry-run (read-only) mode
gmail accounts add you@gmail.com --readonly

# Upgrade to live mode (label changes)
gmail accounts upgrade you@gmail.com
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
gmail labels <threadId> --add TRASH --allow-dangerous-labels  # requires explicit override
```

### Get Gmail URLs to view messages in browser

```bash
gmail url <threadId>
```

## Custom config directory

By default, credentials, accounts, and attachments are stored in `~/.gmail-cli/`. Use `--config-dir` to store them in a project-local directory instead:

```bash
# All commands use the custom directory for that invocation
gmail --config-dir ./.gmail accounts credentials ~/creds.json
gmail --config-dir ./.gmail accounts add you@gmail.com
gmail --config-dir ./.gmail search "in:inbox"
```

Programmatic usage:

```typescript
const gmail = new GmailService({ configDir: './.gmail' });
```

Relative paths are resolved to absolute. The directory is created automatically on first use.

## Full command reference

```
USAGE

  gmail accounts <action>              Account management
  gmail config <action>                Configuration management
  gmail <command> [options]            Gmail operations (uses default account)
  gmail --account <email> <command>    Gmail operations with specific account
  gmail --config-dir <path> <command>  Use custom config directory (default: ~/.gmail-cli/)

ACCOUNT COMMANDS

  gmail accounts credentials <file>    Set OAuth credentials (once)
  gmail accounts list                  List configured accounts
  gmail accounts add <email>           Add account (--manual for browserless OAuth)
  gmail accounts add <email> --readonly  Add account in read-only mode (dry-run)
  gmail accounts upgrade <email>       Upgrade to live access (modify labels)
  gmail accounts remove <email>        Remove account

CONFIG COMMANDS

  gmail config default <email>         Set default account
  gmail config show                    Show current configuration

GMAIL COMMANDS

  gmail search [query] [--max N] [--page TOKEN] [--label L]
      Search threads. Query uses Gmail syntax, --label filters by name or ID.
      Returns: thread ID, date, sender, subject, labels.

  gmail thread <threadId> [--download]
      Get full thread. --download saves attachments to <config-dir>/attachments/.

  gmail labels list
      List all labels with ID, name, type, and colors.

  gmail labels create <name> [--text HEX] [--bg HEX]
      Create a new label with optional colors.

  gmail labels edit <label> [--name <newName>] [--text HEX] [--bg HEX]
      Edit a label's name and/or colors.

  gmail labels <threadIds...> [--add L] [--remove L] [--allow-dangerous-labels]
      Modify labels on threads.
      System labels: INBOX, UNREAD, STARRED, IMPORTANT, TRASH, SPAM
      Adding TRASH or SPAM is blocked unless --allow-dangerous-labels is set.

  gmail url <threadIds...>
      Generate Gmail web URLs for threads.

RESTRICTED (returns guidance to use Gmail web UI)

  gmail send
  gmail delete

DATA STORAGE (default: ~/.gmail-cli/, override with --config-dir)

  <config-dir>/credentials.json   OAuth client credentials
  <config-dir>/accounts.json      Account tokens
  <config-dir>/config.json        CLI configuration
  <config-dir>/attachments/       Downloaded attachments
```

## Programmatic Usage

### GmailService

```typescript
import { GmailService } from '@smcllns/gmail';

const gmail = new GmailService();
const thread = await gmail.getThread('you@gmail.com', 'threadId123');
```

#### Programmatic OAuth tokens

Provide tokens directly without filesystem access — useful for web apps, serverless functions, and multi-tenant servers:

```typescript
import { GmailService, type EmailAccount } from '@smcllns/gmail';

// Pass accounts at construction
const gmail = new GmailService({
  accounts: [{
    email: 'user@gmail.com',
    oauth2: { clientId, clientSecret, refreshToken, accessToken },
  }],
});

// Or add/update tokens after construction
gmail.setAccountTokens({
  email: 'user@gmail.com',
  oauth2: { clientId, clientSecret, refreshToken, accessToken },
});

// Then use normally
const threads = await gmail.searchThreads('user@gmail.com', 'in:inbox', 50);
```

When only using in-memory accounts, `GmailService` never touches the filesystem (`~/.gmail-cli/`).

Note: `getThread()` normalizes Google API responses, converting `null` values to `undefined`.

#### Available methods

| Method | Description |
| --- | --- |
| `searchThreads(email, query, maxResults?, pageToken?, labelIds?)` | Search threads using [Gmail query syntax](https://support.google.com/mail/answer/7190) |
| `getThread(email, threadId, downloadAttachments?)` | Get full thread with parsed message content |
| `modifyLabels(email, threadIds, addLabels?, removeLabels?)` | Add/remove labels on threads |
| `listLabels(email)` | List all labels with IDs, names, types, and colors |
| `createLabel(email, name, options?)` | Create a label with optional colors |
| `updateLabel(email, labelId, options?)` | Update a label's name or colors |
| `getLabelMap(email)` | Get bidirectional label name/ID lookup maps |
| `downloadMessageAttachments(email, messageId)` | Download all attachments from a message |
| `setAccountTokens(account)` | Add or update account tokens in memory |
| `listAccounts()` | List all configured accounts |
| `deleteAccount(email)` | Remove an account |

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
