async function runIntegrationBrowserTests() {
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const controls = window.SoundboardIntegrations;
  const original = {
    config: controls.config(), cache: localStorage.getItem('hs-app-integrations-v1'),
    playlists: state.playlists, sizes: state.categorySizes, settings: state.categorySettings,
    hidden: state.hiddenCategories, shared: sharedCategories, refresh: refreshSharedCategories,
    fetch: window.fetch, current: state.currentTrack, editor: state.songEditor,
    save: savePlaylists, offline: offlineModeToggleInput.checked,
    library: musicLibraryContent.classList.contains('hidden'),
    settingsHidden: settingsPanel.classList.contains('hidden'),
    menuHidden: document.querySelector('.side-menu-list').classList.contains('hidden'),
    adminFields: [...document.getElementById('adminIntegrationsForm').elements].map((element) => ({
      element, value: element.value, checked: element.checked, disabled: element.disabled
    })),
    noticeHidden: document.getElementById('integrationNotice').hidden
  };
  const playbackFields = ['currentCategoryKey', 'currentTrackIndex', 'currentTrackElapsedMs',
    'currentTrackStartedAt', 'currentTrackDurationSeconds', 'autoTransitioning'];
  original.playback = Object.fromEntries(playbackFields.map((key) => [key, state[key]]));
  original.stop = stopActiveCustomPlayback;
  original.clearTimers = clearTrackPlaybackTimers;
  original.download = downloadBlob;
  const conversionUrl = document.getElementById('playlistConversionUrl');
  const conversionFilename = document.getElementById('playlistConversionFilename');
  original.conversionUrl = conversionUrl.value;
  original.conversionFilename = conversionFilename.value;
  let saves = 0;
  const providers = ['spotify', 'youtube', 'appleMusic'];
  const names = ['Spotify', 'YouTube', 'Apple Music'];
  const tracks = [
    { name: 'Local', description: 'Local audio', audioDataUrl: 'data:audio/mpeg;base64,AA==', played: false },
    { name: 'Spotify fixture', description: 'Remote audio', spotifyUrl: 'https://open.spotify.com/track/abc', played: false },
    { name: 'YouTube fixture', description: 'Remote audio', youtubeUrl: 'https://www.youtube.com/watch?v=abcdefghijk', youtubeEmbedUrl: 'https://www.youtube.com/embed/abcdefghijk', played: false },
    { name: 'Apple Music fixture', description: 'External link', appleMusicUrl: 'https://music.apple.com/us/song/123', played: false }
  ];
  const response = (value, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json' }
  });
  const apply = (enabled) => controls.apply({ enabled, spotifyClientId: 'test-client', youtubeConfigured: true });
  const all = Object.fromEntries(providers.map((provider) => [provider, true]));
  try {
    refreshSharedCategories = async () => {};
    sharedCategories = [];
    savePlaylists = () => { saves += 1; };
    state.playlists = { mixed: tracks, 'remote-only': [tracks[1]], empty: [] };
    state.categorySizes = {};
    state.categorySettings = {};
    state.hiddenCategories = new Set();
    offlineModeToggleInput.checked = false;
    musicLibraryContent.classList.remove('hidden');
    settingsPanel.classList.remove('hidden');
    document.querySelector('.side-menu-list').classList.remove('hidden');
    const savedTracks = JSON.stringify(state.playlists);
    for (let mask = 0; mask < 8; mask += 1) {
      const enabled = Object.fromEntries(providers.map((provider, index) => [provider, Boolean(mask & (1 << index))]));
      apply(enabled);
      const cards = [...document.querySelectorAll('.track-button[data-category-key="mixed"]')];
      assert(cards.length === 1 + providers.filter((provider) => enabled[provider]).length, `Wrong card count for combination ${mask}`);
      assert(cards[0].dataset.index === '0', 'Local audio disappeared');
      providers.forEach((provider, index) => {
        assert(Boolean(cards.find((card) => card.dataset.index === String(index + 1))) === enabled[provider], `Wrong card indexes for ${provider}`);
        assert(isTrackIntegrationEnabled(tracks[index + 1]) === enabled[provider], `Wrong runtime guard for ${provider}`);
        if (!enabled[provider]) {
          assert(!document.body.innerText.includes(names[index]), `Disabled ${provider} is still visible`);
          const before = state.currentTrack;
          startCategoryTrack('mixed', index + 1, tracks[index + 1]);
          assert(state.currentTrack === before, 'Disabled source started playing');
        }
      });
      const conversionMenu = [...document.querySelectorAll('.side-menu-item')].find((button) => button.textContent === 'Playlist Conversion');
      assert((getComputedStyle(conversionMenu).display !== 'none') === Boolean(mask), 'Conversion menu visibility failed');
      assert((getComputedStyle(localMp3Source).display !== 'none') === (!mask || useLocalMp3Input.checked), 'Local-only UI failed');
      assert(buildExportRows('mixed', true).rows.length === cards.length, 'Export included disabled songs');
      assert(Boolean(document.querySelector('.playlist-column[data-category-key="remote-only"]')) === enabled.spotify, 'Disabled-only category remained visible');
      const next = getNextUnplayedTrack('mixed', tracks[0]);
      assert(next === null || isTrackPlayableHere(next.track), 'Autoplay selected disabled or external-only source');
      assert(JSON.stringify(state.playlists) === savedTracks && saves === 0, 'Toggling modified saved songs');
    }
    apply(all);
    assert(document.querySelectorAll('.track-button[data-category-key="mixed"]').length === 4, 'Re-enabling did not restore songs');
    let stops = 0;
    let timerClears = 0;
    stopActiveCustomPlayback = () => { stops += 1; };
    clearTrackPlaybackTimers = () => { timerClears += 1; };
    state.currentTrack = tracks[2];
    state.currentCategoryKey = 'mixed';
    state.currentTrackIndex = 2;
    apply({ ...all, youtube: false });
    assert(stops === 1 && timerClears === 1 && state.currentTrack === null
      && !tracks[2].played && saves === 0, 'Disabling active playback did not stop cleanly');
    state.currentTrack = tracks[0];
    apply(Object.fromEntries(providers.map((provider) => [provider, false])));
    assert(state.currentTrack === tracks[0] && stops === 1, 'Disabling online providers stopped local audio');
    state.currentTrack = null;
    let blockedRequests = 0;
    let downloads = 0;
    window.fetch = async () => { blockedRequests += 1; throw new Error('Unexpected provider request'); };
    downloadBlob = () => { downloads += 1; };
    for (const read of [getValidSpotifyAccessToken, fetchAppleMusicToken, () => fetchYouTubePlaylistTracks('PLtest')]) {
      let rejected = false;
      try { await read(); } catch (error) { rejected = error.message.includes('disabled'); }
      assert(rejected, 'Disabled provider reader did not reject');
    }
    conversionUrl.value = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
    conversionFilename.value = 'Blocked conversion';
    document.getElementById('convertPlaylist').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert(blockedRequests === 0 && downloads === 0 && saves === 0
      && conversionFilename.value === 'Blocked conversion', 'Disabled conversion made a request, download, or save');
    stopActiveCustomPlayback = original.stop;
    clearTrackPlaybackTimers = original.clearTimers;
    downloadBlob = original.download;
    apply(all);
    const proxyRequests = [];
    window.fetch = async (url) => {
      proxyRequests.push(url);
      if (url.includes('resource=playlistItems')) return response({ items: [
        { contentDetails: { videoId: 'abcdefghijk' }, snippet: { title: 'Video', videoOwnerChannelTitle: 'Artist' } }
      ] });
      return response({ items: [{ id: 'abcdefghijk', contentDetails: { duration: 'PT1M10S' } }] });
    };
    const videos = await fetchYouTubePlaylistTracks('PLtest', true);
    assert(videos[0].durationSeconds === 70 && proxyRequests.every((url) => url.startsWith('/api/youtube?') && !url.includes('key=')), 'Playlist requests exposed the key or skipped server proxy');
    window.fetch = async (url) => {
      if (url === '/api/admin/integrations') return response(controls.config());
      if (url === '/api/admin/users') return response({ users: [] });
      return response({ categories: [] });
    };
    document.getElementById('adminPanelLink').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const form = document.getElementById('adminIntegrationsForm');
    const fields = form.elements;
    assert(!document.getElementById('saveAdminIntegrations').disabled, 'Admin configuration did not load');
    for (const input of form.querySelectorAll('input')) {
      const bounds = input.getBoundingClientRect();
      if (bounds.width) assert(bounds.left >= 0 && bounds.right <= window.innerWidth, 'Admin input overflows the viewport');
    }
    let request;
    window.fetch = async (url, options) => {
      if (url === '/api/admin/integrations' && options?.method === 'PUT') {
        request = JSON.parse(options.body);
        return response({ enabled: request.enabled, spotifyClientId: request.spotifyClientId, youtubeConfigured: true });
      }
      return response({ categories: [] });
    };
    fields.appleMusicEnabled.checked = false;
    form.dispatchEvent(new Event('change', { bubbles: true }));
    assert(getComputedStyle(form.querySelector('[data-admin-integration="appleMusic"]')).display === 'none', 'Admin draft did not collapse setup section');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert(request.enabled.appleMusic === false && !Object.hasOwn(request, 'youtubeApiKey'), 'Blank key replacement would erase shared key');
    assert(!controls.enabled('appleMusic'), 'Admin save did not apply immediately');
    fields.youtubeApiKey.value = 'temporary-test-key';
    fields.clearYoutubeKey.checked = false;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert(request.youtubeApiKey === 'temporary-test-key' && fields.youtubeApiKey.value === '', 'Shared key replacement did not clear input');
    fields.clearYoutubeKey.checked = true;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert(request.youtubeApiKey === '' && !fields.clearYoutubeKey.checked, 'Explicit shared-key removal failed');
    window.fetch = async () => response({ error: 'Test save rejection' }, 403);
    fields.spotifyEnabled.checked = false;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert(controls.enabled('spotify') && document.getElementById('adminIntegrationStatus').textContent === 'Test save rejection', 'Failed save changed global configuration');
    return { passed: true, combinations: 8, disabledReferencesHidden: true, localAudioPreserved: true,
      songDataUnchanged: true, categoryIndexes: true, adminSaving: true, secretReplacement: true, errors: true };
  } finally {
    window.fetch = original.fetch;
    refreshSharedCategories = async () => {};
    state.playlists = original.playlists;
    state.categorySizes = original.sizes;
    state.categorySettings = original.settings;
    state.hiddenCategories = original.hidden;
    sharedCategories = original.shared;
    savePlaylists = original.save;
    state.currentTrack = original.current;
    state.songEditor = original.editor;
    Object.assign(state, original.playback);
    stopActiveCustomPlayback = original.stop;
    clearTrackPlaybackTimers = original.clearTimers;
    downloadBlob = original.download;
    offlineModeToggleInput.checked = original.offline;
    controls.apply(original.config);
    if (original.cache === null) localStorage.removeItem('hs-app-integrations-v1');
    else localStorage.setItem('hs-app-integrations-v1', original.cache);
    musicLibraryContent.classList.toggle('hidden', original.library);
    settingsPanel.classList.toggle('hidden', original.settingsHidden);
    document.querySelector('.side-menu-list').classList.toggle('hidden', original.menuHidden);
    document.getElementById('adminOverlay').classList.add('hidden');
    document.getElementById('adminIntegrationStatus').textContent = '';
    original.adminFields.forEach(({ element, value, checked, disabled }) => {
      element.value = value;
      element.checked = checked;
      element.disabled = disabled;
    });
    document.getElementById('integrationNotice').hidden = original.noticeHidden;
    conversionUrl.value = original.conversionUrl;
    conversionFilename.value = original.conversionFilename;
    refreshSharedCategories = original.refresh;
    renderBoard();
    setStatus('Ready for the next shift.');
  }
}
