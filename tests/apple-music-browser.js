async function runAppleMusicBrowserTests() {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const playlistUrl = 'https://music.apple.com/us/playlist/test/pl.test';
  const playlist = parseAppleMusicUrl(playlistUrl);
  assert(playlist?.type === 'playlist' && playlist.storefront === 'us', 'Playlist parsing failed');
  assert(parseAppleMusicUrl('https://music.apple.com/ca/album/test/10?i=20')?.id === '20', 'Album song parsing failed');
  for (const bad of ['https://music.apple.com.evil.test/us/playlist/test/pl.test', 'http://music.apple.com/us/playlist/test/pl.test', 'https://music.apple.com/us/library/playlist/p.test']) {
    assert(parseAppleMusicUrl(bad) === null, 'Invalid Apple URL accepted');
  }

  async function runAppleMusicIntegrationTests() {
    const assert = (condition, message) => {
      if (!condition) throw new Error(message);
    };
    const original = {
      playlists: state.playlists, settings: state.categorySettings, sizes: state.categorySizes,
      fetchTracks: fetchAppleMusicPlaylistTracks, save: savePlaylists, render: renderBoard,
      download: downloadBlob, open: window.open, spreadsheet: loadSpreadsheetLibrary
    };
    const playlist = parseAppleMusicUrl('https://music.apple.com/us/playlist/test/pl.test');
    const track = { name: '<b>Song</b>', description: 'Artist', artist: 'Artist',
      durationSeconds: 123, sourceUrl: 'https://music.apple.com/us/album/test/10?i=20' };
    const captures = [];
    const filenameInput = document.getElementById('playlistConversionFilename');
    const urlInput = document.getElementById('playlistConversionUrl');
    let opened = '';
    try {
      state.playlists = { 'apple-test': [], 'copy-test': [] };
      state.categorySettings = {};
      state.categorySizes = {};
      fetchAppleMusicPlaylistTracks = async () => [track];
      savePlaylists = () => {};
      renderBoard = () => {};
      musicCategorySelect.appendChild(new Option('Apple test', 'apple-test'));
      musicCategorySelect.value = 'apple-test';
      await importAppleMusicPlaylist(playlist);
      const imported = state.playlists['apple-test'][0];
      assert(imported?.appleMusicUrl === track.sourceUrl && imported.durationSeconds === 123, 'Category import failed');
      assert(getNextUnplayedTrack('apple-test', null) === null, 'Autoplay selected Apple Music');
      const previousCurrent = state.currentTrack;
      startCategoryTrack('apple-test', 0, imported);
      assert(state.currentTrack === previousCurrent, 'Apple Music started soundboard playback');
      original.render();
      const card = document.querySelector('.track-button[data-category-key="apple-test"]');
      assert(card && card.textContent.includes('Open in Apple Music') && !card.querySelector('b'), 'Card rendering/escaping failed');
      window.open = (url) => { opened = url; };
      card.click();
      assert(opened === track.sourceUrl && !imported.played, 'Open link mutated played state');
      shareCategorySelect.value = 'apple-test';
      assert(buildExportRows('apple-test', true).rows[0][6] === track.sourceUrl, 'Category export lost Apple source');
      openSongEditor('apple-test', 0);
      assert(editSongLinkInput.value === track.sourceUrl, 'Editor lost source');
      copySongCategorySelect.value = 'copy-test';
      copySongToCategory();
      assert(state.playlists['copy-test'][0].appleMusicUrl === track.sourceUrl, 'Copy lost Apple source');
      openSongEditor('apple-test', 0);
      saveSongEdits();
      assert(imported.appleMusicUrl === track.sourceUrl && !imported.youtubeUrl && !imported.spotifyUrl, 'Editor save changed provider');
      downloadBlob = (blob, filename) => captures.push({ blob, filename });
      urlInput.value = playlist.url;
      filenameInput.value = 'Apple warmups';
      document.getElementById('convertPlaylist').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert(captures[0]?.filename === 'Apple warmups.csv', 'CSV filename failed');
      assert((await captures[0].blob.text()).includes(track.sourceUrl), 'CSV lost individual link');
      assert(urlInput.value === '' && filenameInput.value === '', 'CSV fields did not clear');
      fetchAppleMusicPlaylistTracks = async () => { throw new Error('Test playlist page failure'); };
      const before = JSON.stringify(state.playlists);
      musicCategorySelect.value = 'apple-test';
      await importAppleMusicPlaylist(playlist);
      assert(JSON.stringify(state.playlists) === before && !addMusicButton.disabled, 'Failed import changed categories');
      urlInput.value = playlist.url;
      filenameInput.value = 'Keep this';
      document.getElementById('convertPlaylist').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert(captures.length === 1 && filenameInput.value === 'Keep this', 'Failed CSV downloaded or cleared input');
      fetchAppleMusicPlaylistTracks = async () => [track];
      loadSpreadsheetLibrary = async () => ({
        read: () => ({ SheetNames: ['Tracks'], Sheets: { Tracks: {} } }),
        utils: { sheet_to_json: () => [
          ['Category', 'Song Name', 'Source'], ['Spreadsheet test', 'Saved Apple song', track.sourceUrl],
          ['Spreadsheet test', '', playlist.url]
        ] }
      });
      await importSpreadsheetFile({ arrayBuffer: async () => new ArrayBuffer(0) });
      assert(state.playlists['spreadsheet-test'].length === 2
        && state.playlists['spreadsheet-test'].every((item) => item.appleMusicUrl === track.sourceUrl), 'Spreadsheet round trip failed');
      savePlaylists = () => { throw new Error('Test storage failure'); };
      const previous = JSON.stringify(state.playlists);
      musicCategorySelect.value = 'apple-test';
      await importAppleMusicPlaylist(playlist);
      assert(JSON.stringify(state.playlists) === previous, 'Storage failure did not roll back import');
      return { passed: true, import: true, externalLinks: true, autoplaySkip: true,
        editCopyExport: true, csv: true, errors: true, spreadsheet: true, storageRollback: true };
    } finally {
      state.playlists = original.playlists;
      state.categorySettings = original.settings;
      state.categorySizes = original.sizes;
      fetchAppleMusicPlaylistTracks = original.fetchTracks;
      savePlaylists = original.save;
      renderBoard = original.render;
      downloadBlob = original.download;
      window.open = original.open;
      loadSpreadsheetLibrary = original.spreadsheet;
      musicUrlInput.value = '';
      filenameInput.value = '';
      urlInput.value = '';
      document.getElementById('playlistConversionStatus').textContent = '';
      closeSongEditor();
      original.render();
      setStatus('Ready for the next shift.');
    }
  }
  const originalConfiguration = window.SoundboardIntegrations.config();
  const originalConfigurationCache = localStorage.getItem('hs-app-integrations-v1');
  const originalRefresh = refreshSharedCategories;
  refreshSharedCategories = async () => {};
  window.SoundboardIntegrations.apply({
    enabled: { spotify: true, youtube: true, appleMusic: true },
    spotifyClientId: 'test-client', youtubeConfigured: true
  });
  const originalFetch = window.fetch;
  const requests = [];
  const response = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status, headers: { 'Content-Type': 'application/json' }
  });
  const song = (id, name, durationInMillis) => ({
    id, type: 'songs', attributes: { name, artistName: 'Artist, Two', durationInMillis,
      url: `https://music.apple.com/us/album/test/10?i=${id}` }
  });
  try {
    window.fetch = async (url, options) => {
      requests.push({ url, options });
      if (url === '/api/apple-music/token') return response({ token: 'test-token' });
      if (url.includes('offset=100')) return response({ data: [song('2', 'Second', undefined)] });
      return response({
        data: [song('1', 'Song "One"', 123456), { type: 'music-videos', id: '3' }],
        next: '/v1/catalog/us/playlists/pl.test/tracks?offset=100'
      });
    };
    const tracks = await fetchAppleMusicPlaylistTracks(playlist);
    assert(tracks.length === 2 && tracks[0].durationSeconds === 124 && tracks[1].durationSeconds === 0, 'Pagination/durations failed');
    assert(requests.length === 3 && requests[1].options.headers.Authorization === 'Bearer test-token', 'Token request failed');
    const csv = buildPlaylistConversionCsv(tracks, false);
    assert(csv.includes('"Artist, Two","02:04","Song ""One"""') && csv.includes('?i=1'), 'CSV metadata/escaping failed');
    for (const status of [401, 403, 404, 429, 500]) {
      window.fetch = async (url) => url === '/api/apple-music/token'
        ? response({ token: 'test-token' }) : response({}, status);
      let failed = false;
      try { await fetchAppleMusicPlaylistTracks(playlist); } catch { failed = true; }
      assert(failed, `HTTP ${status} did not abort`);
    }
    window.fetch = async (url) => url === '/api/apple-music/token'
      ? response({ token: 'test-token' })
      : response({ data: [song('1', 'Song', 1000)], next: 'https://example.com/tracks' });
    let badNextFailed = false;
    try { await fetchAppleMusicPlaylistTracks(playlist); } catch { badNextFailed = true; }
    assert(badNextFailed, 'Unsafe continuation link accepted');
    window.fetch = async (url) => {
      if (url === '/api/apple-music/token') return response({ token: 'test-token' });
      if (url.includes('offset=100')) return response({}, 500);
      return response({ data: [song('1', 'Song', 1000)],
        next: '/v1/catalog/us/playlists/pl.test/tracks?offset=100' });
    };
    let secondPageFailed = false;
    try { await fetchAppleMusicPlaylistTracks(playlist); } catch { secondPageFailed = true; }
    assert(secondPageFailed, 'A failed second page returned a partial playlist');
    window.fetch = async () => response({ error: 'Not found' }, 404);
    let restartMessage = '';
    try { await fetchAppleMusicToken(); } catch (error) { restartMessage = error.message; }
    assert(restartMessage.includes('Restart'), 'Outdated server needs an actionable error');
    window.fetch = async () => response({ error: 'Apple Music is not configured.' }, 503);
    let setupMessage = '';
    try { await fetchAppleMusicPlaylistTracks(playlist); } catch (error) { setupMessage = error.message; }
    assert(setupMessage.includes('not configured'), 'Configuration error not shown');
    const appleTrack = { appleMusicUrl: tracks[0].sourceUrl, name: 'Apple track', played: false };
    assert(!isTrackPlayableHere(appleTrack) && !isTrackAvailableOffline(appleTrack), 'Link-only track treated as playable/offline');
    assert(isTrackPlayableHere({ spotifyUrl: 'https://open.spotify.com/track/test' }), 'Spotify behavior changed');
    assert(isTrackPlayableHere({ audioStorageId: 'test' }) && isTrackAvailableOffline({ audioStorageId: 'test' }), 'MP3 behavior changed');
    window.fetch = originalFetch;
    return { passed: true, pagination: true, csv: true, providerErrors: true, linkOnly: true,
      integration: await runAppleMusicIntegrationTests() };
  } finally {
    window.fetch = originalFetch;
    window.SoundboardIntegrations.apply(originalConfiguration);
    if (originalConfigurationCache === null) localStorage.removeItem('hs-app-integrations-v1');
    else localStorage.setItem('hs-app-integrations-v1', originalConfigurationCache);
    refreshSharedCategories = originalRefresh;
  }
}
