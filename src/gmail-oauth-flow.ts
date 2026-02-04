import * as crypto from "crypto";
import { spawn } from "child_process";
import * as http from "http";
import type { AddressInfo } from "net";
import * as readline from "readline";
import * as url from "url";
import { OAuth2Client } from "google-auth-library";

export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
export const GMAIL_LABELS_SCOPE = "https://www.googleapis.com/auth/gmail.labels";
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const DEFAULT_GMAIL_SCOPES = [
	GMAIL_MODIFY_SCOPE, // Read messages, threads, add and remove labels
	GMAIL_LABELS_SCOPE, // Create and edit labels
];
export const READONLY_GMAIL_SCOPES = [GMAIL_READONLY_SCOPE];
const TIMEOUT_MS = 2 * 60 * 1000;

interface AuthResult {
	success: boolean;
	refreshToken?: string;
	error?: string;
}

export type GmailOAuthOptions = {
	scopes?: string[];
	includeGrantedScopes?: boolean;
	prompt?: "consent" | "select_account" | "none";
};

export class GmailOAuthFlow {
	private oauth2Client: OAuth2Client;
	private server: http.Server | null = null;
	private timeoutId: NodeJS.Timeout | null = null;
	private scopes: string[];
	private includeGrantedScopes: boolean;
	private prompt?: "consent" | "select_account" | "none";
	private expectedState: string | null = null;
	private codeVerifier: string | null = null;

	constructor(clientId: string, clientSecret: string, options?: GmailOAuthOptions) {
		this.oauth2Client = new OAuth2Client(clientId, clientSecret);
		this.scopes = options?.scopes ?? DEFAULT_GMAIL_SCOPES;
		this.includeGrantedScopes = options?.includeGrantedScopes ?? false;
		this.prompt = options?.prompt;
	}

	async authorize(manual = false): Promise<string> {
		const result = manual ? await this.startManualFlow() : await this.startAuthFlow();
		if (!result.success) {
			throw new Error(result.error || "Authorization failed");
		}
		if (!result.refreshToken) {
			throw new Error("No refresh token received");
		}
		return result.refreshToken;
	}

	private async startManualFlow(): Promise<AuthResult> {
		const redirectUri = "http://localhost:1";
		this.oauth2Client = new OAuth2Client(this.oauth2Client._clientId, this.oauth2Client._clientSecret, redirectUri);

		const authUrl = this.generateAuthUrl();

		console.log("Visit this URL to authorize:");
		console.log(authUrl);
		console.log("");
		console.log("After authorizing, you'll be redirected to a page that won't load.");
		console.log("Copy the URL from your browser's address bar and paste it here.");
		console.log("");

		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

		return new Promise((resolve) => {
			rl.question("Paste redirect URL: ", async (input) => {
				rl.close();
				try {
					const parsed = url.parse(input, true);
					const code = parsed.query.code as string;
					if (!code) {
						resolve({ success: false, error: "No authorization code found in URL" });
						return;
					}
					if (!this.isValidState(parsed.query.state as string | undefined)) {
						resolve({ success: false, error: "OAuth state mismatch" });
						return;
					}
					if (!this.codeVerifier) {
						resolve({ success: false, error: "Missing PKCE verifier" });
						return;
					}
					const { tokens } = await this.oauth2Client.getToken({
						code,
						codeVerifier: this.codeVerifier,
					} as any);
					resolve({ success: true, refreshToken: tokens.refresh_token || undefined });
				} catch (e) {
					resolve({ success: false, error: e instanceof Error ? e.message : String(e) });
				}
			});
		});
	}

