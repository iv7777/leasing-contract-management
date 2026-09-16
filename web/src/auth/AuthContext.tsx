import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Locale, PublicUser } from "@lcm/shared";
import { api, ApiError } from "../api/client";
import { useTranslation } from "react-i18next";

function detectBrowserLocale(): "en" | "zh" {
  const lang = (navigator.language || "en").toLowerCase();
  return lang.startsWith("zh") ? "zh" : "en";
}

interface AuthState {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setLocale: (locale: Locale) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const { i18n } = useTranslation();

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ user: PublicUser }>("/auth/me");
      setUser(res.user);
      // "auto" means this user has no forced preference — leave whatever
      // the language detector already picked (cached choice, else browser).
      if (res.user.preferredLocale && res.user.preferredLocale !== "auto") {
        void i18n.changeLanguage(res.user.preferredLocale);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [i18n]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      await api.post("/auth/login", { email, password });
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await api.post("/auth/logout");
    setUser(null);
  }, []);

  const setLocale = useCallback(
    async (locale: Locale) => {
      await api.patch("/auth/me/locale", { preferredLocale: locale });
      setUser((prev) => (prev ? { ...prev, preferredLocale: locale } : prev));
      if (locale === "auto") {
        try {
          localStorage.removeItem("i18nextLng");
        } catch {
          // private browsing / storage blocked — fine, just skip the cache clear
        }
        void i18n.changeLanguage(detectBrowserLocale());
      } else {
        void i18n.changeLanguage(locale);
      }
    },
    [i18n],
  );

  return <AuthContext.Provider value={{ user, loading, login, logout, setLocale }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { ApiError };
