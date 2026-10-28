import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export class ClientApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export async function getAccessToken(): Promise<string | null> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    return data.session?.access_token || null;
  } catch {
    return null;
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  let json: {
    status?: string;
    data?: T;
    error?: { code?: string; message?: string; [k: string]: unknown };
  };
  try {
    json = await res.json();
  } catch {
    throw new ClientApiError(
      res.status,
      "NETWORK_ERROR",
      "サーバーからの応答を読み取れませんでした。",
    );
  }

  if (!res.ok || json.status === "error") {
    const errObj = json.error || {};
    throw new ClientApiError(
      res.status,
      errObj.code || "API_ERROR",
      errObj.message || "リクエストの処理に失敗しました。",
      errObj,
    );
  }

  return json.data as T;
}