	private startAuthFlow(): Promise<AuthResult> {
		return new Promise((resolve) => {
			this.server = http.createServer((req, res) => {
				const parsed = url.parse(req.url!, true);
				if (parsed.pathname === "/") {
					this.handleCallback(parsed.query, res, resolve);
				} else {
					res.writeHead(404);
					res.end();
				}
			});

			this.server.listen(0, "localhost", () => {
				const port = (this.server!.address() as AddressInfo).port;
				const redirectUri = `http://localhost:${port}`;

				this.oauth2Client = new OAuth2Client(
					this.oauth2Client._clientId,
					this.oauth2Client._clientSecret,
					redirectUri,
				);

				const authUrl = this.generateAuthUrl();

				console.log("Opening browser for Gmail authorization...");
				console.log("If browser doesn't open, visit this URL:");
				console.log(authUrl);
				this.openBrowser(authUrl);

				this.timeoutId = setTimeout(() => {
					console.log("Authorization timed out after 2 minutes");
					this.cleanup();
					resolve({ success: false, error: "Authorization timed out" });
				}, TIMEOUT_MS);
			});

			this.server.on("error", (err) => {
				this.cleanup();
				resolve({ success: false, error: err.message });
			});
		});
	}

	private async handleCallback(
		query: any,
		res: http.ServerResponse,
		resolve: (result: AuthResult) => void,
	): Promise<void> {
		if (query.error) {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end("<html><body><h1>Authorization cancelled</h1></body></html>");
			this.cleanup();
			resolve({ success: false, error: query.error });
			return;
		}

		if (!query.code) {
			res.writeHead(400, { "Content-Type": "text/html" });
			res.end("<html><body><h1>No authorization code</h1></body></html>");
			this.cleanup();
			resolve({ success: false, error: "No authorization code" });
			return;
		}

		if (!this.isValidState(query.state as string | undefined)) {
			res.writeHead(400, { "Content-Type": "text/html" });
			res.end("<html><body><h1>Invalid OAuth state</h1></body></html>");
			this.cleanup();
			resolve({ success: false, error: "OAuth state mismatch" });
			return;
		}

		if (!this.codeVerifier) {
			res.writeHead(500, { "Content-Type": "text/html" });
			res.end("<html><body><h1>Missing PKCE verifier</h1></body></html>");
			this.cleanup();
			resolve({ success: false, error: "Missing PKCE verifier" });
			return;
		}

		try {
			const { tokens } = await this.oauth2Client.getToken({
				code: query.code as string,
				codeVerifier: this.codeVerifier,
			} as any);
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end("<html><body><h1>Success!</h1><p>You can close this window.</p></body></html>");
			this.cleanup();
			resolve({ success: true, refreshToken: tokens.refresh_token || undefined });
		} catch (e) {
			res.writeHead(500, { "Content-Type": "text/html" });
			res.end(`<html><body><h1>Error</h1><p>${e instanceof Error ? e.message : e}</p></body></html>`);
			this.cleanup();
			resolve({ success: false, error: e instanceof Error ? e.message : String(e) });
		}
	}

	private cleanup(): void {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}
		if (this.server) {
			this.server.close();
			this.server = null;
		}
		this.expectedState = null;
		this.codeVerifier = null;
	}

	private generateAuthUrl(): string {
		this.expectedState = crypto.randomBytes(16).toString("hex");
		this.codeVerifier = this.base64Url(crypto.randomBytes(32));
		const codeChallenge = this.base64Url(
			crypto.createHash("sha256").update(this.codeVerifier).digest(),
		);
		return this.oauth2Client.generateAuthUrl({
			access_type: "offline",
			scope: this.scopes,
			state: this.expectedState,
			include_granted_scopes: this.includeGrantedScopes,
			code_challenge: codeChallenge,
			code_challenge_method: "S256",
			...(this.prompt ? { prompt: this.prompt } : {}),
		});
	}

	private isValidState(state: string | undefined): boolean {
		return Boolean(state && this.expectedState && state === this.expectedState);
	}

	private base64Url(buffer: Buffer): string {
		return buffer
			.toString("base64")
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
	}

	private openBrowser(url: string): void {
		const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
		spawn(cmd, [url], { detached: true, stdio: "ignore" });
	}
}
