async function runClipPlaybackBrowserTests() {
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const keys = ['currentTrack', 'customType', 'currentTrackElapsedMs',
    'currentTrackStartedAt', 'currentTrackDurationSeconds', 'isPaused', 'spectrogramTimer',
    'currentCategoryKey', 'currentTrackIndex', 'categorySettings', 'autoTransitioning',
    'playedThresholdTimer', 'autoAdvanceTimer', 'autoTransitionTimer', 'autoFadeInterval'];
  const original = Object.fromEntries(keys.map((key) => [key, state[key]]));
  const functions = {
    completion: scheduleCurrentTrackCompletion, threshold: schedulePlayedThreshold,
    advance: syncCurrentAutoplaySchedule, finish: finishCurrentTrack,
    save: savePlaylists, render: renderBoard, timeout: window.setTimeout,
    mark: markCurrentTrackPlayed, ramp: rampPlaybackGain, controller: spotifyEmbedController
  };
  const track = { startTime: 30, stopTime: 40, durationSeconds: 180 };
  let finishes = 0;
  let delay = null;
  let callback;
  try {
    state.currentTrack = track;
    state.customType = 'spotify';
    state.isPaused = false;
    state.spectrogramTimer = null;
    schedulePlayedThreshold = () => {};
    syncCurrentAutoplaySchedule = () => {};
    savePlaylists = () => {};
    renderBoard = () => {};
    finishCurrentTrack = (finished) => {
      assert(finished === track, 'Finished the wrong track');
      finishes += 1;
    };
    window.setTimeout = (handler, milliseconds) => {
      callback = handler;
      delay = milliseconds;
      return 0;
    };
    const update = (position, extra = {}) => handleSpotifyPlaybackUpdate({
      data: { position, duration: 180000, isPaused: false, isBuffering: false, ...extra }
    });
    update(39000);
    assert(state.currentTrackDurationSeconds === 10, 'Clip used full song duration');
    assert(state.currentTrackElapsedMs === 9000, 'Clip elapsed time included start offset');
    assert(delay > 950 && delay <= 1000, 'Completion was not scheduled at selected stop');
    assert(finishes === 0, 'Clip finished early');
    callback();
    assert(finishes === 1, 'Clip deadline did not finish playback');
    finishes = 0;
    update(40000);
    assert(finishes === 1, 'Provider update at stop did not finish');
    finishes = 0;
    update(39000, { isBuffering: true });
    assert(state.currentTrackStartedAt === 0 && finishes === 0, 'Buffering advanced playback');
    state.isPaused = true;
    update(40000);
    assert(finishes === 0, 'Paused clip finished');
    state.isPaused = false;
    track.stopTime = 0;
    update(39000);
    assert(state.currentTrackDurationSeconds === 150 && delay > 140950 && delay <= 141000,
      'Full song playback failed with a start offset');
    track.startTime = 0;
    track.stopTime = 10;
    update(9000);
    assert(state.currentTrackDurationSeconds === 10 && state.currentTrackElapsedMs === 9000,
      'Zero-start clip timing failed');
    track.durationSeconds = 0;
    update(9000);
    assert(track.durationSeconds === 180 && state.currentTrackDurationSeconds === 10,
      'Discovered duration overwrote selected clip');
    let pauses = 0;
    spotifyEmbedController = { pause: () => { pauses += 1; } };
    markCurrentTrackPlayed = () => {};
    rampPlaybackGain = () => {};
    state.categorySettings = { 'clip-test': { autoplay: false, crossfadeSeconds: 0 } };
    state.currentCategoryKey = 'clip-test';
    state.autoTransitioning = false;
    state.playedThresholdTimer = null;
    state.autoAdvanceTimer = null;
    state.autoTransitionTimer = null;
    state.autoFadeInterval = null;
    finishCurrentTrack = functions.finish;
    update(10000);
    assert(pauses === 1 && state.currentTrack === null && state.currentTrackStartedAt === 0,
      'Actual completion did not pause the player and clear playback');
    return { passed: true, clipDeadline: true, startOffset: true, buffering: true,
      pause: true, fullSong: true, discoveredDuration: true, playerStopped: true };
  } finally {
    Object.assign(state, original);
    scheduleCurrentTrackCompletion = functions.completion;
    schedulePlayedThreshold = functions.threshold;
    syncCurrentAutoplaySchedule = functions.advance;
    finishCurrentTrack = functions.finish;
    savePlaylists = functions.save;
    renderBoard = functions.render;
    window.setTimeout = functions.timeout;
    markCurrentTrackPlayed = functions.mark;
    rampPlaybackGain = functions.ramp;
    spotifyEmbedController = functions.controller;
  }
}
