import { NextRequest } from "next/server";
import { dbQuery } from "@/lib/server/db";
import { ApiError } from "@/lib/server/http/errors";

export interface AuthenticatedUser {
  id: string;
  email: string | null;
}

function extractBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const cookieToken = req.cookies.get("sb-access-token")?.value;
  if (cookieToken) return cookieToken;
  return null;
}

export async function verifySupabaseToken(
  token: string,
): Promise<AuthenticatedUser | null> {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:54321";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";

  try {
    const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { id?: string; email?: string };
    if (!data || typeof data.id !== "string" || !data.id) {
      return null;
    }
    return {
      id: data.id,
      email: data.email || null,
    };
  } catch (err) {
    console.error("[auth] Failed to verify Supabase user token", err);
    return null;
  }
}

export async function getOptionalUser(
  req: NextRequest,
): Promise<AuthenticatedUser | null> {
  const token = extractBearerToken(req);
  if (!token) return null;
  return verifySupabaseToken(token);
}

export async function requireAuthenticatedUser(
  req: NextRequest,
): Promise<AuthenticatedUser> {
  const user = await getOptionalUser(req);
  if (!user) {
    throw new ApiError(401, "UNAUTHORIZED", "ログインが必要です。");
  }
  return user;
}

export async function ensureUserRow(userId: string): Promise<{
  userId: string;
  plan: "free" | "pro";
  createdAt: string;
  isNewUser: boolean;
}> {
  const insertRes = await dbQuery<{
    user_id: string;
    plan: "free" | "pro";
    created_at: Date;
  }>(
    `
    INSERT INTO users (user_id)
    VALUES ($1::uuid)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING user_id, plan, created_at
    `,
    [userId],
  );

  if (insertRes.rows.length > 0) {
    const row = insertRes.rows[0];
    return {
      userId: row.user_id,
      plan: row.plan,
      createdAt: new Date(row.created_at).toISOString(),
      isNewUser: true,
    };
  }

  const selectRes = await dbQuery<{
    user_id: string;
    plan: "free" | "pro";
    created_at: Date;
  }>(
    `
    SELECT user_id, plan, created_at
    FROM users
    WHERE user_id = $1::uuid
    `,
    [userId],
  );

  if (selectRes.rows.length === 0) {
    throw new ApiError(500, "INTERNAL_ERROR", "ユーザー情報の取得に失敗しました。");
  }
  const row = selectRes.rows[0];
  return {
    userId: row.user_id,
    plan: row.plan,
    createdAt: new Date(row.created_at).toISOString(),
    isNewUser: false,
  };
}

export async function deleteSupabaseAuthUser(userId: string): Promise<void> {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:54321";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!serviceRoleKey) {
    return;
  }
  const res = await fetch(
    `${supabaseUrl.replace(/\/$/, "")}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
      },
    },
  );
  if (!res.ok && res.status !== 404) {
    throw new ApiError(
      502,
      "AUTH_PROVIDER_ERROR",
      "認証基盤からのアカウント削除に失敗しました。",
    );
  }
}
