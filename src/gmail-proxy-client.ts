/**
 * Drop-in replacement for the googleapis Gmail client that routes
 * requests through a Gmail security proxy (unix socket or TCP).
 *
 * Matches the subset of the googleapis API shape used by GmailService.
 */

const API_BASE = "/gmail/v1/users/me";

type FetchOptions = { unix?: string };

function buildFetchOptions(proxyPath: string): { baseUrl: string; fetchOpts: FetchOptions } {
  if (proxyPath.startsWith("/") || proxyPath.startsWith("./")) {
    // Unix socket path
    return {
      baseUrl: `http://localhost${API_BASE}`,
      fetchOpts: { unix: proxyPath },
    };
  }
  // TCP host:port
  const host = proxyPath.includes("://") ? proxyPath : `http://${proxyPath}`;
  return {
    baseUrl: `${host}${API_BASE}`,
    fetchOpts: {},
  };
}

async function proxyFetch(
  proxyPath: string,
  path: string,
  options: { method?: string; body?: any; query?: Record<string, any> } = {},
): Promise<any> {
  const { baseUrl, fetchOpts } = buildFetchOptions(proxyPath);

  // Build query string
  let url = `${baseUrl}${path}`;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== null) {
        if (Array.isArray(v)) {
          for (const item of v) params.append(k, String(item));
        } else {
          params.set(k, String(v));
        }
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

  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body,
    ...fetchOpts,
  } as any);

  if (!res.ok) {
    const text = await res.text();
    const error = new Error(`Gmail API error ${res.status}: ${text}`) as any;
    error.code = res.status;
    error.response = { status: res.status, data: text };
    throw error;
  }

  return { data: await res.json() };
}

export function createProxyGmailClient(proxyPath: string) {
  const pf = (path: string, opts?: any) => proxyFetch(proxyPath, path, opts);

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

        modify: (params: { userId: string; id: string; requestBody: any }) =>
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
        list: (params: { userId: string }) =>
          pf("/labels"),

        get: (params: { userId: string; id: string }) =>
          pf(`/labels/${params.id}`),

        create: (params: { userId: string; requestBody: any }) =>
          pf("/labels", { method: "POST", body: params.requestBody }),

        update: (params: { userId: string; id: string; requestBody: any }) =>
          pf(`/labels/${params.id}`, { method: "PUT", body: params.requestBody }),
      },

      drafts: {
        create: (params: { userId: string; requestBody: any }) =>
          pf("/drafts", { method: "POST", body: params.requestBody }),
      },
    },
  };
}
