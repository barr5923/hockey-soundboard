async function runStopPlaybackBrowserTests() {
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const keys = ['playlists', 'currentTrack', 'currentCategoryKey', 'currentTrackIndex',
    'currentTrackElapsedMs', 'currentTrackStartedAt', 'currentTrackDurationSeconds',
    'customType', 'customSource', 'customDuration', 'autoTransitioning',
    'pendingFadeInSeconds', 'isPaused', 'spectrogramTimer', 'playedThresholdTimer',
    'autoAdvanceTimer', 'autoTransitionTimer', 'autoFadeInterval'];
  const original = Object.fromEntries(keys.map((key) => [key, state[key]]));
  const save = savePlaylists;
  const render = renderBoard;
  const ramp = rampPlaybackGain;
  const controller = spotifyEmbedController;
  let pauses = 0;
  let advances = 0;
  let saves = 0;
  try {
    savePlaylists = () => { saves += 1; };
    renderBoard = () => {};
    rampPlaybackGain = () => {};
    spotifyEmbedController = { pause: () => { pauses += 1; } };
    for (const [elapsed, repeatable, paused, expected] of [
      [6999, false, false, false], [7000, false, false, true],
      [8000, true, false, false], [6999, false, true, false],
      [7000, false, true, true]
    ]) {
      const track = { name: 'Stop fixture', played: false, repeatable };
      state.playlists = { 'stop-test': [track] };
      state.currentTrack = track;
      state.currentCategoryKey = 'stop-test';
      state.currentTrackIndex = 0;
      state.currentTrackElapsedMs = elapsed;
      state.currentTrackStartedAt = 0;
      state.currentTrackDurationSeconds = 180;
      state.isPaused = paused;
      state.customType = 'spotify';
      state.autoTransitioning = true;
      state.spectrogramTimer = null;
      state.playedThresholdTimer = null;
      state.autoFadeInterval = null;
      state.autoAdvanceTimer = setTimeout(() => { advances += 1; }, 20);
      state.autoTransitionTimer = setTimeout(() => { advances += 1; }, 20);
      document.getElementById('stopPlayback').click();
      assert(track.played === expected, `7-second rule failed at ${elapsed}ms`);
      assert(state.currentTrack === null && state.customType === null
        && state.currentCategoryKey === null && state.currentTrackStartedAt === 0
        && !state.autoTransitioning && !state.autoAdvanceTimer && !state.autoTransitionTimer,
      'Stop left playback or autoplay state active');
      assert(state.isPaused === paused, 'Stop changed pause state');
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert(advances === 0 && pauses === 5 && saves === 2, 'Stop failed to cancel timers or preserve played state');
    const track = { name: 'Local fixture', played: false };
    state.playlists = { 'stop-test': [track] };
    state.currentTrack = track;
    state.currentTrackElapsedMs = 0;
    state.customType = 'file';
    customAudio.src = 'sounds/Default_Horn.wav';
    stopMusicPlayback();
    assert(customAudio.paused && !customAudio.getAttribute('src')
      && customAudio.onended === null && customAudio.onloadedmetadata === null,
    'Local media was not stopped and detached');
    return { passed: true, threshold6999: true, threshold7000: true,
      repeatable: true, pausedTime: true, autoplayCancelled: true,
      spotifyStopped: true, localAudioStopped: true, noResumeSource: true };
  } finally {
    Object.assign(state, original);
    savePlaylists = save;
    renderBoard = render;
    rampPlaybackGain = ramp;
    spotifyEmbedController = controller;
    renderBoard();
    setStatus('Ready for the next shift.');
  }
}
