import { google } from "googleapis";
import { db } from "../db";
import { googleOAuthTokens } from "@shared/schema";
import { eq } from "drizzle-orm";

const SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

function getOAuthCredentials() {
  // GOOGLE_CLOUD_JSON (downloaded from Cloud Console) takes precedence
  const cloudJson = process.env.GOOGLE_CLOUD_JSON;
  if (cloudJson) {
    try {
      const parsed = JSON.parse(cloudJson);
      const web = parsed.web;
      if (web?.client_id && web?.client_secret) {
        return {
          clientId: web.client_id as string,
          clientSecret: web.client_secret as string,
          redirectUri:
            (web.redirect_uris?.[0] as string | undefined) ||
            process.env.GOOGLE_REDIRECT_URI ||
            "http://localhost:5000/api/auth/google/callback",
        };
      }
    } catch {
      // fall through to individual env vars
    }
  }
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ||
      "http://localhost:5000/api/auth/google/callback",
  };
}

function createOAuthClient() {
  const { clientId, clientSecret, redirectUri } = getOAuthCredentials();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function isOAuthConfigured(): boolean {
  const { clientId, clientSecret } = getOAuthCredentials();
  return !!(clientId && clientSecret);
}

export function generateAuthUrl(state: string): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent select_account",
    state,
  });
}

export async function exchangeCode(code: string) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

export async function getGoogleUserInfo(accessToken: string) {
  const client = createOAuthClient();
  client.setCredentials({ access_token: accessToken });
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();
  return data;
}

export async function getAuthClientForUser(userId: string) {
  const [token] = await db
    .select()
    .from(googleOAuthTokens)
    .where(eq(googleOAuthTokens.userId, userId))
    .limit(1);

  if (!token) return null;

  const client = createOAuthClient();
  client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken || undefined,
    expiry_date: token.expiresAt ? token.expiresAt.getTime() : undefined,
  });

  // Persist refreshed tokens back to DB automatically
  client.on("tokens", async (newTokens) => {
    if (newTokens.access_token) {
      await db
        .update(googleOAuthTokens)
        .set({
          accessToken: newTokens.access_token,
          expiresAt: newTokens.expiry_date ? new Date(newTokens.expiry_date) : null,
          updatedAt: new Date(),
        })
        .where(eq(googleOAuthTokens.userId, userId));
    }
  });

  return client;
}

export interface GA4Property {
  id: string;
  displayName: string;
  accountDisplayName: string;
}

export interface GSCSite {
  siteUrl: string;
  permissionLevel: string;
}

export async function listUserGA4Properties(userId: string): Promise<GA4Property[]> {
  const auth = await getAuthClientForUser(userId);
  if (!auth) return [];

  try {
    const adminClient = google.analyticsadmin({ version: "v1beta", auth });
    const accountsRes = await adminClient.accounts.list();
    const accounts = accountsRes.data.accounts || [];

    const allProperties: GA4Property[] = [];

    for (const account of accounts) {
      if (!account.name) continue;
      try {
        const propsRes = await adminClient.properties.list({
          filter: `parent:${account.name}`,
        });
        for (const prop of propsRes.data.properties || []) {
          const id = prop.name?.replace("properties/", "") || "";
          allProperties.push({
            id,
            displayName: prop.displayName || id,
            accountDisplayName: account.displayName || account.name,
          });
        }
      } catch {
        // skip accounts we can't access
      }
    }

    return allProperties;
  } catch (err) {
    console.error("[google-oauth] listUserGA4Properties error:", err);
    return [];
  }
}

export async function listUserGSCSites(userId: string): Promise<GSCSite[]> {
  const auth = await getAuthClientForUser(userId);
  if (!auth) return [];

  try {
    const sc = google.searchconsole({ version: "v1", auth });
    const res = await sc.sites.list();
    return (res.data.siteEntry || []).map((site) => ({
      siteUrl: site.siteUrl || "",
      permissionLevel: site.permissionLevel || "",
    }));
  } catch (err) {
    console.error("[google-oauth] listUserGSCSites error:", err);
    return [];
  }
}
