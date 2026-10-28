"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api/client";

export interface AuthSessionUser {
  userId: string;
  email: string | null;
  plan: "free" | "pro";
  createdAt: string;
  subscription: {
    status: string;
    stripeSubscriptionId: string;
  } | null;
}

export function useAuthSession() {
  const [user, setUser] = useState<AuthSessionUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshProfile = useCallback(async () => {
    const sb = getSupabaseBrowserClient();
    if (!sb) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const { data } = await sb.auth.getSession();
      if (!data.session) {
        setUser(null);
        setIsLoading(false);
        return;
      }

      const me = await apiFetch<AuthSessionUser>("/api/me");
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProfile();
    const sb = getSupabaseBrowserClient();
    if (!sb) return;
    const { data: sub } = sb.auth.onAuthStateChange(() => {
      refreshProfile();
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, [refreshProfile]);

  const signOut = useCallback(async () => {
    const sb = getSupabaseBrowserClient();
    if (sb) {
      await sb.auth.signOut();
    }
    setUser(null);
  }, []);

  return {
    user,
    isAuthenticated: Boolean(user),
    isLoading,
    refreshProfile,
    signOut,
  };
}
