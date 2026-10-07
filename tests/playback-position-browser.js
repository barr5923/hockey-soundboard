function runPlaybackPositionBrowserTests() {
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const keys = ['playlists', 'currentTrack', 'currentTrackElapsedMs',
    'currentTrackStartedAt', 'customType', 'isPaused'];
  const original = Object.fromEntries(keys.map((key) => [key, state[key]]));
  const originalPlayer = youtubeApiPlayer;
  const originalReady = youtubeApiReady;
  const track = { startTime: 30, spotifyUrl: 'https://open.spotify.com/track/test' };
  const button = document.createElement('button');
  button.className = 'track-button';
  button.dataset.categoryKey = 'position-test';
  button.dataset.index = '0';
  button.appendChild(createTrackSourceBadge(track));
  document.body.appendChild(button);
  const timestamp = button.querySelector('.track-position');
  try {
    state.playlists = { 'position-test': [track] };
    state.currentTrack = track;
    state.currentTrackElapsedMs = 9000;
    state.currentTrackStartedAt = 0;
    state.customType = 'spotify';
    syncTrackPlaybackPosition();
    assert(!timestamp.hidden && timestamp.textContent === '00:39',
      'Timestamp did not include clip start offset');
    state.isPaused = true;
    syncTrackPlaybackPosition();
    assert(timestamp.textContent === '00:39' && !timestamp.hidden, 'Paused position changed');
    state.customType = 'youtube';
    youtubeApiReady = true;
    youtubeApiPlayer = { getCurrentTime: () => 65.9 };
    syncTrackPlaybackPosition();
    assert(timestamp.textContent === '01:05', 'YouTube position did not use player time');
    state.customType = 'file';
    syncTrackPlaybackPosition();
    assert(timestamp.textContent === formatTimecode(Math.floor(customAudio.currentTime)),
      'Local audio position did not use player time');
    state.currentTrack = null;
    syncTrackPlaybackPosition();
    assert(timestamp.hidden && !timestamp.parentElement.classList.contains('has-position'),
      'Timestamp remained after playback stopped');
    return { passed: true, startOffset: true, pause: true, youtube: true,
      localAudio: true, hiddenWhenStopped: true };
  } finally {
    button.remove();
    Object.assign(state, original);
    youtubeApiPlayer = originalPlayer;
    youtubeApiReady = originalReady;
    syncTrackPlaybackPosition();
  }
}
