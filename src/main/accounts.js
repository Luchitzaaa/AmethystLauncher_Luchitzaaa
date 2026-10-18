'use strict';

const path = require('node:path');
const { BrowserWindow, safeStorage } = require('electron');
const ms = require('./core/microsoft');
const { JsonStore } = require('./store');
const { tr } = require('./i18n');

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Microsoft accounts. Tokens are encrypted with the OS keystore (DPAPI on Windows) via safeStorage and
 * never leave the main process; the renderer only ever sees name, uuid and skin URL.
 */
class Accounts {
  constructor(dir) {
    this.store = new JsonStore(path.join(dir, 'accounts.json'), { activeId: null, accounts: [] }, (d) => ({
      activeId: typeof d?.activeId === 'string' ? d.activeId : null,
      accounts: Array.isArray(d?.accounts) ? d.accounts.filter((a) => a && a.type !== 'offline' && /^[0-9a-f]{32}$/.test(a.id)) : [],
    }));
    this.secrets = new Map(); // id → {msRefreshToken, mcAccessToken, mcExpiresAt}
    this.pending = new Map(); // id → in-flight refresh promise
    for (const a of this.store.get().accounts) {
      if (!a.enc || !safeStorage.isEncryptionAvailable()) continue;
      try {
        this.secrets.set(a.id, JSON.parse(safeStorage.decryptString(Buffer.from(a.enc, 'base64'))));
      } catch {
        /* keystore changed (e.g. Windows profile reset): the account will ask to sign in again */
      }
    }
  }

  canPersist() {
    return safeStorage.isEncryptionAvailable();
  }

  list() {
    const { activeId, accounts } = this.store.get();
    return accounts.map((a) => ({ id: a.id, name: a.name, type: 'msa', skinUrl: a.skinUrl || null, active: a.id === activeId, needsLogin: !this.secrets.has(a.id) }));
  }

  active() {
    const { activeId, accounts } = this.store.get();
    return accounts.find((a) => a.id === activeId) || accounts[0] || null;
  }

  select(id) {
    if (!this.store.get().accounts.some((a) => a.id === id)) throw new Error(tr('Unknown account'));
    this.store.update((d) => ({ ...d, activeId: id }));
  }

  remove(id) {
    this.secrets.delete(id);
    this.store.update((d) => {
      const accounts = d.accounts.filter((a) => a.id !== id);
      return { activeId: d.activeId === id ? accounts[0]?.id ?? null : d.activeId, accounts };
    });
  }

  save(session) {
    this.secrets.set(session.id, { msRefreshToken: session.msRefreshToken, mcAccessToken: session.mcAccessToken, mcExpiresAt: session.mcExpiresAt });
    const enc = this.canPersist()
      ? safeStorage.encryptString(JSON.stringify(this.secrets.get(session.id))).toString('base64')
      : null; // without an OS keystore the session lives in memory only
    this.store.update((d) => {
      const accounts = d.accounts.filter((a) => a.id !== session.id);
      accounts.push({ id: session.id, name: session.name, skinUrl: session.skinUrl, enc });
      return { activeId: session.id, accounts };
    });
  }

  /** Opens Microsoft's sign-in page in a separate, isolated window and completes the token chain. */
  async login(parent, clientId) {
    if (!clientId) {
      throw new ms.AuthError('no_client', tr('Set the Azure application ID first in Options → Accounts (see README).'));
    }
    const pkce = ms.createPkce();
    const code = await new Promise((resolve, reject) => {
      const win = new BrowserWindow({
        parent,
        modal: true,
        width: 500,
        height: 680,
        title: 'Autentificare Microsoft',
        autoHideMenuBar: true,
        backgroundColor: '#ffffff',
        webPreferences: { partition: `msauth-${Date.now()}`, sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      let settled = false;
      const finish = (err, value) => {
        if (settled) return;
        settled = true;
        if (!win.isDestroyed()) win.destroy();
        if (err) reject(err);
        else resolve(value);
      };
      const inspect = (event, url) => {
        try {
          const c = ms.parseRedirect(url, pkce.state);
          if (c) {
            event?.preventDefault?.();
            finish(null, c);
          }
        } catch (err) {
          event?.preventDefault?.();
          finish(err);
        }
      };
      win.webContents.on('will-redirect', inspect);
      win.webContents.on('will-navigate', inspect);
      win.webContents.on('did-navigate', (e, url) => inspect(null, url));
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.on('closed', () => finish(new ms.AuthError('cancelled', tr('Sign-in cancelled.'))));
      win.loadURL(ms.buildAuthorizeUrl(clientId, pkce)).catch(() => {
        /* navigation to the redirect URI is aborted on purpose */
      });
    });
    const msTokens = await ms.exchangeCode(clientId, code, pkce.verifier);
    const session = await ms.minecraftSession(msTokens);
    this.save(session);
    return { id: session.id, name: session.name, skinUrl: session.skinUrl };
  }

  /** Credentials for launching: refreshes the Minecraft token if it expires within 5 minutes. */
  async launchAuth(clientId) {
    const account = this.active();
    if (!account) throw new ms.AuthError('no_account', tr('Sign in with a Microsoft account before starting the game.'));
    const s = this.secrets.get(account.id);
    if (!s) throw new ms.AuthError('relogin', tr('The session of {name} expired. Sign in again.', { name: account.name }));
    if (s.mcExpiresAt - Date.now() > REFRESH_MARGIN_MS) {
      return { name: account.name, uuid: account.id, accessToken: s.mcAccessToken, userType: 'msa', xuid: '' };
    }
    if (!this.pending.has(account.id)) {
      this.pending.set(account.id, (async () => {
        if (!clientId) throw new ms.AuthError('no_client', tr('The Azure application ID is missing (Options → Accounts).'));
        const msTokens = await ms.refreshMicrosoft(clientId, s.msRefreshToken);
        const session = await ms.minecraftSession(msTokens);
        this.save(session);
        return session;
      })().finally(() => this.pending.delete(account.id)));
    }
    try {
      const session = await this.pending.get(account.id);
      return { name: session.name, uuid: session.id, accessToken: session.mcAccessToken, userType: 'msa', xuid: '' };
    } catch (err) {
      if (err.code === 'relogin') this.secrets.delete(account.id);
      throw err;
    }
  }
}

module.exports = { Accounts };
