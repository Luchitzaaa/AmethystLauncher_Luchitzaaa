'use strict';

// Microsoft account → Xbox Live → XSTS → Minecraft services, per Microsoft's documented flow.
// Network endpoints are injectable so the whole chain can be exercised against a local mock.

const crypto = require('node:crypto');
const { request, postJson, HttpError } = require('./http');
const { tr } = require('../i18n');

const DEFAULT_ENDPOINTS = {
  authority: 'https://login.microsoftonline.com/consumers/oauth2/v2.0',
  xbl: 'https://user.auth.xboxlive.com/user/authenticate',
  xsts: 'https://xsts.auth.xboxlive.com/xsts/authorize',
  mcLogin: 'https://api.minecraftservices.com/authentication/login_with_xbox',
  entitlements: 'https://api.minecraftservices.com/entitlements/mcstore',
  profile: 'https://api.minecraftservices.com/minecraft/profile',
};

const REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient';
const SCOPE = 'XboxLive.signin offline_access';

class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

// Functions, so the message is built in the UI language at the moment it is shown.
const XSTS_ERRORS = {
  2148916227: () => tr('The account is banned on Xbox.'),
  2148916229: () => tr('The account has parental restrictions. An adult has to allow online play in the Xbox settings.'),
  2148916233: () => tr('The Microsoft account has no Xbox profile. Sign in once on xbox.com to create it, then try again.'),
  2148916234: () => tr('You have to accept the Xbox terms on xbox.com before signing in.'),
  2148916235: () => tr('Xbox Live is not available in the account country.'),
  2148916236: () => tr('The account needs age verification (South Korea).'),
  2148916237: () => tr('The account needs age verification (South Korea).'),
  2148916238: () => tr('Child account: an adult has to add it to a Microsoft family.'),
};

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function createPkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge, state: b64url(crypto.randomBytes(16)) };
}

function buildAuthorizeUrl(clientId, pkce, endpoints = DEFAULT_ENDPOINTS) {
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    response_mode: 'query',
    scope: SCOPE,
    state: pkce.state,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${endpoints.authority}/authorize?${q}`;
}

/** Returns the auth code if url is our redirect, null if it's some other page, throws on OAuth errors. */
function parseRedirect(url, expectedState) {
  if (!url.startsWith(REDIRECT_URI)) return null;
  const q = new URL(url).searchParams;
  if (q.get('error')) {
    const cancelled = q.get('error') === 'access_denied';
    throw new AuthError(cancelled ? 'cancelled' : q.get('error'), cancelled ? tr('Sign-in cancelled.') : q.get('error_description') || q.get('error'));
  }
  if (q.get('state') !== expectedState) throw new AuthError('state', tr('Invalid sign-in response (state).'));
  const code = q.get('code');
  if (!code) throw new AuthError('no_code', tr('Microsoft did not send the authorization code.'));
  return code;
}

async function tokenRequest(clientId, params, endpoints) {
  const res = await request(`${endpoints.authority}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: clientId, scope: SCOPE, ...params }).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (json.error === 'invalid_grant') throw new AuthError('relogin', tr('The Microsoft session expired. Sign in again.'));
    if (json.error === 'invalid_client' || json.error === 'unauthorized_client') {
      throw new AuthError('client', tr('The Azure application ID is not valid or does not allow personal Microsoft accounts.'));
    }
    throw new AuthError(json.error || 'token', json.error_description || tr('Microsoft token error ({status})', { status: res.status }));
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + json.expires_in * 1000 };
}

function exchangeCode(clientId, code, verifier, endpoints = DEFAULT_ENDPOINTS) {
  return tokenRequest(clientId, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier }, endpoints);
}

function refreshMicrosoft(clientId, refreshToken, endpoints = DEFAULT_ENDPOINTS) {
  return tokenRequest(clientId, { grant_type: 'refresh_token', refresh_token: refreshToken }, endpoints);
}

async function xboxLive(msAccessToken, endpoints = DEFAULT_ENDPOINTS) {
  const res = await postJson(endpoints.xbl, {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  return { token: res.Token, uhs: res.DisplayClaims?.xui?.[0]?.uhs };
}

async function xsts(xblToken, endpoints = DEFAULT_ENDPOINTS) {
  try {
    const res = await postJson(endpoints.xsts, {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    });
    return { token: res.Token, uhs: res.DisplayClaims?.xui?.[0]?.uhs };
  } catch (err) {
    const xerr = err.json?.XErr;
    if (xerr && XSTS_ERRORS[xerr]) throw new AuthError(`xsts_${xerr}`, XSTS_ERRORS[xerr]());
    throw err;
  }
}

async function minecraftLogin(uhs, xstsToken, endpoints = DEFAULT_ENDPOINTS) {
  try {
    const res = await postJson(endpoints.mcLogin, { identityToken: `XBL3.0 x=${uhs};${xstsToken}` });
    return { accessToken: res.access_token, expiresAt: Date.now() + res.expires_in * 1000 };
  } catch (err) {
    if (err instanceof HttpError && err.status === 403) {
      throw new AuthError(
        'app_not_approved',
        tr('Mojang rejected the Azure application ID (403). New applications must be approved by Mojang for the Minecraft API; see README → “Microsoft sign-in”.'),
      );
    }
    throw err;
  }
}

async function getBearer(url, token) {
  const res = await request(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  return res;
}

async function minecraftProfile(mcAccessToken, endpoints = DEFAULT_ENDPOINTS) {
  const res = await getBearer(endpoints.profile, mcAccessToken);
  if (res.status === 404) throw new AuthError('no_game', tr('This account does not own Minecraft: Java Edition.'));
  if (!res.ok) throw new HttpError(res.status, endpoints.profile, await res.text().catch(() => ''));
  const p = await res.json();
  const skin = (p.skins || []).find((s) => s.state === 'ACTIVE') || p.skins?.[0];
  // Mojang serves skin URLs as http://; the same host answers on https, which the UI's CSP requires.
  return { id: p.id, name: p.name, skinUrl: skin?.url ? skin.url.replace(/^http:\/\//, 'https://') : null };
}

async function ownsGame(mcAccessToken, endpoints = DEFAULT_ENDPOINTS) {
  const res = await getBearer(endpoints.entitlements, mcAccessToken);
  if (!res.ok) return null; // unknown; the profile check is authoritative
  const items = (await res.json()).items || [];
  return items.some((i) => i.name === 'product_minecraft' || i.name === 'game_minecraft');
}

/** Runs XBL → XSTS → Minecraft → profile for a Microsoft access token. */
async function minecraftSession(ms, endpoints = DEFAULT_ENDPOINTS) {
  const xbl = await xboxLive(ms.accessToken, endpoints);
  const x = await xsts(xbl.token, endpoints);
  const mc = await minecraftLogin(x.uhs || xbl.uhs, x.token, endpoints);
  const profile = await minecraftProfile(mc.accessToken, endpoints);
  return {
    id: profile.id,
    name: profile.name,
    skinUrl: profile.skinUrl,
    msRefreshToken: ms.refreshToken,
    mcAccessToken: mc.accessToken,
    mcExpiresAt: mc.expiresAt,
  };
}

module.exports = {
  DEFAULT_ENDPOINTS,
  REDIRECT_URI,
  SCOPE,
  AuthError,
  createPkce,
  buildAuthorizeUrl,
  parseRedirect,
  exchangeCode,
  refreshMicrosoft,
  xboxLive,
  xsts,
  minecraftLogin,
  minecraftProfile,
  ownsGame,
  minecraftSession,
};
