import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";

import { authConfig, gmailCapabilities } from "@/auth.config";
import type { Role } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }

      if (token.sub && !token.role) {
        const record = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { role: true },
        });
        token.role = record?.role ?? "MEMBER";
      }

      return token;
    },
    session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
        session.user.role = (token.role as Role) ?? "MEMBER";
      }
      return session;
    },
  },
  events: {
    /**
     * The very first person to sign in runs the team, so they get ADMIN.
     */
    async createUser({ user }) {
      if (!user.id) return;
      const count = await prisma.user.count();
      if (count === 1) {
        await prisma.user.update({
          where: { id: user.id },
          data: { role: "ADMIN" },
        });
      }
    },
    /**
     * The Google account someone signs in with becomes their first sending
     * mailbox, so a brand-new user can run a campaign without an extra step.
     * More mailboxes are added from the Integrations page.
     */
    async signIn({ user, account }) {
      if (!user.id || !user.email || account?.provider !== "google") return;
      if (!account.access_token || !account.refresh_token) return;

      const { canSend, canRead } = gmailCapabilities(account.scope);
      if (!canSend || !canRead) return;

      const existing = await prisma.emailAccount.count({ where: { userId: user.id } });
      if (existing > 0) return;

      await prisma.emailAccount.create({
        data: {
          userId: user.id,
          email: user.email.toLowerCase(),
          provider: "google",
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at ?? null,
          scope: account.scope ?? null,
        },
      });
    },
  },
});

/** Session helper for server components — throws if not signed in. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }
  return session.user;
}
