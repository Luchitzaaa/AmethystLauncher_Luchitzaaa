'use strict';

// The whole Microsoft → Xbox Live → XSTS → Minecraft chain against a local mock of the real endpoints.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const ms = require('../../src/main/core/microsoft');

function startMock(behaviour = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: req.url, method: req.method, headers: req.headers, body });
      const json = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.url === '/oauth/token') {
        const p = new URLSearchParams(body);
        if (p.get('grant_type') === 'refresh_token' && p.get('refresh_token') === 'revoked') return json(400, { error: 'invalid_grant' });
        if (p.get('grant_type') === 'authorization_code') {
          // PKCE: the verifier must hash to the challenge sent on /authorize.
          const challenge = crypto.createHash('sha256').update(p.get('code_verifier')).digest('base64url');
          if (challenge !== behaviour.expectChallenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
        }
        return json(200, { access_token: 'ms-access', refresh_token: 'ms-refresh-2', expires_in: 3600 });
      }
      if (req.url === '/xbl') {
        const b = JSON.parse(body);
        assert.equal(b.Properties.RpsTicket, 'd=ms-access');
        return json(200, { Token: 'xbl-token', DisplayClaims: { xui: [{ uhs: 'userhash' }] } });
      }
      if (req.url === '/xsts') {
        if (behaviour.xstsError) return json(401, { XErr: behaviour.xstsError });
        return json(200, { Token: 'xsts-token', DisplayClaims: { xui: [{ uhs: 'userhash' }] } });
      }
      if (req.url === '/mc/login') {
        if (behaviour.appNotApproved) return json(403, { error: 'Invalid app registration' });
        const b = JSON.parse(body);
        assert.equal(b.identityToken, 'XBL3.0 x=userhash;xsts-token');
        return json(200, { access_token: 'mc-token', expires_in: 86400 });
      }
      if (req.url === '/mc/profile') {
        assert.equal(req.headers.authorization, 'Bearer mc-token');
        if (behaviour.noGame) return json(404, { error: 'NOT_FOUND' });
        return json(200, { id: '069a79f444e94726a5befca90e38aaf5', name: 'Notch', skins: [{ state: 'ACTIVE', url: 'https://textures.minecraft.net/texture/abc' }] });
      }
      json(404, {});
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({
      server,
      seen,
      endpoints: { authority: `${base}/oauth`, xbl: `${base}/xbl`, xsts: `${base}/xsts`, mcLogin: `${base}/mc/login`, entitlements: `${base}/mc/ent`, profile: `${base}/mc/profile` },
    });
  }));
}

test('authorize URL carries PKCE S256, state and the right scope', () => {
  const pkce = ms.createPkce();
  const u = new URL(ms.buildAuthorizeUrl('client-123', pkce));
  assert.equal(u.searchParams.get('client_id'), 'client-123');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('code_challenge'), crypto.createHash('sha256').update(pkce.verifier).digest('base64url'));
  assert.equal(u.searchParams.get('state'), pkce.state);
  assert.equal(u.searchParams.get('scope'), 'XboxLive.signin offline_access');
  assert.equal(u.searchParams.get('redirect_uri'), ms.REDIRECT_URI);
});

test('redirect parsing: code, wrong state, cancellation, unrelated pages', () => {
  const pkce = ms.createPkce();
  assert.equal(ms.parseRedirect(`${ms.REDIRECT_URI}?code=abc&state=${pkce.state}`, pkce.state), 'abc');
  assert.equal(ms.parseRedirect('https://login.live.com/something', pkce.state), null);
  assert.throws(() => ms.parseRedirect(`${ms.REDIRECT_URI}?code=abc&state=forged`, pkce.state), /state/);
  assert.throws(() => ms.parseRedirect(`${ms.REDIRECT_URI}?error=access_denied`, pkce.state), (e) => e.code === 'cancelled');
});

test('full sign-in chain produces a Minecraft session', async () => {
  const pkce = ms.createPkce();
  const mock = await startMock({ expectChallenge: pkce.challenge });
  try {
    const tokens = await ms.exchangeCode('client-123', 'the-code', pkce.verifier, mock.endpoints);
    assert.equal(tokens.refreshToken, 'ms-refresh-2');
    const session = await ms.minecraftSession(tokens, mock.endpoints);
    assert.equal(session.name, 'Notch');
    assert.equal(session.id, '069a79f444e94726a5befca90e38aaf5');
    assert.equal(session.mcAccessToken, 'mc-token');
    assert.ok(session.mcExpiresAt > Date.now() + 80000 * 1000);
    assert.equal(session.skinUrl, 'https://textures.minecraft.net/texture/abc');
    const tokenReq = new URLSearchParams(mock.seen.find((s) => s.url === '/oauth/token').body);
    assert.equal(tokenReq.get('client_id'), 'client-123');
    assert.equal(tokenReq.get('code'), 'the-code');
  } finally {
    mock.server.close();
  }
});

test('refresh with a revoked token asks the user to sign in again', async () => {
  const mock = await startMock();
  try {
    await assert.rejects(ms.refreshMicrosoft('client-123', 'revoked', mock.endpoints), (e) => e.code === 'relogin');
  } finally {
    mock.server.close();
  }
});

test('XSTS errors become readable messages', async () => {
  const mock = await startMock({ xstsError: 2148916233 });
  try {
    await assert.rejects(ms.minecraftSession({ accessToken: 'ms-access', refreshToken: 'r' }, mock.endpoints), (e) => e.code === 'xsts_2148916233' && /xbox\.com/i.test(e.message));
  } finally {
    mock.server.close();
  }
});

test('an Azure app Mojang has not approved yet is explained, not a raw 403', async () => {
  const mock = await startMock({ appNotApproved: true });
  try {
    await assert.rejects(ms.minecraftSession({ accessToken: 'ms-access', refreshToken: 'r' }, mock.endpoints), (e) => e.code === 'app_not_approved');
  } finally {
    mock.server.close();
  }
});

test('an account without Java Edition is reported as such', async () => {
  const mock = await startMock({ noGame: true });
  try {
    await assert.rejects(ms.minecraftSession({ accessToken: 'ms-access', refreshToken: 'r' }, mock.endpoints), (e) => e.code === 'no_game');
  } finally {
    mock.server.close();
  }
});
