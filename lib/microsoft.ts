import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

import { MICROSOFT_SCOPES, MailboxConnectionError } from "@/lib/mailbox";
import { prisma } from "@/lib/prisma";
import { appUrl } from "@/lib/tracking";

/**
 * Microsoft (Outlook.com and Microsoft 365) mailbox connections, over plain
 * OAuth 2.0 against the Microsoft identity platform and the Graph REST API.
 * The `common` authority accepts both personal and work/school accounts.
 */

const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";

/** Refresh a little early so a token never expires mid-request. */
const EXPIRY_SKEW_SECONDS = 5 * 60;

/**
 * Node's built-in fetch ignores HTTPS_PROXY, unlike the googleapis client. On a
 * machine that only reaches the internet through a proxy, Microsoft calls go
 * through it too; without proxy variables (e.g. on Vercel) this is plain fetch.
 */
const proxyAgent =
  process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
    ? new EnvHttpProxyAgent()
    : null;

function msFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!proxyAgent) return fetch(url, { ...init, cache: "no-store" });
  return undiciFetch(url, {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: proxyAgent,
  }) as unknown as Promise<Response>;
}

/** Holds the OAuth `state` between the connect and callback routes. */
export const MICROSOFT_STATE_COOKIE = "microsoft_oauth_state";

/** Where Microsoft sends the user back after they approve a mailbox connection. */
export function microsoftRedirectUri() {
  return `${appUrl()}/api/integrations/microsoft/callback`;
}

function clientCredentials() {
  const clientId = process.env.AUTH_MICROSOFT_ID;
  const clientSecret = process.env.AUTH_MICROSOFT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Outlook is not configured: set AUTH_MICROSOFT_ID and AUTH_MICROSOFT_SECRET.");
  }
  return { clientId, clientSecret };
}

export function microsoftConfigured() {
  return Boolean(process.env.AUTH_MICROSOFT_ID && process.env.AUTH_MICROSOFT_SECRET);
}

/** Consent URL for connecting an Outlook mailbox. */
export function microsoftConsentUrl(state: string, loginHint?: string) {
  const { clientId } = clientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: microsoftRedirectUri(),
    response_mode: "query",
    scope: MICROSOFT_SCOPES,
    // Lets the user pick which of their Microsoft accounts to connect.
    prompt: "select_account",
    state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return `${AUTHORITY}/authorize?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
};

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const { clientId, clientSecret } = clientCredentials();
  const response = await msFetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...body }),
  });

  const data = (await response.json().catch(() => ({}))) as Partial<TokenResponse> & {
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    // e.g. "invalid_grant: AADSTS700082: The refresh token has expired…" —
    // `isRevokedGrant` keys off this text.
    const detail = data.error_description?.split("\r\n")[0] ?? "";
    throw new Error(`${data.error ?? `HTTP ${response.status}`}: ${detail}`.trim());
  }

  return data as TokenResponse;
}

/** Claims from the ID token. It comes straight from the token endpoint over TLS. */
function idTokenClaims(idToken: string | undefined) {
  if (!idToken) return {};
  try {
    const payload = idToken.split(".")[1] ?? "";
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
      preferred_username?: string;
      name?: string;
    };
  } catch {
    return {};
  }
}

/** Swaps the callback `code` for tokens and reads which mailbox was granted. */
export async function exchangeMicrosoftCode(code: string) {
  const tokens = await requestToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: microsoftRedirectUri(),
    scope: MICROSOFT_SCOPES,
  });

  const claims = idTokenClaims(tokens.id_token);
  let me: { mail?: string | null; userPrincipalName?: string | null; displayName?: string | null } =
    {};
  try {
    const response = await msFetch(`${GRAPH}/me?$select=mail,userPrincipalName,displayName`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
    if (response.ok) me = await response.json();
  } catch (error) {
    console.error("Could not read the Microsoft profile", error);
  }

  const email = me.mail || claims.email || me.userPrincipalName || claims.preferred_username;

  return {
    email: email && email.includes("@") ? email.toLowerCase() : null,
    name: me.displayName?.trim() || claims.name?.trim() || null,
    tokens,
  };
}

type StoredMailbox = {
  id: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  scope: string | null;
};

/**
 * Returns a valid access token, refreshing it when it is about to expire.
 * Microsoft rotates refresh tokens, so the new one is always written back.
 */
async function freshAccessToken(mailbox: StoredMailbox, force = false) {
  const now = Math.floor(Date.now() / 1000);
  const stillValid = mailbox.expiresAt && mailbox.expiresAt - EXPIRY_SKEW_SECONDS > now;
  if (!force && mailbox.accessToken && stillValid) return mailbox.accessToken;

  if (!mailbox.refreshToken) throw new MailboxConnectionError();

  const tokens = await requestToken({
    grant_type: "refresh_token",
    refresh_token: mailbox.refreshToken,
    scope: MICROSOFT_SCOPES,
  });

  mailbox.accessToken = tokens.access_token;
  mailbox.refreshToken = tokens.refresh_token ?? mailbox.refreshToken;
  mailbox.expiresAt = now + tokens.expires_in;
  mailbox.scope = tokens.scope ?? mailbox.scope;

  await prisma.emailAccount.update({
    where: { id: mailbox.id },
    data: {
      accessToken: mailbox.accessToken,
      refreshToken: mailbox.refreshToken,
      expiresAt: mailbox.expiresAt,
      scope: mailbox.scope,
      lastError: null,
    },
  });

  return mailbox.accessToken;
}

export class GraphError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`Outlook ${status} ${code}: ${message}`);
    this.name = "GraphError";
  }
}

type GraphInit = Omit<RequestInit, "body"> & { body?: string | object };

/**
 * A small Graph client for one mailbox. Every request asks for immutable ids,
 * so a message keeps its id when Outlook moves it from Drafts to Sent Items.
 */
export async function getGraph(emailAccountId: string) {
  const mailbox = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: { id: true, accessToken: true, refreshToken: true, expiresAt: true, scope: true },
  });
  if (!mailbox?.accessToken && !mailbox?.refreshToken) throw new MailboxConnectionError();

  async function request<T>(path: string, init: GraphInit = {}, attempt = 0): Promise<T> {
    const token = await freshAccessToken(mailbox!, attempt === 1);
    const { body, headers, ...rest } = init;

    const response = await msFetch(path.startsWith("https://") ? path : `${GRAPH}${path}`, {
      ...rest,
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'IdType="ImmutableId"',
        ...(typeof body === "object" ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: typeof body === "object" ? JSON.stringify(body) : body,
      });

    // An access token can be revoked before it expires: refresh once.
    if (response.status === 401 && attempt === 0) return request<T>(path, init, 1);

    // Throttled: wait as long as Graph asks (capped), then try once more.
    if ((response.status === 429 || response.status === 503) && attempt < 2) {
      const wait = Math.min(Number(response.headers.get("Retry-After") ?? 2), 10);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      return request<T>(path, init, 2);
    }

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      throw new GraphError(
        response.status,
        data?.error?.code ?? "Error",
        data?.error?.message ?? response.statusText,
      );
    }

    if (response.status === 202 || response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return request;
}

export type Graph = Awaited<ReturnType<typeof getGraph>>;

/** The Microsoft account's own display name, used when no From name is set. */
export async function outlookProfileName(emailAccountId: string) {
  const graph = await getGraph(emailAccountId);
  const me = await graph<{ displayName?: string | null }>("/me?$select=displayName");
  return me.displayName?.trim() || null;
}
