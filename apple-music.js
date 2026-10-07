function parseAppleMusicUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'music.apple.com' || url.username || url.password) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const [storefront, type] = parts;
    if (!/^[a-z]{2}$/i.test(storefront || '')) return null;
    const id = parts[parts.length - 1];
    if (type === 'playlist' && /^pl\.[a-z0-9.-]+$/i.test(id)) {
      return { type: 'playlist', storefront: storefront.toLowerCase(), id, url: url.href };
    }
    const songId = type === 'album' ? url.searchParams.get('i') : type === 'song' ? id : '';
    if (/^\d+$/.test(songId || '')) {
      return { type: 'song', storefront: storefront.toLowerCase(), id: songId, url: url.href };
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchAppleMusicToken() {
  window.SoundboardIntegrations.require('appleMusic');
  if (!/^https?:$/.test(window.location.protocol)) {
    throw new Error('Apple Music imports require the soundboard server, not a file preview.');
  }
  const response = await fetch('/api/apple-music/token', { credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 404) {
    throw new Error('Restart the soundboard server to enable the new Apple Music endpoint, then configure Apple Developer credentials.');
  }
  if (!(response.headers.get('Content-Type') || '').includes('application/json')) {
    throw new Error('Restart the soundboard server with Apple Music support and configured Apple Developer credentials.');
  }
  const payload = await response.json();
  if (!response.ok || !payload.token) {
    throw new Error(payload.error || 'The server could not provide an Apple Music developer token.');
  }
  return payload.token;
}

async function fetchAppleMusicPlaylistTracks(playlist) {
  const token = await fetchAppleMusicToken();
  const basePath = `/v1/catalog/${playlist.storefront}/playlists/${encodeURIComponent(playlist.id)}/tracks`;
  let next = `https://api.music.apple.com${basePath}?limit=100`;
  const visited = new Set();
  const tracks = [];
  while (next) {
    window.SoundboardIntegrations.require('appleMusic');
    const url = new URL(next, 'https://api.music.apple.com');
    if (url.origin !== 'https://api.music.apple.com' || url.pathname !== basePath || visited.has(url.href)) {
      throw new Error('Apple Music returned an invalid playlist continuation link.');
    }
    visited.add(url.href);
    const response = await fetch(url.href, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      const messages = {
        401: 'Apple Music rejected the developer token. Check the server Apple credentials.',
        403: 'Apple Music denied access to this playlist.',
        404: 'This Apple Music playlist is unavailable in the linked region or is private. Use a public playlist link.',
        429: 'Apple Music request limit reached. Please try again later.'
      };
      throw new Error(messages[response.status] || `Apple Music playlist request failed (${response.status}).`);
    }
    const payload = await response.json();
    window.SoundboardIntegrations.require('appleMusic');
    if (!Array.isArray(payload.data)) throw new Error('Apple Music returned an invalid playlist response.');
    for (const entry of payload.data) {
      if (entry.type !== 'songs') continue;
      const attributes = entry.attributes;
      if (!attributes?.name || !attributes.artistName || !/^\d+$/.test(entry.id)) {
        throw new Error('Apple Music returned incomplete song metadata; no partial import was saved.');
      }
      const songUrl = parseAppleMusicUrl(attributes.url);
      tracks.push({
        name: attributes.name,
        artist: attributes.artistName,
        description: attributes.artistName,
        durationSeconds: Number.isFinite(Number(attributes.durationInMillis)) && Number(attributes.durationInMillis) > 0
          ? Math.ceil(Number(attributes.durationInMillis) / 1000) : 0,
        sourceUrl: songUrl?.type === 'song' ? songUrl.url
          : `https://music.apple.com/${playlist.storefront}/song/${entry.id}`
      });
    }
    next = payload.next || '';
  }
  return tracks;
}
