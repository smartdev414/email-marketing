import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Proxy-aware fetch for Microsoft Graph (lib/microsoft.ts); Node-only, so not bundled.
  // SMTP/IMAP mailboxes (lib/mail/smtp.ts) open raw sockets; Node-only as well.
  serverExternalPackages: ["undici", "nodemailer", "imapflow", "mailparser"],
  async headers() {
    return [
      {
        // The desktop-notification service worker must never be served stale.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
