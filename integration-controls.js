(() => {
  const providers = { spotify: 'Spotify', youtube: 'YouTube', appleMusic: 'Apple Music' };
  const cacheKey = 'hs-app-integrations-v1';
  let config = { enabled: { spotify: false, youtube: false, appleMusic: false }, spotifyClientId: '', youtubeConfigured: false };
  let refreshing = null;

  function validate(value) {
    if (!value || typeof value.spotifyClientId !== 'string' || typeof value.youtubeConfigured !== 'boolean'
        || Object.keys(providers).some((key) => typeof value.enabled?.[key] !== 'boolean')) {
      throw new Error('The server returned invalid integration settings.');
    }
    return value;
  }

  function names() {
    return Object.entries(providers).filter(([key]) => config.enabled[key]).map(([, name]) => name);
  }

  function syncUI() {
    document.querySelectorAll('[data-integration]').forEach((element) => {
      element.toggleAttribute('data-integration-disabled', !config.enabled[element.dataset.integration]);
    });
    const enabledNames = names();
    const any = enabledNames.length > 0;
    document.querySelectorAll('[data-integrations-any]').forEach((element) => {
      element.toggleAttribute('data-integration-disabled', !any);
    });
    const list = enabledNames.join(', ');
    const text = {
      musicLinkLabel: any ? `${list} link` : 'Music link',
      conversionIntro: `Paste a playlist link from ${list} to download a CSV. This does not change songs in your soundboard.`,
      songLinkLabel: any ? `Song link (${list})` : 'Song link',
      helpIntro: any ? `Setup instructions for ${list}. Shared API credentials are managed by the administrator.` : 'No online music integrations are enabled.'
    };
    Object.entries(text).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    });
    const musicInput = document.getElementById('musicUrl');
    if (musicInput) musicInput.placeholder = `Paste a ${list} song or playlist link`;
    document.getElementById('integrationHelpEmpty')?.toggleAttribute('data-integration-disabled', any);
  }

  function apply(value) {
    const previous = JSON.stringify(config);
    config = validate(value);
    localStorage.setItem(cacheKey, JSON.stringify(config));
    const notice = document.getElementById('integrationNotice');
    if (notice) notice.hidden = true;
    syncUI();
    if (JSON.stringify(config) !== previous) document.dispatchEvent(new Event('integrations-changed'));
  }

  function showError(error) {
    console.error('Integration configuration failed.', error);
    const notice = document.getElementById('integrationNotice');
    if (notice) {
      notice.textContent = `${error.message} Online integration controls are unavailable until settings can be loaded.`;
      notice.hidden = false;
    }
  }

  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        if (location.protocol === 'file:' || !navigator.onLine) {
          const cached = localStorage.getItem(cacheKey);
          if (!cached) throw new Error('Open the soundboard server once to load app-wide integration settings.');
          config = validate(JSON.parse(cached));
          syncUI();
          return;
        }
        const response = await fetch('/api/integrations', { cache: 'no-store', credentials: 'same-origin' });
        if (!response.ok) throw new Error('Restart the soundboard server to load integration controls.');
        apply(await response.json());
        const notice = document.getElementById('integrationNotice');
        if (notice) notice.hidden = true;
      } catch (error) {
        config = { enabled: { spotify: false, youtube: false, appleMusic: false }, spotifyClientId: '', youtubeConfigured: false };
        syncUI();
        document.dispatchEvent(new Event('integrations-changed'));
        showError(error);
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  window.SoundboardIntegrations = {
    enabled: (provider) => config.enabled[provider] === true,
    names,
    config: () => config,
    apply,
    syncUI,
    refresh,
    require(provider) {
      if (!config.enabled[provider]) throw new Error('This music integration is disabled by the administrator.');
    }
  };
  syncUI();
  window.SoundboardIntegrations.ready = refresh();
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);
  window.addEventListener('storage', (event) => {
    if (event.key === cacheKey && event.newValue) {
      try { apply(JSON.parse(event.newValue)); } catch (error) { showError(error); }
    }
  });
  if (location.protocol !== 'file:') {
    setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
  }
})();
