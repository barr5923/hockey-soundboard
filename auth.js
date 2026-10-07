(() => {
  const APP_SCRIPT = 'app.js?v=103';
  const PREFIX = 'hockey-soundboard-';
  const LOCAL_ONLY_KEYS = new Set(['hockey-soundboard-offline-mode-v1']);
  const LAST_USER_KEY = 'hs-auth-last-user';
  const AUDIO_DB_BASE = 'hockey-soundboard-audio-v1';

  const nativeSet = Storage.prototype.setItem;
  const nativeRemove = Storage.prototype.removeItem;
  let pending = {};
  let flushTimer = null;

  const isSynced = (key) => key.startsWith(PREFIX) && !LOCAL_ONLY_KEYS.has(key);

  function api(method, url, body, options = {}) {
    return fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      keepalive: Boolean(options.keepalive)
    });
  }

  function flush(options = {}) {
    clearTimeout(flushTimer);
    flushTimer = null;
    const changes = pending;
    pending = {};
    if (!Object.keys(changes).length) {
      return Promise.resolve();
    }
    return api('PUT', '/api/data', { changes }, options)
      .then((response) => {
        if (!response.ok) {
          throw new Error(String(response.status));
        }
      })
      .catch(() => {
        pending = { ...changes, ...pending };
        flushTimer = setTimeout(flush, 10000);
      });
  }

  function queue(key, value) {
    pending[key] = value;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 800);
  }

  function startSync() {
    Storage.prototype.setItem = function (key, value) {
      nativeSet.call(this, key, value);
      if (this === window.localStorage && isSynced(String(key))) {
        queue(String(key), String(value));
      }
    };
    Storage.prototype.removeItem = function (key) {
      nativeRemove.call(this, key);
      if (this === window.localStorage && isSynced(String(key))) {
        queue(String(key), null);
      }
    };
    window.addEventListener('pagehide', () => flush({ keepalive: true }));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flush({ keepalive: true });
      }
    });
  }

  function syncedLocalKeys() {
    return Object.keys(localStorage).filter(isSynced);
  }

  function clearLocalData() {
    syncedLocalKeys().forEach((key) => nativeRemove.call(localStorage, key));
  }

  function loadApp(user) {
    window.SOUNDBOARD_USER = user || null;
    window.SOUNDBOARD_AUDIO_DB = user && user.id !== 1 ? `${AUDIO_DB_BASE}-u${user.id}` : AUDIO_DB_BASE;
    const script = document.createElement('script');
    script.src = APP_SCRIPT;
    document.body.appendChild(script);
  }

  function removeQueryParam(name) {
    const url = new URL(location.href);
    url.searchParams.delete(name);
    history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function showNotice(message, failed = false) {
    const notice = document.getElementById('authNotice');
    notice.textContent = message;
    notice.classList.toggle('error', failed);
    notice.hidden = false;
  }

  function confirmEmailVerification(token) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('emailVerifyOverlay');
      const form = document.getElementById('emailVerifyForm');
      const error = document.getElementById('emailVerifyError');
      const submit = document.getElementById('emailVerifySubmit');
      const cancel = document.getElementById('emailVerifyCancel');
      const finish = (verified) => {
        form.removeEventListener('submit', onSubmit);
        cancel.removeEventListener('click', onCancel);
        overlay.classList.add('hidden');
        resolve(verified);
      };
      const onCancel = () => finish(false);
      const onSubmit = async (event) => {
        event.preventDefault();
        submit.disabled = true;
        error.textContent = '';
        try {
          const response = await api('POST', '/api/verify-email', { token });
          const result = await response.json();
          if (!response.ok) {
            error.textContent = result.error || 'Could not verify recovery email.';
            return;
          }
          showNotice(result.message);
          finish(true);
        } catch (failure) {
          error.textContent = 'Could not reach the server to verify your recovery email.';
        } finally {
          submit.disabled = false;
        }
      };
      form.addEventListener('submit', onSubmit);
      cancel.addEventListener('click', onCancel);
      overlay.classList.remove('hidden');
    });
  }

  function setupAccountRow(user) {
    const row = document.getElementById('accountRow');
    if (!row) {
      return;
    }
    document.getElementById('accountName').textContent = `Signed in as ${user.username}`;
    row.classList.remove('hidden');
    const recoveryRow = document.getElementById('recoveryEmailRow');
    const recoveryEmail = document.getElementById('recoveryEmail');
    const recoveryStatus = document.getElementById('recoveryEmailStatus');
    const saveRecoveryEmail = document.getElementById('saveRecoveryEmail');
    const verifyRecoveryEmail = document.getElementById('verifyRecoveryEmail');
    recoveryEmail.value = user.email || '';
    recoveryRow.classList.remove('hidden');
    verifyRecoveryEmail.classList.toggle('hidden', !user.email || Boolean(user.emailVerified));
    recoveryStatus.textContent = user.emailVerified ? 'Recovery email verified.' :
      user.verificationSent ? 'Verification email sent. Check your inbox.' :
        user.email ? 'Verify this address before using it for password recovery.' : 'Add an email and verify it for password recovery.';
    saveRecoveryEmail.addEventListener('click', async () => {
      saveRecoveryEmail.disabled = true;
      recoveryStatus.textContent = '';
      try {
        const response = await api('POST', '/api/recovery-email', { email: recoveryEmail.value });
        const result = await response.json();
        if (!response.ok) {
          recoveryStatus.textContent = result.error || 'Could not save recovery email.';
          return;
        }
        recoveryEmail.value = result.email;
        verifyRecoveryEmail.classList.toggle('hidden', Boolean(result.emailVerified));
        recoveryStatus.textContent = result.emailVerified ? 'Recovery email verified.' :
          result.verificationSent ? 'Email saved. Verification email sent; check your inbox.' :
            'Email saved, but verification could not be sent. Check server email settings and retry.';
      } catch (error) {
        recoveryStatus.textContent = 'Could not reach the server.';
      } finally {
        saveRecoveryEmail.disabled = false;
      }
    });
    verifyRecoveryEmail.addEventListener('click', async () => {
      verifyRecoveryEmail.disabled = true;
      recoveryStatus.textContent = '';
      try {
        const response = await api('POST', '/api/send-recovery-verification', {});
        const result = await response.json();
        recoveryStatus.textContent = response.ok ? result.message : result.error || 'Could not send verification email.';
      } catch (error) {
        recoveryStatus.textContent = 'Could not reach the server.';
      } finally {
        verifyRecoveryEmail.disabled = false;
      }
    });
    const passwordForm = document.getElementById('changePasswordForm');
    const passwordStatus = document.getElementById('changePasswordStatus');
    passwordForm.classList.remove('hidden');
    passwordForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      passwordStatus.textContent = '';
      if (passwordForm.password.value !== passwordForm.passwordConfirmation.value) {
        passwordStatus.textContent = 'Passwords do not match.';
        passwordForm.passwordConfirmation.focus();
        return;
      }
      try {
        const response = await api('POST', '/api/change-password', {
          password: passwordForm.password.value,
          passwordConfirmation: passwordForm.passwordConfirmation.value
        });
        const result = await response.json().catch(() => ({}));
        passwordStatus.textContent = response.ok ? result.message : result.error || 'Could not change password.';
        if (response.ok) {
          passwordForm.reset();
        }
      } catch (error) {
        passwordStatus.textContent = 'Could not reach the server.';
      }
    });
    document.getElementById('logoutButton').addEventListener('click', async () => {
      await flush();
      try {
        await api('POST', '/api/logout', {});
      } catch (error) {
        // Fall through; the local copy is still cleared below.
      }
      clearLocalData();
      nativeRemove.call(localStorage, LAST_USER_KEY);
      location.reload();
    });
  }

  function setupAdminPanel(user) {
    const link = document.getElementById('adminPanelLink');
    if (!link || !user.isAdmin) {
      return;
    }
    const overlay = document.getElementById('adminOverlay');
    const list = document.getElementById('adminUsers');
    const message = document.getElementById('adminMessage');
    const createForm = document.getElementById('adminCreateForm');
    const integrationForm = document.getElementById('adminIntegrationsForm');
    const integrationStatus = document.getElementById('adminIntegrationStatus');
    const integrationSave = document.getElementById('saveAdminIntegrations');
    const fields = integrationForm.elements;
    const providers = ['spotify', 'youtube', 'appleMusic'];
    const syncDraft = () => {
      integrationForm.querySelectorAll('[data-admin-integration]').forEach((element) => {
        element.toggleAttribute('data-integration-disabled', !fields[`${element.dataset.adminIntegration}Enabled`].checked);
      });
    };
    integrationForm.addEventListener('change', syncDraft);
    document.getElementById('adminUsePreviousApiSetup').addEventListener('click', () => {
      try {
        const previous = JSON.parse(localStorage.getItem('hockey-soundboard-settings-v1') || '{}');
        if (!previous.spotifyClientId && !previous.youtubeApiKey) {
          integrationStatus.textContent = 'This account has no previous API credentials to copy.';
          return;
        }
        if (previous.spotifyClientId) fields.spotifyClientId.value = previous.spotifyClientId;
        if (previous.youtubeApiKey) fields.youtubeApiKey.value = previous.youtubeApiKey;
        fields.clearYoutubeKey.checked = false;
        integrationStatus.textContent = 'Copied your previous API setup. Review it, then Save integrations to share it with everyone.';
      } catch (error) {
        console.error('Could not read previous API settings.', error);
        integrationStatus.textContent = 'Could not read the previous API settings for this account.';
      }
    });
    const say = (text, ok = false) => {
      message.textContent = text;
      message.classList.toggle('success', ok);
    };
    const call = async (method, url, body) => {
      const response = await api(method, url, body);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || 'Request failed.');
      }
      return result;
    };

    let defaultBoardExists = false;
    const defaultBoardStatus = document.getElementById('adminDefaultBoardStatus');
    const saveDefaultBoard = document.getElementById('adminSaveDefaultBoard');
    function renderDefaultBoard(board) {
      defaultBoardExists = Boolean(board.exists);
      if (!board.exists) {
        defaultBoardStatus.textContent = 'No default saved yet. New users get the starter categories.';
        return;
      }
      const savedAt = board.savedAt ? new Date(board.savedAt * 1000).toLocaleString() : 'an unknown time';
      defaultBoardStatus.textContent = `${board.categoryCount} categories and ${board.songCount} songs, saved from ${board.savedBy || 'an admin'} on ${savedAt}.`;
    }
    saveDefaultBoard.addEventListener('click', async () => {
      saveDefaultBoard.disabled = true;
      try {
        await flush();
        renderDefaultBoard(await call('POST', '/api/admin/default-board/save'));
        list.querySelectorAll('button[aria-label^="Apply default categories"]').forEach((button) => { button.disabled = false; });
        say('Your categories are now the default for new users.', true);
      } catch (error) {
        say(error.message);
      } finally {
        saveDefaultBoard.disabled = false;
      }
    });

    async function refresh() {
      const config = await call('GET', '/api/admin/integrations');
      providers.forEach((provider) => { fields[`${provider}Enabled`].checked = config.enabled[provider]; });
      fields.spotifyClientId.value = config.spotifyClientId;
      fields.youtubeApiKey.value = '';
      fields.clearYoutubeKey.checked = false;
      document.getElementById('adminYoutubeKeyStatus').textContent = config.youtubeConfigured
        ? 'A shared key is stored securely on the server.' : 'No shared key has been configured.';
      syncDraft();
      integrationSave.disabled = false;
      integrationStatus.textContent = '';
      const board = await call('GET', '/api/admin/default-board');
      renderDefaultBoard(board);
      const { users } = await call('GET', '/api/admin/users');
      list.textContent = '';
      users.forEach((entry) => {
        const row = document.createElement('tr');
        row.className = 'admin-user';
        const identity = document.createElement('th');
        identity.scope = 'row';
        const passwordCell = document.createElement('td');
        const passwordControls = document.createElement('div');
        passwordControls.className = 'admin-password-controls';
        const accessCell = document.createElement('td');
        const name = document.createElement('strong');
        name.textContent = entry.username + (entry.isAdmin ? ' (admin)' : '');
        const email = document.createElement('span');
        email.textContent = entry.email;
        email.title = entry.email;
        const password = document.createElement('input');
        password.type = 'password';
        password.placeholder = 'New password';
        password.setAttribute('aria-label', `New password for ${entry.username}`);
        password.autocomplete = 'new-password';
        password.maxLength = 200;
        const setPassword = document.createElement('button');
        setPassword.type = 'button';
        setPassword.className = 'top-button neutral';
        setPassword.textContent = 'Set password';
        setPassword.setAttribute('aria-label', `Set password for ${entry.username}`);
        setPassword.addEventListener('click', async () => {
          try {
            const result = await call('POST', '/api/admin/set-password', { userId: entry.id, password: password.value });
            password.value = '';
            say(`${entry.username}: ${result.message}`, true);
            if (entry.id === user.id) {
              location.reload();
            }
          } catch (error) {
            say(error.message);
          }
        });
        const toggleAdmin = document.createElement('button');
        toggleAdmin.type = 'button';
        toggleAdmin.className = 'top-button neutral';
        toggleAdmin.textContent = entry.isAdmin ? 'Remove admin' : 'Make admin';
        toggleAdmin.setAttribute('aria-label', `${toggleAdmin.textContent} for ${entry.username}`);
        toggleAdmin.addEventListener('click', async () => {
          try {
            await call('POST', '/api/admin/set-admin', { userId: entry.id, isAdmin: !entry.isAdmin });
            say(`${entry.username} updated.`, true);
            if (entry.id === user.id && entry.isAdmin) {
              location.reload();
              return;
            }
            await refresh();
          } catch (error) {
            say(error.message);
          }
        });
        identity.append(name, email);
        passwordControls.append(password, setPassword);
        passwordCell.appendChild(passwordControls);
        accessCell.appendChild(toggleAdmin);
        const boardCell = document.createElement('td');
        const applyDefaults = document.createElement('button');
        applyDefaults.type = 'button';
        applyDefaults.className = 'top-button neutral';
        applyDefaults.textContent = 'Apply defaults';
        applyDefaults.disabled = !defaultBoardExists;
        applyDefaults.setAttribute('aria-label', `Apply default categories to ${entry.username}`);
        applyDefaults.addEventListener('click', async () => {
          if (!confirm(`Replace ${entry.username}'s categories and songs with the default categories? This cannot be undone.`)) {
            return;
          }
          try {
            await flush();
            await call('POST', '/api/admin/default-board/apply', { userId: entry.id });
            if (entry.id === user.id) {
              location.reload();
              return;
            }
            say(`${entry.username} now has the default categories. If they are signed in, they should reload the page.`, true);
          } catch (error) {
            say(error.message);
          }
        });
        boardCell.appendChild(applyDefaults);
        row.append(identity, passwordCell, accessCell, boardCell);
        list.appendChild(row);
      });
      if (!users.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 4;
        cell.textContent = 'No existing users.';
        row.appendChild(cell);
        list.appendChild(row);
      }
    }

    integrationForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      integrationSave.disabled = true;
      integrationStatus.textContent = 'Saving integration settings...';
      const body = {
        enabled: Object.fromEntries(providers.map((provider) => [provider, fields[`${provider}Enabled`].checked])),
        spotifyClientId: fields.spotifyClientId.value.trim()
      };
      if (fields.clearYoutubeKey.checked) body.youtubeApiKey = '';
      else if (fields.youtubeApiKey.value.trim()) body.youtubeApiKey = fields.youtubeApiKey.value.trim();
      try {
        const config = await call('PUT', '/api/admin/integrations', body);
        window.SoundboardIntegrations.apply(config);
        fields.youtubeApiKey.value = '';
        fields.clearYoutubeKey.checked = false;
        document.getElementById('adminYoutubeKeyStatus').textContent = config.youtubeConfigured
          ? 'A shared key is stored securely on the server.' : 'No shared key has been configured.';
        integrationStatus.textContent = 'Saved for all users. Songs and credentials for disabled integrations have been kept.';
      } catch (error) {
        console.error('Could not save integration settings.', error);
        integrationStatus.textContent = error.message;
      } finally {
        integrationSave.disabled = false;
      }
    });
    document.getElementById('adminCheckAppleMusic').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await fetchAppleMusicToken();
        document.getElementById('adminAppleMusicStatus').textContent = 'Signing credentials are configured on the server.';
      } catch (error) {
        document.getElementById('adminAppleMusicStatus').textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    link.classList.remove('hidden');
    link.addEventListener('click', async () => {
      document.getElementById('sideMenuList').classList.add('hidden');
      document.querySelector('.side-menu-toggle').setAttribute('aria-expanded', 'false');
      say('');
      integrationSave.disabled = true;
      overlay.classList.remove('hidden');
      try {
        await refresh();
      } catch (error) {
        say(error.message);
      }
    });
    document.getElementById('adminClose').addEventListener('click', () => {
      overlay.classList.add('hidden');
      document.querySelector('.side-menu-toggle').focus();
    });
    createForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await call('POST', '/api/admin/create-user', {
          username: createForm.username.value,
          email: createForm.email.value,
          password: createForm.password.value,
          isAdmin: createForm.isAdmin.checked
        });
        say(`User ${createForm.username.value} created.`, true);
        createForm.reset();
        await refresh();
      } catch (error) {
        say(error.message);
      }
    });
  }

  function showLogin({ inviteRequired, resetToken }) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('authOverlay');
      const form = document.getElementById('authForm');
      const error = document.getElementById('authError');
      const submit = document.getElementById('authSubmit');
      const toggle = document.getElementById('authToggle');
      const inviteField = document.getElementById('authInviteField');
      const title = document.getElementById('authTitle');
      const usernameField = document.getElementById('authUsernameField');
      const emailField = document.getElementById('authEmailField');
      const passwordField = document.getElementById('authPasswordField');
      const passwordConfirmationField = document.getElementById('authPasswordConfirmationField');
      const forgot = document.getElementById('authForgot');
      const back = document.getElementById('authBack');
      let mode = resetToken ? 'reset' : 'login';

      const setField = (field, visible, required) => {
        field.classList.toggle('hidden', !visible);
        field.querySelector('input').required = required;
      };

      const render = () => {
        const registering = mode === 'register';
        const loggingIn = mode === 'login';
        title.textContent = registering ? 'Create account' : mode === 'forgot' ? 'Reset password' :
          mode === 'reset' ? 'Choose a new password' : 'Log in';
        submit.textContent = registering ? 'Create account' : mode === 'forgot' ? 'Send reset link' :
          mode === 'reset' ? 'Reset password' : 'Log in';
        toggle.textContent = registering ? 'Have an account? Log in' : 'New here? Create an account';
        toggle.classList.toggle('hidden', !(registering || loggingIn));
        forgot.classList.toggle('hidden', !loggingIn);
        back.classList.toggle('hidden', !(mode === 'forgot' || mode === 'reset'));
        setField(usernameField, registering || loggingIn, registering || loggingIn);
        setField(emailField, registering || mode === 'forgot', registering || mode === 'forgot');
        setField(passwordField, registering || loggingIn || mode === 'reset', registering || loggingIn || mode === 'reset');
        setField(passwordConfirmationField, registering, registering);
        form.password.minLength = registering || mode === 'reset' ? 8 : 0;
        inviteField.classList.toggle('hidden', !(registering && inviteRequired));
        form.password.autocomplete = registering || mode === 'reset' ? 'new-password' : 'current-password';
        form.passwordConfirmation.autocomplete = 'new-password';
        error.textContent = '';
        error.classList.remove('success');
      };
      toggle.addEventListener('click', () => {
        mode = mode === 'register' ? 'login' : 'register';
        render();
      });
      forgot.addEventListener('click', () => {
        mode = 'forgot';
        render();
        form.email.focus();
      });
      back.addEventListener('click', () => {
        if (mode === 'reset') removeQueryParam('reset');
        mode = 'login';
        render();
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (mode === 'register' && form.password.value !== form.passwordConfirmation.value) {
          error.textContent = 'Passwords do not match.';
          form.passwordConfirmation.focus();
          return;
        }
        submit.disabled = true;
        error.textContent = '';
        try {
          const endpoint = mode === 'register' ? '/api/register' :
            mode === 'forgot' ? '/api/forgot-password' :
              mode === 'reset' ? '/api/reset-password' : '/api/login';
          const payload = mode === 'forgot' ? { email: form.email.value } :
            mode === 'reset' ? { token: resetToken, password: form.password.value } : {
              username: form.username.value,
              password: form.password.value,
              email: form.email.value,
              invite: form.invite.value
            };
          if (mode === 'register') {
            payload.passwordConfirmation = form.passwordConfirmation.value;
          }
          const response = await api('POST', endpoint, payload);
          const result = await response.json();
          if (!response.ok) {
            error.textContent = result.error || 'Something went wrong.';
            return;
          }
          if (mode === 'forgot') {
            error.textContent = result.message;
            error.classList.add('success');
            return;
          }
          overlay.classList.add('hidden');
          if (mode === 'reset') removeQueryParam('reset');
          resolve({ user: result, registered: mode === 'register' });
        } catch (failure) {
          error.textContent = 'Could not reach the server.';
        } finally {
          submit.disabled = false;
        }
      });
      render();
      overlay.classList.remove('hidden');
      (mode === 'forgot' ? form.email : mode === 'reset' ? form.password : form.username).focus();
    });
  }

  async function boot() {
    await window.SoundboardIntegrations.ready;
    if (location.protocol === 'file:') {
      loadApp(null);
      return;
    }

    let me;
    try {
      me = await api('GET', '/api/me');
    } catch (error) {
      // Offline or server down: keep working from the last signed-in user's local copy.
      const cached = localStorage.getItem(LAST_USER_KEY);
      loadApp(cached ? JSON.parse(cached) : null);
      return;
    }
    let verificationSucceeded = false;
    const verificationToken = new URLSearchParams(location.search).get('verify');
    if (verificationToken) {
      verificationSucceeded = await confirmEmailVerification(verificationToken);
      removeQueryParam('verify');
    }
    if (me.status === 404) {
      loadApp(null);
      return;
    }

    let user;
    let first = false;
    const resetToken = new URLSearchParams(location.search).get('reset');
    if (resetToken) {
      const result = await showLogin({ inviteRequired: false, resetToken });
      user = result.user;
      first = Boolean(result.user.first);
    } else if (me.ok) {
      user = await me.json();
      if (verificationSucceeded) user.emailVerified = true;
    } else {
      const info = await me.json().catch(() => ({}));
      const result = await showLogin({ inviteRequired: Boolean(info.inviteRequired), resetToken: null });
      user = result.user;
      first = Boolean(result.user.first);
    }

    const lastUser = localStorage.getItem(LAST_USER_KEY);
    const sameAsLast = lastUser && JSON.parse(lastUser).id === user.id;
    if (first && syncedLocalKeys().length) {
      // The very first account adopts data already saved in this browser.
      syncedLocalKeys().forEach((key) => { pending[key] = localStorage.getItem(key); });
    } else {
      const response = await api('GET', '/api/data');
      const { data } = await response.json();
      if (sameAsLast && !Object.keys(data).length) {
        syncedLocalKeys().forEach((key) => { pending[key] = localStorage.getItem(key); });
      } else {
        clearLocalData();
        Object.entries(data).forEach(([key, value]) => nativeSet.call(localStorage, key, value));
      }
    }
    nativeSet.call(localStorage, LAST_USER_KEY, JSON.stringify({ id: user.id, username: user.username }));

    startSync();
    setupAccountRow(user);
    setupAdminPanel(user);
    if (Object.keys(pending).length) {
      flush();
    }
    loadApp(user);
  }

  boot();
})();
