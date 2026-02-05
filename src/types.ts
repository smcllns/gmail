export interface EmailAccount {
	email: string;
	scopes?: string[];
	oauth2: {
		clientId: string;
		clientSecret: string;
		refreshToken: string;
		accessToken?: string;
	};
}
