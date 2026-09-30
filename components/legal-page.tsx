import { MailCheck } from "lucide-react";
import Link from "next/link";

import { site } from "@/lib/site";

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md">
              <MailCheck className="size-4" />
            </span>
            {site.name}
          </Link>
          <Link href="/login" className="text-sm font-medium hover:underline">
            Sign in
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-sm">
          <p>
            © {new Date().getFullYear()} {site.company}
          </p>
          <nav className="flex gap-4">
            <Link href="/privacy" className="hover:underline">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:underline">
              Terms of Service
            </Link>
            <a href={`mailto:${site.contactEmail}`} className="hover:underline">
              Contact
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-6 py-12 text-sm leading-relaxed [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">Last updated: {site.lastUpdated}</p>
        {children}
      </article>
    </PublicShell>
  );
}
