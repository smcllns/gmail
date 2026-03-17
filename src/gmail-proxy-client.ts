/**
 * Drop-in replacement for the googleapis Gmail client that routes
 * requests through a Gmail security proxy (unix socket or TCP).
 *
 * Matches the subset of the googleapis API shape used by GmailService.
 * This is intentionally duck-typed to avoid coupling to googleapis types —
 * the proxy client is a standalone module with no googleapis dependency.
 */

const API_BASE = "/gmail/v1/users/me";

type QueryParams = Record<string, string | number | string[] | undefined>;

interface ProxyFetchOptions {
  method?: string;
  body?: Record<string, unknown>;
  query?: QueryParams;
}

interface GmailApiError extends Error {
  code: number;
  response: { status: number; data: string };
}

function buildFetchOptions(proxyPath: string): { baseUrl: string; unix?: string } {
  if (proxyPath.startsWith("/") || proxyPath.startsWith("./")) {
    return { baseUrl: `http://localhost${API_BASE}`, unix: proxyPath };
  }
  const host = proxyPath.includes("://") ? proxyPath : `http://${proxyPath}`;
  return { baseUrl: `${host}${API_BASE}` };
}

async function proxyFetch(
  proxyPath: string,
  path: string,
  options: ProxyFetchOptions = {},
): Promise<{ data: unknown }> {
  const { baseUrl, unix } = buildFetchOptions(proxyPath);

  let url = `${baseUrl}${path}`;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) params.append(k, item);
      } else {
        params.set(k, String(v));
      }
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (options.body) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const fetchInit: RequestInit & { unix?: string } = {
    method: options.method || "GET",
    headers,
    body,
  };
  if (unix) fetchInit.unix = unix;

  const res = await fetch(url, fetchInit as RequestInit);

  if (!res.ok) {
    const text = await res.text();
    const error = new Error(`Gmail API error ${res.status}: ${text}`) as GmailApiError;
    error.code = res.status;
    error.response = { status: res.status, data: text };
    throw error;
  }

  return { data: await res.json() };
}

export function createProxyGmailClient(proxyPath: string) {
  const pf = (path: string, opts?: ProxyFetchOptions) => proxyFetch(proxyPath, path, opts);

  return {
    users: {
      threads: {
        list: (params: { userId: string; q?: string; maxResults?: number; pageToken?: string; labelIds?: string[] }) =>
          pf("/threads", {
            query: {
              q: params.q,
              maxResults: params.maxResults,
              pageToken: params.pageToken,
              labelIds: params.labelIds,
            },
          }),

        get: (params: { userId: string; id: string }) =>
          pf(`/threads/${params.id}`),

        modify: (params: { userId: string; id: string; requestBody: Record<string, unknown> }) =>
          pf(`/threads/${params.id}/modify`, {
            method: "POST",
            body: params.requestBody,
          }),
      },

      messages: {
        get: (params: { userId: string; id: string }) =>
          pf(`/messages/${params.id}`),

        attachments: {
          get: (params: { userId: string; messageId: string; id: string }) =>
            pf(`/messages/${params.messageId}/attachments/${params.id}`),
        },
      },

      labels: {
        list: (_params: { userId: string }) =>
          pf("/labels"),

        get: (params: { userId: string; id: string }) =>
          pf(`/labels/${params.id}`),

        create: (params: { userId: string; requestBody: Record<string, unknown> }) =>
          pf("/labels", { method: "POST", body: params.requestBody }),

        update: (params: { userId: string; id: string; requestBody: Record<string, unknown> }) =>
          pf(`/labels/${params.id}`, { method: "PUT", body: params.requestBody }),
      },

      drafts: {
        create: (params: { userId: string; requestBody: Record<string, unknown> }) =>
          pf("/drafts", { method: "POST", body: params.requestBody }),
      },
    },
  };
}
