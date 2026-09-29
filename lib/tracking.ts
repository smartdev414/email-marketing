export function appUrl() {
  // Prefer an explicit value; otherwise fall back to the domain Vercel assigns,
  // so a fresh deploy produces working links before anything is configured.
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "") ||
    "http://localhost:3000";

  return configured.replace(/\/$/, "");
}

/**
 * Tracking pixels and links should come from a dedicated subdomain
 * (t.yourdomain.com) rather than the app domain — a shared or app-looking
 * tracking host is a well-known spam signal on cold outreach.
 */
export function trackingUrl() {
  return (process.env.NEXT_PUBLIC_TRACKING_URL || appUrl()).replace(/\/$/, "");
}

export function openPixelUrl(token: string) {
  return `${trackingUrl()}/api/track/o/${token}.png`;
}

export function clickUrl(token: string, target: string) {
  return `${trackingUrl()}/api/track/c/${token}?u=${encodeURIComponent(target)}`;
}

export function unsubscribeUrl(token: string) {
  return `${trackingUrl()}/unsubscribe/${token}`;
}

/** Endpoint for the RFC 8058 `List-Unsubscribe-Post` one-click header. */
export function oneClickUnsubscribeUrl(token: string) {
  return `${trackingUrl()}/api/unsubscribe/${token}`;
}

/** Rewrites every http(s) href so clicks are counted before redirecting. */
function rewriteLinks(html: string, token: string) {
  return html.replace(
    /href=("|')(https?:\/\/[^"']+)\1/gi,
    (_match, quote: string, target: string) => {
      if (target.startsWith(trackingUrl())) return `href=${quote}${target}${quote}`;
      return `href=${quote}${clickUrl(token, target)}${quote}`;
    },
  );
}

export type TrackingOptions = {
  opens?: boolean;
  clicks?: boolean;
};

/**
 * Wraps rendered template HTML with the unsubscribe footer, plus — when the
 * campaign asks for them — click-tracked links and the open pixel.
 */
export function withTracking(
  html: string,
  token: string,
  { opens = true, clicks = true }: TrackingOptions = {},
) {
  const body = clicks ? rewriteLinks(html, token) : html;

  const parts = [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827">',
    body,
    '<div style="margin-top:28px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">',
    `<a href="${unsubscribeUrl(token)}" style="color:#6b7280">Unsubscribe</a>`,
    "</div>",
    "</div>",
  ];

  if (opens) {
    parts.push(
      `<img src="${openPixelUrl(token)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px" />`,
    );
  }

  return parts.join("\n");
}

/** Turns a plain-text template body into simple HTML paragraphs. */
export function textToHtml(text: string) {
  if (/<[a-z][\s\S]*>/i.test(text)) return text;

  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

export function htmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}
