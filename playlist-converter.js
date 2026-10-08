(() => {
  const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';
  const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube';
  const dialog = document.getElementById('playlistConverterDialog');
  if (!dialog) return;
  document.body.appendChild(dialog);
  const urlInput = document.getElementById('playlistConverterUrl');
  const nameInput = document.getElementById('playlistConverterName');
  const privacySelect = document.getElementById('playlistConverterPrivacy');
  const runButton = document.getElementById('runPlaylistConverter');
  const closeButton = document.getElementById('closePlaylistConverter');
  const status = document.getElementById('playlistConverterStatus');
  const setupNote = document.getElementById('playlistConverterSetup');
  const result = document.getElementById('playlistConverterResult');
  const resultLink = document.getElementById('playlistConverterLink');
  const missingSection = document.getElementById('playlistConverterMissing');
  const missingRows = document.getElementById('playlistConverterMissingRows');
  const csvNameInput = document.getElementById('playlistConverterCsvName');
  const csvButton = document.getElementById('downloadPlaylistConverterCsv');

  let googleScriptPromise = null;
  let googleToken = null;
  let running = false;
  let stopRequested = false;
  let missing = [];
  let lastPlaylistName = '';

  const integrations = () => window.SoundboardIntegrations;
  const available = () => integrations().enabled('spotify') && integrations().enabled('youtube');
  const googleClientId = () => integrations().config().googleClientId || '';

  const list = document.getElementById('sideMenuList');
  const toggle = document.querySelector('.side-menu-toggle');
  const menuItem = document.createElement('button');
  menuItem.type = 'button';
  menuItem.className = 'side-menu-item';
  menuItem.textContent = 'Playlist Converter';
  const conversionItem = [...list.querySelectorAll('.side-menu-item')].find((item) => item.textContent === 'Playlist Conversion');
  if (conversionItem) conversionItem.after(menuItem);
  else list.prepend(menuItem);

  function syncAvailability() {
    menuItem.toggleAttribute('data-integration-disabled', !available());
    setupNote.hidden = Boolean(googleClientId());
    if (!available() && !dialog.classList.contains('hidden')) dismiss();
  }

  function loadGoogleScript() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (!googleScriptPromise) {
      googleScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => {
          googleScriptPromise = null;
          script.remove();
          reject(new Error('Google sign-in could not be loaded. Check your internet connection and try again.'));
        };
        document.head.appendChild(script);
      });
    }
    return googleScriptPromise;
  }

  // Must be called synchronously from the click so the Google popup is not blocked.
  function requestGoogleToken() {
    if (googleToken && googleToken.clientId === googleClientId() && Date.now() < googleToken.expiresAt - 120000) {
      return Promise.resolve(googleToken.value);
    }
    if (!window.google?.accounts?.oauth2) {
      return Promise.reject(new Error('Google sign-in is still loading. Please click Convert again.'));
    }
    return new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: googleClientId(),
        scope: YOUTUBE_SCOPE,
        callback: (response) => {
          if (response.error || !response.access_token) {
            reject(new Error(`Google sign-in failed: ${response.error_description || response.error || 'no access was granted'}.`));
            return;
          }
          if (!window.google.accounts.oauth2.hasGrantedAllScopes(response, YOUTUBE_SCOPE)) {
            reject(new Error('Allow the soundboard to manage your YouTube account so it can create the playlist.'));
            return;
          }
          googleToken = {
            value: response.access_token,
            clientId: googleClientId(),
            expiresAt: Date.now() + (Number(response.expires_in) || 3600) * 1000
          };
          resolve(googleToken.value);
        },
        error_callback: (error) => {
          reject(new Error(error?.type === 'popup_closed'
            ? 'Google sign-in was closed before finishing.'
            : 'Google sign-in could not open. Allow pop-ups for this site and try again.'));
        }
      });
      client.requestAccessToken();
    });
  }

  class YouTubeError extends Error {
    constructor(message, reason, fatal) {
      super(message);
      this.reason = reason;
      this.fatal = fatal;
    }
  }

  async function youtube(method, path, params, body) {
    const response = await fetch(`${YOUTUBE_API}/${path}?${new URLSearchParams(params)}`, {
      method,
      headers: {
        Authorization: `Bearer ${googleToken.value}`,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return payload;
    const reason = payload?.error?.errors?.[0]?.reason || '';
    const detail = payload?.error?.message || `HTTP ${response.status}`;
    if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded/.test(reason)) {
      throw new YouTubeError('YouTube daily limit reached. Try the remaining songs tomorrow.', 'quota', true);
    }
    if (response.status === 401) {
      googleToken = null;
      if (reason === 'youtubeSignupRequired') {
        throw new YouTubeError('Your Google account needs a YouTube channel. Create one on youtube.com and try again.', reason, true);
      }
      throw new YouTubeError('Google sign-in expired. Click Convert to sign in again.', 'auth', true);
    }
    if (response.status === 403 && /forbidden|insufficientPermissions|accessNotConfigured/.test(reason)) {
      throw new YouTubeError(`YouTube refused the request: ${detail}`, reason, true);
    }
    throw new YouTubeError(detail, reason || String(response.status), false);
  }

  function normalize(text) {
    return String(text || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function cleanSongName(name) {
    return String(name || '')
      .replace(/\s*[([][^)\]]*[)\]]/g, '')
      .replace(/\s+-\s+.*$/, '')
      .trim() || String(name || '');
  }

  function tokens(text) {
    return normalize(text).split(' ').filter((word) => word.length > 1 || /\d/.test(word));
  }

  function isLikelyMatch(track, item) {
    const haystack = ` ${normalize(`${item.snippet?.title || ''} ${item.snippet?.channelTitle || ''}`)} `;
    const nameWords = tokens(cleanSongName(track.name));
    if (!nameWords.length) return true;
    const found = nameWords.filter((word) => haystack.includes(` ${word} `)).length;
    const ratio = found / nameWords.length;
    if (ratio < 0.6) return false;
    const artistWords = tokens(String(track.artist || '').split(',')[0]);
    const artistFound = artistWords.some((word) => haystack.includes(` ${word} `));
    return artistFound || !artistWords.length || (ratio === 1 && nameWords.length >= 2);
  }

  async function findVideo(track) {
    const firstArtist = String(track.artist || '').split(',')[0].trim();
    const payload = await youtube('GET', 'search', {
      part: 'snippet',
      type: 'video',
      maxResults: '5',
      q: `${firstArtist} ${cleanSongName(track.name)}`.trim()
    });
    return (payload.items || []).find((item) => item.id?.videoId && isLikelyMatch(track, item)) || null;
  }

  async function spotifyPlaylistName(playlistId) {
    try {
      const token = await getValidSpotifyAccessToken();
      const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}?fields=name`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) return (await response.json()).name || '';
    } catch (error) {
      console.warn('Could not read the Spotify playlist name.', error);
    }
    return '';
  }

  function renderMissing() {
    missingRows.textContent = '';
    missing.forEach((track) => {
      const row = document.createElement('tr');
      [track.artist || '', track.name, track.durationSeconds ? formatTimecode(track.durationSeconds) : '', track.reason]
        .forEach((value, index) => {
          const cell = document.createElement(index === 1 ? 'th' : 'td');
          if (index === 1) cell.scope = 'row';
          if (index === 1 && track.sourceUrl) {
            const link = document.createElement('a');
            link.href = track.sourceUrl;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = value;
            cell.appendChild(link);
          } else {
            cell.textContent = value;
          }
          row.appendChild(cell);
        });
      missingRows.appendChild(row);
    });
    missingSection.hidden = !missing.length;
  }

  function missingCsv() {
    const quote = (value) => {
      const text = String(value ?? '');
      const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const rows = missing.map((track) => [
      track.artist || '',
      track.durationSeconds ? formatTimecode(track.durationSeconds) : '',
      track.name,
      track.sourceUrl || '',
      track.reason
    ]);
    return [['Artist', 'Length (min:sec)', 'Song Name', 'Song Link', 'Reason'], ...rows]
      .map((row) => row.map(quote).join(',')).join('\r\n');
  }

  function setRunning(value) {
    running = value;
    runButton.textContent = value ? 'Stop converting' : 'Convert to YouTube';
    runButton.classList.toggle('secondary', value);
    [urlInput, nameInput, privacySelect].forEach((input) => { input.disabled = value; });
  }

  async function convert() {
    if (!googleClientId()) {
      status.textContent = 'The administrator must add a Google OAuth Client ID in the Admin panel first.';
      return;
    }
    let spotify = null;
    try {
      const url = new URL(urlInput.value.trim());
      if (url.hostname === 'open.spotify.com') spotify = parseSpotifyUrl(url.href);
    } catch (error) {
      spotify = urlInput.value.trim().startsWith('spotify:') ? parseSpotifyUrl(urlInput.value) : null;
    }
    if (spotify?.type !== 'playlist') {
      status.textContent = 'Paste a Spotify playlist link, for example https://open.spotify.com/playlist/...';
      urlInput.focus();
      return;
    }

    const tokenRequest = requestGoogleToken();
    setRunning(true);
    stopRequested = false;
    missing = [];
    renderMissing();
    result.hidden = true;
    status.textContent = 'Waiting for Google sign-in...';
    let added = 0;
    let tracks = [];
    try {
      await tokenRequest;
      integrations().require('spotify');
      integrations().require('youtube');
      status.textContent = 'Reading the Spotify playlist...';
      const [trackList, spotifyName] = await Promise.all([
        fetchSpotifyPlaylistTracks(spotify.id),
        nameInput.value.trim() ? Promise.resolve('') : spotifyPlaylistName(spotify.id)
      ]);
      tracks = trackList;
      if (!tracks.length) throw new Error('No accessible songs were found in this Spotify playlist.');
      const title = (nameInput.value.trim() || spotifyName || 'Converted Spotify playlist').slice(0, 150);
      lastPlaylistName = title;

      let playlistId = '';
      for (let index = 0; index < tracks.length; index += 1) {
        const track = tracks[index];
        if (stopRequested) {
          missing.push(...tracks.slice(index).map((item) => ({ ...item, reason: 'Skipped (conversion stopped)' })));
          break;
        }
        status.textContent = `Searching YouTube ${index + 1} of ${tracks.length}: ${track.name}`;
        try {
          integrations().require('youtube');
          const video = await findVideo(track);
          if (!video) {
            missing.push({ ...track, reason: 'No matching YouTube video found' });
            renderMissing();
            continue;
          }
          if (!playlistId) {
            const created = await youtube('POST', 'playlists', { part: 'snippet,status' }, {
              snippet: { title, description: 'Converted from Spotify with the Hockey Soundboard.' },
              status: { privacyStatus: privacySelect.value }
            });
            playlistId = created.id;
            resultLink.href = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
            result.hidden = false;
          }
          await youtube('POST', 'playlistItems', { part: 'snippet' }, {
            snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId: video.id.videoId } }
          });
          added += 1;
        } catch (error) {
          if (error instanceof YouTubeError && error.fatal) {
            missing.push(...tracks.slice(index).map((item) => ({
              ...item,
              reason: error.reason === 'quota' ? 'Skipped (YouTube daily limit reached)' : `Skipped (${error.message})`
            })));
            renderMissing();
            throw error;
          }
          if (!(error instanceof YouTubeError)) throw error;
          missing.push({ ...track, reason: `YouTube error: ${error.message}` });
        }
        renderMissing();
      }
      renderMissing();
      status.textContent = `Added ${added} of ${tracks.length} songs to "${title}" on YouTube.${missing.length ? ` ${missing.length} songs were not added; see the table below.` : ''}`;
    } catch (error) {
      console.error('Playlist converter failed.', error);
      renderMissing();
      const progress = tracks.length ? ` Added ${added} of ${tracks.length} songs before stopping.` : '';
      status.textContent = available()
        ? `${error.message || 'Playlist conversion failed. Please try again.'}${progress}`
        : `This music integration was disabled during conversion.${progress}`;
    } finally {
      setRunning(false);
    }
  }

  function dismiss() {
    dialog.classList.add('hidden');
    toggle?.focus();
  }

  menuItem.addEventListener('click', () => {
    list.classList.add('hidden');
    toggle?.setAttribute('aria-expanded', 'false');
    if (!available()) return;
    syncAvailability();
    dialog.classList.remove('hidden');
    urlInput.focus();
    if (googleClientId()) loadGoogleScript().catch((error) => { status.textContent = error.message; });
  });
  runButton.addEventListener('click', () => {
    if (running) {
      stopRequested = true;
      status.textContent = 'Stopping after the current song...';
      return;
    }
    convert();
  });
  csvButton.addEventListener('click', () => {
    if (!missing.length) return;
    const raw = csvNameInput.value.trim() || `${lastPlaylistName || 'Playlist'} - songs not found`;
    const safe = raw.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').replace(/[.\s]+$/, '') || 'Songs not found';
    downloadBlob(new Blob([`\uFEFF${missingCsv()}`], { type: 'text/csv;charset=utf-8' }), /\.csv$/i.test(safe) ? safe : `${safe}.csv`);
  });
  closeButton.addEventListener('click', dismiss);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dismiss();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
    } else if (event.key === 'Tab') {
      const controls = Array.from(dialog.querySelectorAll('button, input, select, a[href], [tabindex="0"]'))
        .filter((element) => !element.disabled && element.offsetParent !== null);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  document.addEventListener('integrations-changed', syncAvailability);
  syncAvailability();
  window.SoundboardIntegrations.ready?.then(syncAvailability);
})();
