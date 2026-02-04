import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { EmailAccount } from "./types.js";

export const DEFAULT_CONFIG_DIR = path.join(os.homedir(), ".gmail-cli");

export class AccountStorage {
	readonly configDir: string;
	private readonly accountsFile: string;
	private readonly credentialsFile: string;
	private readonly configFile: string;
	private accounts: Map<string, EmailAccount> = new Map();

	constructor(configDir?: string) {
		this.configDir = configDir ?? DEFAULT_CONFIG_DIR;
		this.accountsFile = path.join(this.configDir, "accounts.json");
		this.credentialsFile = path.join(this.configDir, "credentials.json");
		this.configFile = path.join(this.configDir, "config.json");
		this.ensureConfigDir();
		this.loadAccounts();
	}

	private ensureConfigDir(): void {
		if (!fs.existsSync(this.configDir)) {
			fs.mkdirSync(this.configDir, { recursive: true });
		}
	}

	private loadAccounts(): void {
		if (fs.existsSync(this.accountsFile)) {
			try {
				const data = JSON.parse(fs.readFileSync(this.accountsFile, "utf8"));
				for (const account of data) {
					this.accounts.set(account.email, account);
				}
			} catch {
				// Ignore
			}
		}
	}

	private saveAccounts(): void {
		fs.writeFileSync(this.accountsFile, JSON.stringify(Array.from(this.accounts.values()), null, 2));
	}

	addAccount(account: EmailAccount): void {
		this.accounts.set(account.email, account);
		this.saveAccounts();
	}

	getAccount(email: string): EmailAccount | undefined {
		return this.accounts.get(email);
	}

	getAllAccounts(): EmailAccount[] {
		return Array.from(this.accounts.values());
	}

	deleteAccount(email: string): boolean {
		const deleted = this.accounts.delete(email);
		if (deleted) this.saveAccounts();
		return deleted;
	}

	hasAccount(email: string): boolean {
		return this.accounts.has(email);
	}

	setCredentials(clientId: string, clientSecret: string): void {
		fs.writeFileSync(this.credentialsFile, JSON.stringify({ clientId, clientSecret }, null, 2));
	}

	getCredentials(): { clientId: string; clientSecret: string } | null {
		if (!fs.existsSync(this.credentialsFile)) return null;
		try {
			return JSON.parse(fs.readFileSync(this.credentialsFile, "utf8"));
		} catch {
			return null;
		}
	}

	setDefaultAccount(email: string): void {
		const config = this.loadConfig();
		config.defaultAccount = email;
		fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2));
	}

	getDefaultAccount(): string | null {
		const config = this.loadConfig();
		return config.defaultAccount || null;
	}

	clearDefaultAccount(): void {
		const config = this.loadConfig();
		delete config.defaultAccount;
		fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2));
	}

	private loadConfig(): { defaultAccount?: string } {
		if (!fs.existsSync(this.configFile)) return {};
		try {
			return JSON.parse(fs.readFileSync(this.configFile, "utf8"));
		} catch {
			return {};
		}
	}
}
