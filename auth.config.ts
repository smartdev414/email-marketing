import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Scopes we ask Google for, matching what is configured on the OAuth consent
 * screen. `gmail.modify` covers both sending and reading the mailbox, so it is
 * the only Gmail scope needed: sending campaign mail, reading threads back to
 * detect replies, and spotting mailer-daemon bounce notices.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/gmail.modify",
].join(" ");

/**
 * Several Gmail scopes can grant the same capability, and Google rewrites the
 * granted scope string (`email` becomes `userinfo.email`, and so on). So check
 * what a grant lets us *do* rather than matching strings exactly.
 */
export function gmailCapabilities(scope: string | null | undefined) {
  const granted = new Set((scope ?? "").split(/\s+/).filter(Boolean));
  const has = (name: string) => granted.has(`https://www.googleapis.com/auth/${name}`);
  const fullMailbox = granted.has("https://mail.google.com/");

  return {
    canSend: fullMailbox || has("gmail.send") || has("gmail.compose") || has("gmail.modify"),
    canRead: fullMailbox || has("gmail.readonly") || has("gmail.modify"),
  };
}

function isEmailAllowed(email: string | null | undefined) {
  if (!email) return false;

  const allowedEmails = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const allowedDomain = (process.env.ALLOWED_EMAIL_DOMAIN ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");

  // No allowlist configured — any Google account may sign in.
  if (allowedEmails.length === 0 && !allowedDomain) return true;

  const normalized = email.toLowerCase();
  if (allowedEmails.includes(normalized)) return true;
  if (allowedDomain && normalized.endsWith(`@${allowedDomain}`)) return true;

  return false;
}

/**
 * Edge-safe half of the Auth.js config: no database adapter, so it can run in
 * `middleware.ts`. The full config in `auth.ts` extends this.
 */
export const authConfig = {
  providers: [
    Google({
      authorization: {
        params: {
          scope: GOOGLE_SCOPES,
          // Needed to receive a refresh token so we can keep sending later.
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: true,
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    signIn({ user }) {
      return isEmailAllowed(user.email);
    },
    authorized({ auth, request }) {
      const isLoggedIn = Boolean(auth?.user);
      const { pathname } = request.nextUrl;

      const isPublic =
        pathname === "/" ||
        pathname === "/login" ||
        pathname === "/privacy" ||
        pathname === "/terms" ||
        // Google Search Console ownership file (public/google<token>.html).
        /^\/google[0-9a-f]+\.html$/.test(pathname) ||
        pathname.startsWith("/api/auth") ||
        pathname.startsWith("/api/track") ||
        pathname.startsWith("/api/cron") ||
        pathname.startsWith("/api/unsubscribe") ||
        pathname.startsWith("/unsubscribe");

      if (isPublic) return true;
      return isLoggedIn;
    },
  },
} satisfies NextAuthConfig;
