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
			fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
		}
	}

	private loadAccounts(): void {
		if (fs.existsSync(this.accountsFile)) {
			try {
				const data = JSON.parse(fs.readFileSync(this.accountsFile, "utf8"));
				if (!Array.isArray(data)) {
					throw new Error("Invalid accounts file format");
				}
				for (const account of data) {
					this.accounts.set(account.email, account);
				}
			} catch {
				throw new Error(`Failed to parse accounts file: ${this.accountsFile}`);
			}
		}
	}

	private saveAccounts(): void {
		this.writeJsonFileAtomic(this.accountsFile, Array.from(this.accounts.values()));
	}

	private writeJsonFileAtomic(filePath: string, data: unknown): void {
		const dir = path.dirname(filePath);
		const tempPath = path.join(dir, `.tmp-${path.basename(filePath)}-${process.pid}-${Date.now()}`);
		fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), { mode: 0o600 });
		fs.renameSync(tempPath, filePath);
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
		this.writeJsonFileAtomic(this.credentialsFile, { clientId, clientSecret });
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
		this.writeJsonFileAtomic(this.configFile, config);
	}

	getDefaultAccount(): string | null {
		const config = this.loadConfig();
		return config.defaultAccount || null;
	}

	clearDefaultAccount(): void {
		const config = this.loadConfig();
		delete config.defaultAccount;
		this.writeJsonFileAtomic(this.configFile, config);
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
