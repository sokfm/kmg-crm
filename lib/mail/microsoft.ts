// Σύνδεση με το Microsoft 365 (Outlook) μέσω Microsoft Graph.
// Χρειάζεται στη Vercel: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET.

const SCOPES = "offline_access openid email User.Read Mail.Read";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Λείπει το ${name} στη Vercel`);
  return v;
}
const base = () => `https://login.microsoftonline.com/${env("MS_TENANT_ID")}/oauth2/v2.0`;

export function authorizeUrl(redirectUri: string, state: string) {
  const p = new URLSearchParams({
    client_id: env("MS_CLIENT_ID"),
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: SCOPES,
    state,
    prompt: "select_account",
  });
  return `${base()}/authorize?${p}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; error?: string; error_description?: string };

async function token(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${base()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("MS_CLIENT_ID"), client_secret: env("MS_CLIENT_SECRET"), scope: SCOPES, ...body }),
  });
  const raw = await res.text();
  let json: TokenResponse;
  try { json = JSON.parse(raw) as TokenResponse; } catch { throw new Error(`Microsoft token ${res.status}: ${raw.slice(0, 150) || "κενή απάντηση"}`); }
  if (!res.ok || json.error) throw new Error(`Microsoft: ${json.error_description ?? json.error ?? res.status}`);
  return json;
}

export const exchangeCode = (code: string, redirectUri: string) =>
  token({ grant_type: "authorization_code", code, redirect_uri: redirectUri });

export const refreshAccess = (refreshToken: string) => token({ grant_type: "refresh_token", refresh_token: refreshToken });

export async function graph<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.body-content-type="text"' },
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Graph ${res.status}: ${raw.slice(0, 200)}`);
  try { return JSON.parse(raw) as T; } catch { throw new Error(`Graph: μη έγκυρη απάντηση (${raw.length} χαρακτήρες)`); }
}

export type GraphAddress = { emailAddress: { name?: string; address?: string } };
export type GraphMessage = {
  id: string;
  subject?: string;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  receivedDateTime?: string;
  sentDateTime?: string;
  bodyPreview?: string;
  body?: { content?: string };
  webLink?: string;
  isDraft?: boolean;
};
