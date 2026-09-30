"use server";

import { AuthError } from "next-auth";

import { signIn, signOut } from "@/auth";

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/dashboard" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

export type PasswordSignInState = { error: string } | null;

export async function signInWithPassword(
  _previous: PasswordSignInState,
  formData: FormData,
): Promise<PasswordSignInState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
    return null;
  } catch (error) {
    // A successful sign-in throws Next's redirect, which must propagate.
    if (!(error instanceof AuthError)) throw error;
    if (error.type === "AccessDenied") {
      return { error: "That email is not on the team allowlist." };
    }
    return { error: "Wrong email or password." };
  }
}
