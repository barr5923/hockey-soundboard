(() => {
  const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
  const APP_FOLDER_SCOPE = 'Files.ReadWrite.AppFolder';
  const MAX_SIMPLE_UPLOAD_SIZE = 250 * 1024 * 1024;
  let clientPromise = null;

  function configuration() {
    return window.SoundboardIntegrations.config().oneDriveClientId;
  }

  async function getClient() {
    const clientId = configuration();
    if (!clientId) {
      throw new Error('OneDrive is not configured by the administrator yet.');
    }
    if (!window.msal?.PublicClientApplication) {
      throw new Error('Microsoft sign-in could not load. Check your internet connection and retry.');
    }
    if (!clientPromise) {
      const client = new window.msal.PublicClientApplication({
        auth: {
          clientId,
          authority: 'https://login.microsoftonline.com/common',
          redirectUri: `${location.origin}/msal-redirect.html`
        },
        cache: { cacheLocation: 'sessionStorage' }
      });
      clientPromise = Promise.resolve(client.initialize?.()).then(() => client);
    }
    return clientPromise;
  }

  async function getAccount() {
    const client = await getClient();
    let account = client.getActiveAccount();
    if (!account) {
      account = client.getAllAccounts()[0] || null;
      if (account) client.setActiveAccount(account);
    }
    return account;
  }

  async function connect() {
    const client = await getClient();
    const result = await client.loginPopup({ scopes: [APP_FOLDER_SCOPE], prompt: 'select_account' });
    if (!result.account) {
      throw new Error('Microsoft sign-in did not return an account.');
    }
    client.setActiveAccount(result.account);
    return result.account;
  }

  async function disconnect() {
    const client = await getClient();
    const account = await getAccount();
    if (account) {
      await client.logoutPopup({ account });
      client.setActiveAccount(null);
    }
  }

  async function isConnected() {
    if (!configuration() || !window.msal?.PublicClientApplication) return false;
    return Boolean(await getAccount());
  }

  async function getAccountInfo() {
    return getAccount();
  }

  async function acquireToken(expectedAccountId) {
    const client = await getClient();
    const account = await getAccount();
    if (!account) {
      throw new Error('Connect OneDrive in Settings to access this audio.');
    }
    if (expectedAccountId && expectedAccountId !== account.homeAccountId) {
      throw new Error('Connect the OneDrive account that owns this audio in Settings.');
    }
    try {
      const result = await client.acquireTokenSilent({ account, scopes: [APP_FOLDER_SCOPE] });
      return { accessToken: result.accessToken, accountId: account.homeAccountId };
    } catch (error) {
      if (error?.name === 'InteractionRequiredAuthError'
          || (window.msal.InteractionRequiredAuthError && error instanceof window.msal.InteractionRequiredAuthError)) {
        throw new Error('OneDrive needs you to reconnect. Open Settings and choose Connect OneDrive, then retry.');
      }
      throw error;
    }
  }

  async function graphRequest(path, options, expectedAccountId) {
    const { accessToken } = await acquireToken(expectedAccountId);
    let response;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(`${GRAPH_ROOT}${path}`, {
        ...options,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${accessToken}`
        }
      });
      if (![429, 503, 504].includes(response.status) || attempt === 2) break;
      const retryAfter = Number(response.headers.get('Retry-After'));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 5000)
        : 500 * (2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        detail = body.error?.message || '';
      } catch (error) {
        detail = '';
      }
      throw new Error(detail || `OneDrive request failed (${response.status}).`);
    }
    return response;
  }

  async function uploadAudio(file) {
    if (file.size > MAX_SIMPLE_UPLOAD_SIZE) {
      throw new Error('This file is larger than the 250 MB OneDrive upload limit.');
    }
    const { accountId } = await acquireToken();
    const safeName = `${crypto.randomUUID()}-${file.name.replace(/[\\/]/g, '_')}`;
    const path = `/me/drive/special/approot:/${encodeURIComponent(safeName)}:/content`;
    const response = await graphRequest(path, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file
    });
    const item = await response.json();
    if (!item.id) {
      throw new Error('OneDrive saved the file but did not return its file ID.');
    }
    return { itemId: item.id, accountId };
  }

  async function getDownloadUrl(itemId, expectedAccountId) {
    const response = await graphRequest(`/me/drive/items/${encodeURIComponent(itemId)}`, {
      method: 'GET'
    }, expectedAccountId);
    const item = await response.json();
    const downloadUrl = item['@microsoft.graph.downloadUrl'];
    if (typeof downloadUrl !== 'string' || !downloadUrl.startsWith('https://')) {
      throw new Error('OneDrive did not provide a valid audio download link.');
    }
    return downloadUrl;
  }

  async function deleteAudio(itemId, expectedAccountId) {
    await graphRequest(`/me/drive/items/${encodeURIComponent(itemId)}`, {
      method: 'DELETE'
    }, expectedAccountId);
  }

  window.SoundboardOneDrive = { connect, disconnect, isConnected, getAccountInfo, uploadAudio, getDownloadUrl, deleteAudio };
})();
