import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";

// Edge-safe: uses the adapter-free config so Prisma never runs here.
export const { auth: proxy } = NextAuth(authConfig);

export default proxy;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
