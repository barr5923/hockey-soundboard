const STORAGE_KEY = 'hockey-soundboard-playlists-v1';
const SETTINGS_KEY = 'hockey-soundboard-settings-v1';
const CATEGORY_SETTINGS_KEY = 'hockey-soundboard-category-settings-v1';
const OFFLINE_MODE_KEY = 'hockey-soundboard-offline-mode-v1';
const HIDDEN_CATEGORIES_KEY = 'hockey-soundboard-hidden-categories-v1';
const CATEGORY_SIZES_KEY = 'hockey-soundboard-category-grid-v2';
const SPREADSHEET_COLUMNS = [
  'Category',
  'Song Name',
  'Description',
  'Mood',
  'Start Time (MM:SS)',
  'Stop Time (MM:SS)',
  'Source'
];
let spreadsheetLibraryPromise = null;
let localAudioDatabasePromise = null;

const defaultSettings = {
  soundboardName: 'Hockey Soundboard',
  headerLogoVisible: true,
  watermarkVisible: true,
  headerLogoUrl: 'seattle-thunderbirds-logo.svg',
  customHornDataUrl: '',
  builtInHornAudioUrl: 'sounds/Default_Horn.wav',
  hornDefaultApplied: true,
  watermarkOpacity: 8,
  spotifyClientId: '',
  spotifyRedirectUri: '',
  spotifyAccessToken: '',
  youtubeApiKey: '',
  scoreVoiceName: '',
  scoreHomeTeamName: 'Home',
  scoreAwayTeamName: 'Away'
};

const builtInSoundTracks = [
  ['Among Us Drip Theme', 'among-us-drip-theme.mp3', 'Reactions'],
  ['Among Us Role Reveal', 'among-us-role-reveal.mp3', 'Hype & Reveals'],
  ['Anime Wow', 'anime-wow.mp3', 'Hype & Reveals'],
  ['Are You Ready (MP3)', 'Are_you_ready.mp3', 'Hype & Reveals'],
  ['Are You Ready (WAV)', 'Are_you_ready.wav', 'Hype & Reveals'],
  ['Awww', 'awww.wav', 'Reactions'],
  ['Bruh', 'bruh.mp3', 'Reactions'],
  ['Charge', 'charge.mp3', 'Hockey & Crowd'],
  ['Foghorn', 'Foghorn.wav', 'Horns'],
  ['Goal Horn', 'goalhorn.mp3', 'Horns'],
  ['Kids Cheering', 'kids-cheering-yayyyy.mp3', 'Hockey & Crowd'],
  ['Roblox Oof', 'roblox-oof.mp3', 'Reactions'],
  ['SpongeBob Fail', 'spongebob-fail.mp3', 'Reactions'],
  ['T-Birds Goal Horn', 'TBirds_Goal_Horn.mp3', 'Horns'],
  ['Wayne Glensky', 'wayne-glensky.mp3', 'Hype & Reveals'],
  ['Whistle', 'whistle.mp3', 'Hockey & Crowd'],
  ['WooHoo', 'WooHoo.mp3', 'Reactions']
].map(([name, fileName, builtInGroup]) => ({
  name,
  description: 'Built-in sound',
  builtInGroup,
  mood: 'custom',
  startTime: 0,
  stopTime: 0,
  durationSeconds: 0,
  played: false,
  repeatable: true,
  audioUrl: `sounds/${fileName}`
}));

const defaultPlaylists = {
  'built-in-sounds': builtInSoundTracks,
  'our-goal': [
    { name: 'Big Cheer', description: 'Clean celebration burst', mood: 'celebration', startTime: 0, stopTime: 0, played: false },
    { name: 'Goal Party', description: 'Fast, happy, and upbeat', mood: 'celebration', startTime: 0, stopTime: 0, played: false },
    { name: 'Crowd Jump', description: 'A little extra energy', mood: 'celebration', startTime: 0, stopTime: 0, played: false }
  ],
  'their-goal': [
    { name: 'Quick Shock', description: 'Short and light', mood: 'concern', startTime: 0, stopTime: 0, played: false },
    { name: 'Breathe Moment', description: 'Keeps the energy steady', mood: 'concern', startTime: 0, stopTime: 0, played: false },
    { name: 'Reset Jam', description: 'Good for regrouping', mood: 'concern', startTime: 0, stopTime: 0, played: false }
  ],
  'clock-stops': [
    { name: 'Timeout Tone', description: 'Short and sharp', mood: 'neutral', startTime: 0, stopTime: 0, played: false },
    { name: 'Refocus', description: 'Low-key break cue', mood: 'neutral', startTime: 0, stopTime: 0, played: false },
    { name: 'Ice Break', description: 'A quick reset sound', mood: 'neutral', startTime: 0, stopTime: 0, played: false }
  ],
  'power-play': [
    { name: 'Momentum Rise', description: 'High-energy build', mood: 'upbeat', startTime: 0, stopTime: 0, played: false },
    { name: 'Puck Chase', description: 'Fast and exciting', mood: 'upbeat', startTime: 0, stopTime: 0, played: false },
    { name: 'Pressure Shift', description: 'A little louder', mood: 'upbeat', startTime: 0, stopTime: 0, played: false }
  ],
  'penalty-kill': [
    { name: 'Defense Horn', description: 'Focused and steady', mood: 'defensive', startTime: 0, stopTime: 0, played: false },
    { name: 'Hold the Line', description: 'Solid and calm', mood: 'defensive', startTime: 0, stopTime: 0, played: false },
    { name: 'Breathe & Clutch', description: 'Tighter, more serious', mood: 'defensive', startTime: 0, stopTime: 0, played: false }
  ],
  'winning-too-much': [
    { name: 'Nice and Loud', description: 'Celebration without overdoing it', mood: 'playful', startTime: 0, stopTime: 0, played: false },
    { name: 'Smile Cue', description: 'Warm and friendly energy', mood: 'playful', startTime: 0, stopTime: 0, played: false },
    { name: 'Gentle Victory', description: 'Low-key but happy', mood: 'playful', startTime: 0, stopTime: 0, played: false }
  ]
};

const audioContext = new (window.AudioContext || window.webkitAudioContext)();
let spotifyAuthPopup = null;
let activeHornAudio = null;
let hornCueTimeouts = [];
let activeHornOscillators = [];
let activeMoodOscillators = [];
let moodCueTimeouts = [];
let hornPlaying = false;
let spotifyIframeApiRequested = false;
let spotifyIframeApi = null;
let spotifyEmbedController = null;
let youtubeApiPlayer = null;
let youtubeApiRequested = false;
let youtubeApiReady = false;
const state = {
  isMuted: false,
  isPaused: false,
  currentTrack: null,
  currentCategoryKey: null,
  currentTrackIndex: -1,
  currentTrackElapsedMs: 0,
  currentTrackStartedAt: 0,
  currentTrackDurationSeconds: 0,
  spectrogramTimer: null,
  playedThresholdTimer: null,
  autoAdvanceTimer: null,
  autoTransitionTimer: null,
  autoFadeInterval: null,
  autoTransitioning: false,
  pendingFadeInSeconds: 0,
  youtubeVolume: 100,
  autoplayVisited: new Map(),
  currentSound: null,
  activeButton: null,
  customSource: null,
  customType: null,
  customDuration: 0,
  pendingMp3File: null,
  localAudioObjectUrls: new Map(),
  categorySettings: loadCategorySettings(),
  hiddenCategories: loadHiddenCategories(),
  categorySizes: loadCategorySizes(),
  categoryRenameKey: null,
  playlists: loadPlaylists(),
  settings: loadSettings(),
  dragInfo: null,
  categoryDragKey: null,
  categoryDragOffset: null,
  songEditor: {
    categoryKey: null,
    index: null
  }
};

const statusBar = document.getElementById('status');
const soundboardTitle = document.getElementById('soundboardTitle');
const soundboardTitleEditor = document.getElementById('soundboardTitleEditor');
const soundboardTitleInput = document.getElementById('soundboardTitleInput');
const saveSoundboardTitleButton = document.getElementById('saveSoundboardTitle');
const cancelSoundboardTitleButton = document.getElementById('cancelSoundboardTitle');
const pauseToggleButton = document.getElementById('pauseToggle');
const goalHornButton = document.getElementById('goalHorn');
const enterFullscreenButton = document.getElementById('enterFullscreen');
const exitFullscreenButton = document.getElementById('exitFullscreen');
const scoreButton = document.getElementById('scoreButton');
const scoreDialog = document.getElementById('scoreDialog');
const scoreTeamsButton = document.getElementById('scoreTeamsButton');
const scoreTeamsDialog = document.getElementById('scoreTeamsDialog');
const saveScoreTeamsButton = document.getElementById('saveScoreTeamsButton');
const cancelScoreTeamsButton = document.getElementById('cancelScoreTeamsButton');
const scoreScorerNumberInput = document.getElementById('scoreScorerNumber');
const scoreTeamSelect = document.getElementById('scoreTeamSelect');
const scoreAssistInputs = [
  document.getElementById('scoreAssistOne'),
  document.getElementById('scoreAssistTwo')
];
const scoreVoiceSelect = document.getElementById('scoreVoiceSelect');
let scoreSpeechVoices = [];
const announceScoreButton = document.getElementById('announceScoreButton');
const cancelScoreButton = document.getElementById('cancelScoreButton');
const settingsToggleButton = document.getElementById('settingsToggle');
const settingsPanel = document.getElementById('settingsPanel');
const headerLogoVisibleInput = document.getElementById('headerLogoVisible');
const watermarkVisibleInput = document.getElementById('watermarkVisible');
const headerLogoUrlInput = document.getElementById('headerLogoUrl');
const logoFileInput = document.getElementById('logoFileInput');
const hornFileInput = document.getElementById('hornFileInput');
const builtInHornSelect = document.getElementById('builtInHornSelect');
const customHornOption = document.getElementById('customHornOption');
const watermarkOpacityInput = document.getElementById('watermarkOpacity');
const applySettingsButton = document.getElementById('applySettings');
const scoreHomeTeamNameInput = document.getElementById('scoreHomeTeamName');
const scoreAwayTeamNameInput = document.getElementById('scoreAwayTeamName');
const spotifyConnectButton = document.getElementById('spotifyConnectButton');
const spotifyDisconnectButton = document.getElementById('spotifyDisconnectButton');
const spotifyConnectionStatus = document.getElementById('spotifyConnectionStatus');
const spotifyRedirectUriInput = document.getElementById('spotifyRedirectUri');
const localAudioInput = document.getElementById('localAudio');
const addLocalMp3Button = document.getElementById('addLocalMp3');
const useLocalMp3Input = document.getElementById('useLocalMp3');
const offlineModeToggleInput = document.getElementById('offlineModeToggle');
const offlineModeNotice = document.getElementById('offlineModeNotice');
const localMp3ModeSwitch = document.getElementById('localMp3ModeSwitch');
const onlineMusicSource = document.getElementById('onlineMusicSource');
const localMp3Source = document.getElementById('localMp3Source');
const musicUrlInput = document.getElementById('musicUrl');
const musicNameOverrideInput = document.getElementById('musicNameOverride');
const musicDescriptionOverrideInput = document.getElementById('musicDescriptionOverride');
const musicStartTimeInput = document.getElementById('musicStartTime');
const musicStopTimeInput = document.getElementById('musicStopTime');
const addMusicButton = document.getElementById('addMusic');
const customAudio = document.getElementById('customAudio');
const youtubeWrap = document.getElementById('youtubeWrap');
const youtubePlayer = document.getElementById('youtubePlayer');
const spotifyEmbedWrap = document.getElementById('spotifyEmbedWrap');
const spotifyEmbedHost = document.getElementById('spotifyEmbedHost');
document.getElementById('spotifyTapDismiss')?.addEventListener('click', () => hideSpotifyTapPrompt());
const spectrumAnalyser = audioContext.createAnalyser();
spectrumAnalyser.fftSize = 128;
spectrumAnalyser.smoothingTimeConstant = 0.72;
const customAudioAnalyserSource = audioContext.createMediaElementSource(customAudio);
customAudioAnalyserSource.connect(spectrumAnalyser);
const playbackGain = audioContext.createGain();
spectrumAnalyser.connect(playbackGain);
playbackGain.connect(audioContext.destination);
let spectrogramFrameId = 0;
const boardElement = document.getElementById('board');
const categoryVisibilityPicker = document.getElementById('categoryVisibilityPicker');
const noVisibleCategoriesMessage = document.getElementById('noVisibleCategoriesMessage');
const builtInSoundPicker = document.getElementById('builtinSoundPicker');
const builtInSoundContent = document.getElementById('builtinSoundContent');
const builtInSoundToggleButton = document.getElementById('builtinSoundToggle');
const musicLibraryToggleButton = document.getElementById('musicLibraryToggle');
const musicLibraryContent = document.getElementById('musicLibraryContent');
const newCategoryInput = document.getElementById('newCategoryName');
const addCategoryButton = document.getElementById('addCategory');
const playlistSpreadsheetInput = document.getElementById('playlistSpreadsheetInput');
const spreadsheetMp3FilesInput = document.getElementById('spreadsheetMp3FilesInput');
const shareCategorySelect = document.getElementById('shareCategorySelect');
const shareCategoryButton = document.getElementById('shareCategoryButton');
const unshareCategoryButton = document.getElementById('unshareCategoryButton');
const exportCategoryExcelButton = document.getElementById('exportCategoryExcel');
const exportCategoryCsvButton = document.getElementById('exportCategoryCsv');
const shareCategoryNote = document.getElementById('shareCategoryNote');
const sharedCategoryList = document.getElementById('sharedCategoryList');
let sharedCategories = [];
const downloadSpreadsheetExampleButton = document.getElementById('downloadSpreadsheetExample');
const musicCategorySelect = document.getElementById('musicCategorySelect');
const mp3CategorySelect = document.getElementById('mp3CategorySelect');
const songEditor = document.getElementById('songEditor');
const editSongNameInput = document.getElementById('editSongName');
const editSongDescriptionInput = document.getElementById('editSongDescription');
const editSongCategorySelect = document.getElementById('editSongCategory');
const copySongCategorySelect = document.getElementById('copySongCategory');
const copySongButton = document.getElementById('copySong');
const editSongLinkInput = document.getElementById('editSongLink');
const editStartTimeInput = document.getElementById('editStartTime');
const editStopTimeInput = document.getElementById('editStopTime');
const saveSongEditsButton = document.getElementById('saveSongEdits');
const deleteSongButton = document.getElementById('deleteSong');
const cancelSongEditButton = document.getElementById('cancelSongEdit');
const categoryRenameEditor = document.getElementById('categoryRenameEditor');
const categoryRenameInput = document.getElementById('categoryRenameInput');
const saveCategoryRenameButton = document.getElementById('saveCategoryRename');
const cancelCategoryRenameButton = document.getElementById('cancelCategoryRename');
offlineModeToggleInput.checked = localStorage.getItem(OFFLINE_MODE_KEY) === 'true';

    function buildPlaylistConversionCsv(tracks, isYouTube) {
      const quote = (value) => {
        const text = String(value ?? '');
        const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
        return `"${safe.replace(/"/g, '""')}"`;
      };
      const rows = tracks.map((track) => [
        track.artist || '',
        Number(track.durationSeconds) > 0 ? formatTimecode(track.durationSeconds) : '',
        track.name,
        isYouTube ? track.youtubeUrl : track.sourceUrl
      ]);
      return [['Artist', 'Length (min:sec)', 'Song Name', 'Song Link'], ...rows]
        .map((row) => row.map(quote).join(',')).join('\r\n');
    }

    function setupPlaylistConversion() {
      const dialog = document.getElementById('playlistConversionDialog');
      document.body.appendChild(dialog);
      const input = document.getElementById('playlistConversionUrl');
      const filenameInput = document.getElementById('playlistConversionFilename');
      const button = document.getElementById('convertPlaylist');
      const close = document.getElementById('closePlaylistConversion');
      const status = document.getElementById('playlistConversionStatus');
      const dismiss = () => {
        dialog.classList.add('hidden');
        document.querySelector('.side-menu-toggle').focus();
      };
      document.addEventListener('open-playlist-conversion', () => {
        if (!window.SoundboardIntegrations.names().length) return;
        dialog.classList.remove('hidden');
        input.focus();
      });
      close.addEventListener('click', dismiss);
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dismiss();
      });
      dialog.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          dismiss();
        } else if (event.key === 'Tab') {
          const controls = Array.from(dialog.querySelectorAll('button, input')).filter((element) => !element.disabled);
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
      button.addEventListener('click', async () => {
        const name = filenameInput.value.trim();
        if (!name || /[<>:"/\\|?*\u0000-\u001F]/.test(name) || /[.]$/.test(name) || /^\.csv$/i.test(name)) {
          status.textContent = 'Enter a valid CSV file name without folder paths or these characters: < > : " / \\ | ? *';
          filenameInput.focus();
          return;
        }
        const filename = /\.csv$/i.test(name) ? name : `${name}.csv`;
        let url;
        try {
          url = new URL(input.value.trim());
        } catch (error) {
          status.textContent = `Enter a complete playlist URL from ${window.SoundboardIntegrations.names().join(', ')}.`;
          input.focus();
          return;
        }
        const spotify = url.hostname === 'open.spotify.com' && /^https?:$/.test(url.protocol)
          ? parseSpotifyUrl(url.href) : null;
        const youtubeId = /^https?:$/.test(url.protocol) ? parseYouTubePlaylistId(url.href) : null;
        const apple = parseAppleMusicUrl(url.href);
        if (spotify?.type !== 'playlist' && !youtubeId && apple?.type !== 'playlist') {
          status.textContent = `Use a playlist link from ${window.SoundboardIntegrations.names().join(', ')}.`;
          input.focus();
          return;
        }
        const provider = youtubeId ? 'youtube' : apple?.type === 'playlist' ? 'appleMusic' : 'spotify';
        button.disabled = true;
        status.textContent = 'Reading playlist...';
        try {
          window.SoundboardIntegrations.require(provider);
          const tracks = youtubeId
            ? await fetchYouTubePlaylistTracks(youtubeId, true)
            : apple?.type === 'playlist'
              ? await fetchAppleMusicPlaylistTracks(apple)
              : await fetchSpotifyPlaylistTracks(spotify.id);
          window.SoundboardIntegrations.require(provider);
          if (!tracks.length) throw new Error('No accessible songs were found in this playlist.');
          const csv = buildPlaylistConversionCsv(tracks, Boolean(youtubeId));
          downloadBlob(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), filename);
          input.value = '';
          filenameInput.value = '';
          const missing = tracks.filter((track) => !track.durationSeconds).length;
          status.textContent = `Downloaded ${tracks.length} songs.${missing ? ` ${missing} unavailable durations were left blank.` : ''}${youtubeId ? ' Artist values are YouTube channel names.' : ''}`;
        } catch (error) {
          console.error('Playlist conversion failed.', error);
          status.textContent = window.SoundboardIntegrations.enabled(provider)
            ? error.message || 'Playlist conversion failed. Please try again.'
            : 'This music integration was disabled during conversion. No CSV was downloaded.';
        } finally {
          button.disabled = false;
        }
      });
    }

function loadPlaylists() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const base = JSON.parse(JSON.stringify(defaultPlaylists));
    if (!saved) {
      return base;
    }
    const parsed = JSON.parse(saved);
    const merged = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : base;
    if (!merged['built-in-sounds']) {
      merged['built-in-sounds'] = base['built-in-sounds'];
    }
    Object.keys(merged).forEach((key) => {
      merged[key] = (merged[key] || []).map((track, index) => ({
        name: track.name || 'Untitled',
        description: track.description || 'Custom cue',
        mood: track.mood && track.mood !== 'foghorn' ? track.mood : 'custom',
        startTime: Number(track.startTime) || 0,
        stopTime: Number(track.stopTime) || 0,
        durationSeconds: Number(track.durationSeconds) || 0,
        spotifyUrl: track.spotifyUrl || '',
        appleMusicUrl: track.appleMusicUrl || '',
        youtubeUrl: track.youtubeUrl || '',
        audioDataUrl: typeof track.audioDataUrl === 'string' ? track.audioDataUrl : '',
        audioStorageId: typeof track.audioStorageId === 'string' ? track.audioStorageId : '',
        audioUrl: key === 'built-in-sounds' && track.name === 'Foghorn'
          ? 'sounds/Foghorn.wav'
          : (typeof track.audioUrl === 'string' ? track.audioUrl : ''),
        builtInGroup: key === 'built-in-sounds'
          ? track.builtInGroup || builtInSoundTracks[index]?.builtInGroup || 'Reactions'
          : '',
        youtubeEmbedUrl: typeof track.youtubeEmbedUrl === 'string' ? track.youtubeEmbedUrl : '',
        played: Boolean(track.played),
        repeatable: Boolean(track.repeatable)
      }));
    });
    return merged;
  } catch (error) {
    return JSON.parse(JSON.stringify(defaultPlaylists));
  }
}

function openLocalAudioDatabase() {
  if (!localAudioDatabasePromise) {
    localAudioDatabasePromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('This browser does not support large local audio storage.'));
        return;
      }

      const request = window.indexedDB.open(window.SOUNDBOARD_AUDIO_DB || 'hockey-soundboard-audio-v1', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('mp3-files')) {
          request.result.createObjectStore('mp3-files');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        localAudioDatabasePromise = null;
        reject(request.error || new Error('Could not open local audio storage.'));
      };
    });
  }
  return localAudioDatabasePromise;
}

function createLocalAudioStorageId() {
  return `mp3-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

async function saveLocalAudioFile(storageId, file) {
  const database = await openLocalAudioDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('mp3-files', 'readwrite');
    transaction.objectStore('mp3-files').put(file, storageId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not store the MP3 file.'));
    transaction.onabort = () => reject(transaction.error || new Error('Could not store the MP3 file.'));
  });
}

async function loadLocalAudioFile(storageId) {
  const database = await openLocalAudioDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('mp3-files', 'readonly');
    const request = transaction.objectStore('mp3-files').get(storageId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Could not load the stored MP3 file.'));
  });
}

async function deleteLocalAudioFile(storageId) {
  if (!storageId) {
    return;
  }
  const database = await openLocalAudioDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('mp3-files', 'readwrite');
    transaction.objectStore('mp3-files').delete(storageId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not remove the stored MP3 file.'));
  });
}

function removeStoredAudioFile(storageId, track) {
  if (!storageId) {
    return;
  }
  if (Object.values(state.playlists).some((tracks) => tracks.some((entry) => entry !== track && entry.audioStorageId === storageId))) {
    return;
  }

  const objectUrl = state.localAudioObjectUrls.get(storageId);
  state.localAudioObjectUrls.delete(storageId);
  if (objectUrl && state.currentTrack !== track) {
    URL.revokeObjectURL(objectUrl);
  }
  deleteLocalAudioFile(storageId).catch(() => {});
}

function loadCategorySettings() {
  try {
    const saved = localStorage.getItem(CATEGORY_SETTINGS_KEY);
    const parsed = saved ? JSON.parse(saved) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function loadHiddenCategories() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HIDDEN_CATEGORIES_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : []);
  } catch (error) {
    return new Set();
  }
}

function saveHiddenCategories() {
  localStorage.setItem(HIDDEN_CATEGORIES_KEY, JSON.stringify([...state.hiddenCategories]));
}

function loadCategorySizes() {
  try {
    const saved = JSON.parse(localStorage.getItem(CATEGORY_SIZES_KEY) || '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
      return {};
    }
    return Object.fromEntries(Object.entries(saved).filter(([, size]) => size && typeof size === 'object').map(([key, size]) => [key, {
      w: Math.max(1, Math.min(2, Math.round(Number(size.w)) || 1)),
      h: Math.max(3, Math.min(10, Math.round(Number(size.h)) || 4)),
      col: Number.isInteger(size.col) && size.col >= 0 ? size.col : undefined,
      row: Number.isInteger(size.row) && size.row >= 0 ? size.row : undefined
    }]));
  } catch (error) {
    return {};
  }
}

function saveCategorySizes() {
  localStorage.setItem(CATEGORY_SIZES_KEY, JSON.stringify(state.categorySizes));
}

function getCategorySettings(categoryKey) {
  const saved = state.categorySettings[categoryKey] || {};
  return {
    autoplay: saved.autoplay === true,
    crossfadeSeconds: Math.min(10, Math.max(0, Number(saved.crossfadeSeconds !== undefined ? saved.crossfadeSeconds : 2)))
  };
}

function saveCategorySettings() {
  localStorage.setItem(CATEGORY_SETTINGS_KEY, JSON.stringify(state.categorySettings));
}

function updateCategorySetting(categoryKey, setting, value) {
  state.categorySettings[categoryKey] = {
    ...getCategorySettings(categoryKey),
    [setting]: value
  };
  if (setting === 'autoplay') {
    if (value) {
      const visited = new Set();
      if (state.currentCategoryKey === categoryKey && state.currentTrack) {
        visited.add(state.currentTrack);
      }
      state.autoplayVisited.set(categoryKey, visited);
    } else {
      state.autoplayVisited.delete(categoryKey);
      if (state.currentCategoryKey === categoryKey && state.autoTransitioning) {
        if (state.autoTransitionTimer) {
          clearTimeout(state.autoTransitionTimer);
          state.autoTransitionTimer = null;
        }
        if (state.customType === 'youtube') {
          rampYouTubeVolume(100, 0);
        } else {
          rampPlaybackGain(1, 0);
        }
        state.autoTransitioning = false;
      }
    }
  }
  saveCategorySettings();
  if (state.currentCategoryKey === categoryKey) {
    syncCurrentAutoplaySchedule();
  }
}

function getNextUnplayedTrack(categoryKey, currentTrack) {
  const tracks = state.playlists[categoryKey] || [];
  if (!tracks.length) {
    return null;
  }

  const currentIndex = tracks.indexOf(currentTrack);
  const visited = state.autoplayVisited.get(categoryKey) || new Set();
  for (let offset = 1; offset <= tracks.length; offset += 1) {
    const index = (currentIndex + offset + tracks.length) % tracks.length;
    const track = tracks[index];
    if (track !== currentTrack && !track.played && !visited.has(track) && isTrackPlayableHere(track) && (!isOfflineModeActive() || isTrackAvailableOffline(track))) {
      return { track, index };
    }
  }

  return null;
}

function getTrackDurationSeconds(track) {
  const start = Math.max(0, Number(track.startTime) || 0);
  const audioDuration = (track.audioDataUrl || track.audioStorageId || track.audioUrl) && track === state.currentTrack && Number.isFinite(customAudio.duration) ? customAudio.duration : 0;
  const stop = Number(track.stopTime) || Number(track.durationSeconds) || audioDuration;
  return stop > start ? stop - start : 0;
}

function getTrackCardDurationSeconds(track) {
  const start = Math.max(0, Number(track.startTime) || 0);
  let end = Number(track.stopTime) > start ? Number(track.stopTime) : Number(track.durationSeconds) || 0;

  if (end <= start && track === state.currentTrack) {
    if (state.customType === 'file' && Number.isFinite(customAudio.duration)) {
      end = customAudio.duration;
    } else if (state.customType === 'youtube' && youtubeApiReady) {
      end = youtubeApiPlayer.getDuration();
    } else if (state.customType === 'spotify') {
      end = state.currentTrackDurationSeconds;
    }
  }
  if (end > start) {
    return Math.ceil(end - start);
  }

  const builtInCueDurations = {
    celebration: 0.49,
    concern: 0.3,
    neutral: 0.28,
    upbeat: 0.42,
    defensive: 0.32,
    playful: 0.44,
    foghorn: 3,
    custom: 0.28
  };
  if (!track.audioDataUrl && !track.audioStorageId && !track.audioUrl && !track.spotifyUrl && !track.youtubeUrl && !track.youtubeEmbedUrl && !track.appleMusicUrl) {
    return Math.ceil(builtInCueDurations[track.mood] || builtInCueDurations.neutral);
  }
  return null;
}

function formatTrackCardDuration(track) {
  const duration = getTrackCardDurationSeconds(track);
  return duration === null ? '--:--' : formatTimecode(duration);
}

function rampPlaybackGain(target, durationSeconds) {
  const now = audioContext.currentTime;
  playbackGain.gain.cancelScheduledValues(now);
  playbackGain.gain.setValueAtTime(playbackGain.gain.value, now);
  if (durationSeconds > 0) {
    playbackGain.gain.linearRampToValueAtTime(target, now + durationSeconds);
  } else {
    playbackGain.gain.setValueAtTime(target, now);
  }
}

function sendYouTubeCommand(command, args = []) {
  if (youtubeApiReady) {
    if (command === 'pauseVideo') youtubeApiPlayer.pauseVideo();
    else if (command === 'playVideo') youtubeApiPlayer.playVideo();
    else if (command === 'stopVideo') youtubeApiPlayer.stopVideo();
    return;
  }
  if (!youtubePlayer.contentWindow) return;
  youtubePlayer.contentWindow.postMessage(JSON.stringify({ event: 'command', func: command, args }), '*');
}

function sendYouTubeVolume(volume) {
  state.youtubeVolume = Math.max(0, Math.min(100, volume));
  if (youtubeApiReady) {
    youtubeApiPlayer.setVolume(Math.round(state.youtubeVolume));
    return;
  }
  sendYouTubeCommand('setVolume', [Math.round(state.youtubeVolume)]);
}

function loadYouTubeTrackInApi(track) {
  if (!window.SoundboardIntegrations.enabled('youtube')) return;
  if (!youtubeApiReady || !track?.youtubeEmbedUrl) {
    return;
  }
  const videoId = new URL(track.youtubeEmbedUrl).pathname.split('/').pop();
  const options = { videoId, startSeconds: Number(track.startTime) || 0 };
  if (Number(track.stopTime) > 0) {
    options.endSeconds = Number(track.stopTime);
  }
  if (state.isPaused) {
    youtubeApiPlayer.cueVideoById(options);
  } else {
    youtubeApiPlayer.loadVideoById(options);
  }
  youtubeApiPlayer.setVolume(Math.round(state.youtubeVolume));
}

function ensureYouTubeApi() {
  if (!window.SoundboardIntegrations.enabled('youtube')) return;
  if (youtubeApiRequested || youtubeApiPlayer) {
    return;
  }
  youtubeApiRequested = true;
  window.onYouTubeIframeAPIReady = () => {
    if (!window.SoundboardIntegrations.enabled('youtube')) {
      youtubeApiRequested = false;
      return;
    }
    youtubeApiPlayer = new window.YT.Player(youtubePlayer, {
      playerVars: {
        autoplay: 1,
        controls: 1,
        enablejsapi: 1,
        origin: window.location.origin,
        playsinline: 1,
        rel: 0
      },
      events: {
        onReady: () => {
          youtubeApiReady = true;
          if (state.customType === 'youtube' && state.currentTrack) {
            loadYouTubeTrackInApi(state.currentTrack);
          }
        },
        onError: (event) => {
          if (state.customType !== 'youtube' || !state.currentTrack) {
            return;
          }
          clearTrackPlaybackTimers();
          const messages = {
            2: 'The YouTube video link is invalid.',
            5: 'YouTube could not play this video in this browser.',
            100: 'This YouTube video is unavailable, removed, or private.',
            101: 'The video owner does not allow playback in embedded players.',
            150: 'The video owner does not allow playback in embedded players.',
            153: 'YouTube rejected the player identification. Open the app through localhost or its hosted website and check browser referrer restrictions.'
          };
          setStatus(`${state.currentTrack.name}: ${messages[event.data] || `YouTube playback failed (error ${event.data}).`} Try another video or a local MP3.`);
        },
        onAutoplayBlocked: () => {
          if (state.customType === 'youtube') {
            clearTrackPlaybackTimers();
            setStatus('YouTube autoplay was blocked. Allow autoplay for this site in your browser, then retry the song, or use a local MP3.');
          }
        },
        onStateChange: (event) => {
          if (state.customType !== 'youtube') {
            return;
          }
          if (event.data === window.YT.PlayerState.ENDED && state.currentTrack) {
            finishCurrentTrack(state.currentTrack);
          } else if (event.data === window.YT.PlayerState.PLAYING && state.currentTrack) {
            setStatus(`${state.currentTrack.name} is playing from YouTube.`);
            const duration = Number(youtubeApiPlayer.getDuration()) || 0;
            if (duration > 0) {
              if (!state.currentTrack.durationSeconds) {
                state.currentTrack.durationSeconds = duration;
                savePlaylists();
                renderBoard();
              }
              state.currentTrackDurationSeconds = getTrackDurationSeconds(state.currentTrack) || duration;
              scheduleCurrentTrackCompletion();
              syncCurrentAutoplaySchedule();
            }
          }
        }
      }
    });
  };
  if (window.YT?.Player) {
    window.onYouTubeIframeAPIReady();
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://www.youtube.com/iframe_api';
  script.async = true;
  script.addEventListener('error', () => {
    youtubeApiRequested = false;
    if (state.customType === 'youtube') {
      clearTrackPlaybackTimers();
      setStatus('The YouTube player API could not load. Check your connection or browser content blockers, then retry the song.');
    }
  });
  document.head.appendChild(script);
}

function rampYouTubeVolume(target, durationSeconds) {
  if (state.autoFadeInterval) {
    clearInterval(state.autoFadeInterval);
    state.autoFadeInterval = null;
  }
  const start = state.youtubeVolume;
  const difference = target - start;
  const steps = Math.max(1, Math.ceil(durationSeconds * 20));
  if (!durationSeconds) {
    sendYouTubeVolume(target);
    return;
  }

  let step = 0;
  state.autoFadeInterval = window.setInterval(() => {
    step += 1;
    sendYouTubeVolume(start + (difference * step / steps));
    if (step >= steps) {
      clearInterval(state.autoFadeInterval);
      state.autoFadeInterval = null;
    }
  }, (durationSeconds * 1000) / steps);
}

function clearTrackPlaybackTimers() {
  ['spectrogramTimer', 'playedThresholdTimer', 'autoAdvanceTimer', 'autoTransitionTimer'].forEach((timerKey) => {
    if (state[timerKey]) {
      clearTimeout(state[timerKey]);
      state[timerKey] = null;
    }
  });
  if (state.autoFadeInterval) {
    clearInterval(state.autoFadeInterval);
    state.autoFadeInterval = null;
  }
}

function getCurrentTrackPlayedMilliseconds() {
  if (!state.currentTrackStartedAt) {
    return state.currentTrackElapsedMs;
  }
  return state.currentTrackElapsedMs + (performance.now() - state.currentTrackStartedAt);
}

function markCurrentTrackPlayed() {
  if (state.currentTrack?.repeatable) {
    return;
  }
  if (getCurrentTrackPlayedMilliseconds() < 7000) {
    return;
  }
  const tracks = state.playlists[state.currentCategoryKey] || [];
  const index = tracks.indexOf(state.currentTrack);
  if (index < 0 || state.currentTrack.played) {
    return;
  }
  state.currentTrackIndex = index;
  markTrackAsPlayed(state.currentCategoryKey, index);
  renderBoard();
}

function schedulePlayedThreshold() {
  if (state.playedThresholdTimer) {
    clearTimeout(state.playedThresholdTimer);
    state.playedThresholdTimer = null;
  }
  if (!state.currentTrack || state.isPaused) {
    return;
  }

  const remainingMilliseconds = Math.max(0, 7000 - getCurrentTrackPlayedMilliseconds());
  state.playedThresholdTimer = window.setTimeout(() => {
    if (state.currentTrack && !state.isPaused && getCurrentTrackPlayedMilliseconds() >= 7000) {
      markCurrentTrackPlayed();
    } else {
      schedulePlayedThreshold();
    }
  }, remainingMilliseconds);
}

function scheduleCurrentTrackCompletion() {
  if (state.spectrogramTimer) {
    clearTimeout(state.spectrogramTimer);
    state.spectrogramTimer = null;
  }
  if (!state.currentTrack || state.isPaused || state.customType === 'file' || !state.currentTrackDurationSeconds) {
    return;
  }

  const remainingSeconds = Math.max(0, state.currentTrackDurationSeconds - (getCurrentTrackPlayedMilliseconds() / 1000));
  state.spectrogramTimer = window.setTimeout(() => finishCurrentTrack(state.currentTrack), remainingSeconds * 1000);
}

function startCategoryTrack(categoryKey, index, track, fadeInSeconds = 0) {
  if (!isTrackIntegrationEnabled(track)) {
    setStatus('This music integration is disabled by the administrator.');
    return;
  }
  if (!isTrackPlayableHere(track)) {
    setStatus('Apple Music songs are metadata and links only. Use Open in Apple Music; soundboard playback is not supported yet.');
    return;
  }
  if (isOfflineModeActive() && !(track.audioDataUrl || track.audioStorageId || track.audioUrl) && (track.spotifyUrl || track.youtubeUrl || track.youtubeEmbedUrl)) {
    setStatus('This online track needs internet. Use a local MP3 for offline playback.');
    return;
  }

  if (state.currentTrack && state.currentTrack !== track) {
    markCurrentTrackPlayed();
  }

  clearTrackPlaybackTimers();
  state.currentCategoryKey = categoryKey;
  state.currentTrackIndex = index;
  state.currentTrack = track;
  state.currentTrackElapsedMs = 0;
  state.currentTrackStartedAt = performance.now();
  state.currentTrackDurationSeconds = 0;
  state.autoTransitioning = false;
  state.pendingFadeInSeconds = fadeInSeconds;
  state.youtubeVolume = fadeInSeconds > 0 ? 0 : 100;
  if (getCategorySettings(categoryKey).autoplay) {
    const visited = state.autoplayVisited.get(categoryKey) || new Set();
    visited.add(track);
    state.autoplayVisited.set(categoryKey, visited);
  }

  const now = audioContext.currentTime;
  playbackGain.gain.cancelScheduledValues(now);
  playbackGain.gain.setValueAtTime(fadeInSeconds > 0 ? 0 : 1, now);
  const isSpotifyTrack = Boolean(getSpotifyTrackUri(track)) && !track.audioDataUrl && !track.audioStorageId && !track.audioUrl && !track.youtubeEmbedUrl;
  const isStoredMp3Loading = Boolean(track.audioStorageId && !track.audioDataUrl && !state.localAudioObjectUrls.has(track.audioStorageId));
  if (!isSpotifyTrack && !isStoredMp3Loading) {
    schedulePlayedThreshold();
  }

  const customPlayed = playCustomSource(track);
  if (!customPlayed) {
    playMoodCue(track);
    if (fadeInSeconds > 0) {
      rampPlaybackGain(1, fadeInSeconds);
    }
  } else if (fadeInSeconds > 0 && state.customType !== 'youtube') {
    rampPlaybackGain(1, fadeInSeconds);
  } else if (fadeInSeconds > 0 && state.customType === 'youtube') {
    rampYouTubeVolume(100, fadeInSeconds);
  }

  renderBoard();
}

function scheduleAutomaticAdvance(categoryKey, track, durationSeconds) {
  if (state.autoAdvanceTimer) {
    clearTimeout(state.autoAdvanceTimer);
    state.autoAdvanceTimer = null;
  }
  const settings = getCategorySettings(categoryKey);
  if (!settings.autoplay || state.isPaused || durationSeconds <= 0 || !getNextUnplayedTrack(categoryKey, track)) {
    return;
  }

  const fadeSeconds = state.customType === 'spotify' ? 0 : Math.min(settings.crossfadeSeconds, durationSeconds);
  const delayMilliseconds = Math.max(0, (durationSeconds - fadeSeconds) * 1000);
  state.autoAdvanceTimer = window.setTimeout(() => beginAutomaticAdvance(categoryKey, track, fadeSeconds), delayMilliseconds);
}

function beginAutomaticAdvance(categoryKey, track, fadeSeconds) {
  if (state.currentTrack !== track || state.isPaused || state.autoTransitioning) {
    return;
  }
  const next = getNextUnplayedTrack(categoryKey, track);
  if (!next) {
    return;
  }

  state.autoTransitioning = true;
  if (state.customType === 'youtube') {
    rampYouTubeVolume(0, fadeSeconds);
  } else {
    rampPlaybackGain(0, fadeSeconds);
  }
  state.autoTransitionTimer = window.setTimeout(() => {
    if (state.currentTrack === track) {
      startCategoryTrack(categoryKey, next.index, next.track, fadeSeconds);
    }
  }, fadeSeconds * 1000);
}

function finishCurrentTrack(track) {
  if (state.currentTrack !== track || state.isPaused || state.autoTransitioning) {
    return;
  }

  markCurrentTrackPlayed();
  const categoryKey = state.currentCategoryKey;
  const settings = getCategorySettings(categoryKey);
  const next = settings.autoplay ? getNextUnplayedTrack(categoryKey, track) : null;
  if (next) {
    startCategoryTrack(categoryKey, next.index, next.track, settings.crossfadeSeconds);
    return;
  }

  clearTrackPlaybackTimers();
  if (state.customType === 'youtube') {
    sendYouTubeCommand('stopVideo');
  } else if (state.customType === 'spotify' && spotifyEmbedController) {
    spotifyEmbedController.pause();
  }
  hideSpotifyTapPrompt();
  state.currentTrack = null;
  state.currentCategoryKey = null;
  state.currentTrackIndex = -1;
  state.currentTrackStartedAt = 0;
  state.currentTrackElapsedMs = 0;
  state.currentTrackDurationSeconds = 0;
  rampPlaybackGain(1, 0);
  renderBoard();
}

function syncCurrentAutoplaySchedule() {
  if (state.autoAdvanceTimer) {
    clearTimeout(state.autoAdvanceTimer);
    state.autoAdvanceTimer = null;
  }
  if (!state.currentTrack || state.isPaused || state.autoTransitioning) {
    return;
  }

  const settings = getCategorySettings(state.currentCategoryKey);
  if (!settings.autoplay) {
    return;
  }

  let remainingSeconds = state.currentTrackDurationSeconds - (getCurrentTrackPlayedMilliseconds() / 1000);
  if (state.customType === 'file') {
    const endTime = Number(state.currentTrack.stopTime) || Number(state.currentTrack.durationSeconds) || customAudio.duration;
    remainingSeconds = endTime - customAudio.currentTime;
  }
  scheduleAutomaticAdvance(state.currentCategoryKey, state.currentTrack, remainingSeconds);
}

function markTrackAsPlayed(categoryKey, index) {
  const track = state.playlists[categoryKey]?.[index];
  if (!track) {
    return;
  }

  track.played = true;
  savePlaylists();
}

function savePlaylists() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.playlists));
}

function loadSettings() {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (!saved) {
      return { ...defaultSettings };
    }

    const parsed = JSON.parse(saved);
    const customHornDataUrl = typeof parsed.customHornDataUrl === 'string' ? parsed.customHornDataUrl : '';
    const savedHornChoice = typeof parsed.builtInHornAudioUrl === 'string' ? parsed.builtInHornAudioUrl : '';
    const migratedHornChoice = parsed.hornDefaultApplied || (savedHornChoice && savedHornChoice !== 'classic') ? savedHornChoice : 'sounds/Default_Horn.wav';
    const classicMigrated = migratedHornChoice === 'classic' ? 'sounds/Classic_Horn.wav' : migratedHornChoice;
    const normalizedHornChoice = ['foghorn', 'sounds/foghorn.mp3'].includes(classicMigrated) ? 'sounds/Foghorn.wav' : classicMigrated;
    const hornOptions = ['sounds/Classic_Horn.wav', 'custom', 'sounds/Foghorn.wav', 'sounds/Default_Horn.wav', 'sounds/goalhorn.mp3', 'sounds/TBirds_Goal_Horn.mp3'];
    return {
      ...defaultSettings,
      ...parsed,
      soundboardName: typeof parsed.soundboardName === 'string' && parsed.soundboardName.trim()
        ? parsed.soundboardName.trim()
        : defaultSettings.soundboardName,
      customHornDataUrl,
      hornDefaultApplied: true,
      builtInHornAudioUrl: normalizedHornChoice === 'custom' && !customHornDataUrl
        ? 'sounds/Default_Horn.wav'
        : hornOptions.includes(normalizedHornChoice)
          ? normalizedHornChoice
          : (customHornDataUrl ? 'custom' : 'sounds/Default_Horn.wav'),
      headerLogoVisible: parsed.headerLogoVisible !== false,
      watermarkVisible: parsed.watermarkVisible !== false,
      watermarkOpacity: Math.min(30, Math.max(0, Number(parsed.watermarkOpacity) || defaultSettings.watermarkOpacity)),
      spotifyClientId: typeof parsed.spotifyClientId === 'string' ? parsed.spotifyClientId : '',
      spotifyRedirectUri: typeof parsed.spotifyRedirectUri === 'string' ? parsed.spotifyRedirectUri : '',
      spotifyAccessToken: typeof parsed.spotifyAccessToken === 'string' ? parsed.spotifyAccessToken : '',
      youtubeApiKey: typeof parsed.youtubeApiKey === 'string' ? parsed.youtubeApiKey : '',
      scoreVoiceName: typeof parsed.scoreVoiceName === 'string' ? parsed.scoreVoiceName : '',
      scoreHomeTeamName: typeof parsed.scoreHomeTeamName === 'string' && parsed.scoreHomeTeamName.trim()
        ? parsed.scoreHomeTeamName.trim()
        : defaultSettings.scoreHomeTeamName,
      scoreAwayTeamName: typeof parsed.scoreAwayTeamName === 'string' && parsed.scoreAwayTeamName.trim()
        ? parsed.scoreAwayTeamName.trim()
        : defaultSettings.scoreAwayTeamName
    };
  } catch (error) {
    return { ...defaultSettings };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function applyBrandSettings() {
  const logoUrl = (headerLogoUrlInput.value || defaultSettings.headerLogoUrl).trim();
  const opacityValue = Math.min(30, Math.max(0, Number(watermarkOpacityInput.value) || defaultSettings.watermarkOpacity));

  state.settings = {
    soundboardName: state.settings.soundboardName || defaultSettings.soundboardName,
    customHornDataUrl: state.settings.customHornDataUrl || '',
    builtInHornAudioUrl: builtInHornSelect.value,
    hornDefaultApplied: true,
    headerLogoVisible: headerLogoVisibleInput.checked,
    watermarkVisible: watermarkVisibleInput.checked,
    headerLogoUrl: logoUrl || defaultSettings.headerLogoUrl,
    watermarkOpacity: opacityValue,
    spotifyClientId: state.settings.spotifyClientId || '',
    spotifyRedirectUri: state.settings.spotifyRedirectUri || '',
    spotifyAccessToken: state.settings.spotifyAccessToken || '',
    youtubeApiKey: state.settings.youtubeApiKey || '',
    scoreVoiceName: state.settings.scoreVoiceName || '',
    scoreHomeTeamName: scoreHomeTeamNameInput.value.trim() || defaultSettings.scoreHomeTeamName,
    scoreAwayTeamName: scoreAwayTeamNameInput.value.trim() || defaultSettings.scoreAwayTeamName,
    spotifyRefreshToken: state.settings.spotifyRefreshToken || '',
    spotifyTokenExpiresAt: state.settings.spotifyTokenExpiresAt || 0
  };

  document.body.dataset.headerLogoVisible = String(state.settings.headerLogoVisible);
  scoreHomeTeamNameInput.value = state.settings.scoreHomeTeamName;
  scoreAwayTeamNameInput.value = state.settings.scoreAwayTeamName;
  populateScoreTeamOptions();
  document.body.dataset.watermarkVisible = String(state.settings.watermarkVisible);
  document.body.style.setProperty('--watermark-opacity', (state.settings.watermarkOpacity / 100).toString());
  document.body.style.setProperty('--watermark-image', `url("${state.settings.headerLogoUrl}")`);

  const headerLogo = document.querySelector('.team-logo');
  if (headerLogo) {
    headerLogo.src = state.settings.headerLogoUrl;
    headerLogo.alt = 'Custom team logo';
  }

  saveSettings();
  setStatus('Brand settings updated.');
}

function syncSpotifyInputs() {
  spotifyRedirectUriInput.value = getSpotifyRedirectUri();
  spotifyRedirectUriInput.placeholder = 'http://127.0.0.1/';
  const clientId = window.SoundboardIntegrations.config().spotifyClientId;
  const needsReconnect = state.settings.spotifyAccessToken && state.settings.spotifyClientId !== clientId;
  spotifyConnectionStatus.textContent = !clientId
    ? 'Shared app setup is incomplete. Ask the administrator to configure it.'
    : needsReconnect ? 'App connection settings changed. Reconnect your account.'
      : state.settings.spotifyAccessToken ? 'Spotify is connected in this browser.' : 'Spotify is not connected.';
  spotifyConnectButton.textContent = state.settings.spotifyAccessToken ? 'Reconnect Spotify' : 'Connect Spotify';
  spotifyConnectButton.disabled = !clientId;
  spotifyDisconnectButton.disabled = !state.settings.spotifyAccessToken;
}

function getSpotifyRedirectUri() {
  const saved = (state.settings.spotifyRedirectUri || '').trim();
  if (saved) {
    return saved;
  }
  const callbackUrl = new URL(window.location.href);
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(callbackUrl.hostname);
  if (isLoopback || (callbackUrl.protocol === 'http:' && callbackUrl.hostname !== '127.0.0.1')) {
    callbackUrl.hostname = '127.0.0.1';
  }
  return `${callbackUrl.origin}${callbackUrl.pathname}`;
}

function base64UrlEncode(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function createCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

async function connectSpotify() {
  if (!window.SoundboardIntegrations.enabled('spotify')) {
    setStatus('This music integration is disabled by the administrator.');
    return;
  }
  const clientId = window.SoundboardIntegrations.config().spotifyClientId;
  if (!clientId) {
    setStatus('Ask the administrator to configure the shared client ID first.');
    return;
  }

  if (!window.crypto?.subtle) {
    setStatus('Spotify connection requires a secure origin such as localhost or HTTPS.');
    return;
  }

  state.settings.spotifyClientId = clientId;
  saveSettings();

  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(64)));
  const challenge = await createCodeChallenge(verifier);
  if (!window.SoundboardIntegrations.enabled('spotify')) {
    setStatus('This music integration was disabled before sign-in started.');
    return;
  }
  const oauthState = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  sessionStorage.setItem('spotify-pkce-verifier', verifier);
  sessionStorage.setItem('spotify-oauth-state', oauthState);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: getSpotifyRedirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state: oauthState,
    scope: 'playlist-read-private playlist-read-collaborative'
  });

  spotifyAuthPopup = window.open(`https://accounts.spotify.com/authorize?${params.toString()}`, 'spotify-auth', 'popup,width=520,height=720');
  if (!spotifyAuthPopup) {
    setStatus('Allow popups for this page to connect Spotify.');
    return;
  }
  setStatus('Waiting for Spotify sign-in to finish.');
}

async function exchangeSpotifyCode(code, returnedState) {
  window.SoundboardIntegrations.require('spotify');
  if (state.settings.spotifyClientId !== window.SoundboardIntegrations.config().spotifyClientId) {
    throw new Error('App connection settings changed. Please connect your music account again.');
  }
  const verifier = sessionStorage.getItem('spotify-pkce-verifier');
  const expectedState = sessionStorage.getItem('spotify-oauth-state');
  if (!verifier || !expectedState || returnedState !== expectedState) {
    throw new Error('Spotify sign-in could not be verified. Please connect again.');
  }

  const body = new URLSearchParams({
    client_id: window.SoundboardIntegrations.config().spotifyClientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: getSpotifyRedirectUri(),
    code_verifier: verifier
  });
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!response.ok) {
    throw new Error('Spotify could not complete sign-in. Check the Client ID and registered callback URL.');
  }

  const tokens = await response.json();
  window.SoundboardIntegrations.require('spotify');
  if (state.settings.spotifyClientId !== window.SoundboardIntegrations.config().spotifyClientId) {
    throw new Error('App connection settings changed. Please connect your music account again.');
  }
  state.settings.spotifyAccessToken = tokens.access_token;
  state.settings.spotifyRefreshToken = tokens.refresh_token || state.settings.spotifyRefreshToken || '';
  state.settings.spotifyTokenExpiresAt = Date.now() + (tokens.expires_in * 1000);
  saveSettings();
  sessionStorage.removeItem('spotify-pkce-verifier');
  sessionStorage.removeItem('spotify-oauth-state');
  window.history.replaceState({}, document.title, `${window.location.origin}${window.location.pathname}`);
  syncSpotifyInputs();
  setStatus('Spotify connected. You can now import songs and playlists.');
}

async function handleSpotifyCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  const returnedState = params.get('state');

  if (window.opener && (code || error)) {
    window.opener.postMessage({
      type: 'spotify-oauth-callback',
      code,
      error,
      state: returnedState
    }, '*');
    window.close();
    return;
  }
  if (!window.SoundboardIntegrations.enabled('spotify')) {
    if (code || error) {
      window.history.replaceState({}, document.title, window.location.pathname);
      setStatus('This music integration is disabled by the administrator.');
    }
    return;
  }

  if (error) {
    window.history.replaceState({}, document.title, window.location.pathname);
    setStatus('Spotify sign-in was canceled or denied.');
    return;
  }

  if (!code) {
    return;
  }

  try {
    await exchangeSpotifyCode(code, returnedState);
  } catch (callbackError) {
    window.history.replaceState({}, document.title, window.location.pathname);
    setStatus(callbackError.message || 'Spotify sign-in failed.');
  }
}

window.addEventListener('message', async (event) => {
  const callbackOrigin = new URL(getSpotifyRedirectUri()).origin;
  if (event.origin !== callbackOrigin || event.source !== spotifyAuthPopup || event.data?.type !== 'spotify-oauth-callback') {
    return;
  }
  const popup = spotifyAuthPopup;

  if (event.data.error) {
    setStatus('Spotify sign-in was canceled or denied.');
    spotifyAuthPopup.close();
    spotifyAuthPopup = null;
    return;
  }

  try {
    await exchangeSpotifyCode(event.data.code, event.data.state);
  } catch (error) {
    setStatus(window.SoundboardIntegrations.enabled('spotify')
      ? error.message || 'Spotify sign-in failed.'
      : 'This music integration is disabled by the administrator.');
  } finally {
    popup?.close();
    if (spotifyAuthPopup === popup) spotifyAuthPopup = null;
  }
});

function disconnectSpotify() {
  state.settings.spotifyAccessToken = '';
  state.settings.spotifyRefreshToken = '';
  state.settings.spotifyTokenExpiresAt = 0;
  saveSettings();
  syncSpotifyInputs();
  setStatus('Spotify disconnected from this browser.');
}

async function getValidSpotifyAccessToken() {
  window.SoundboardIntegrations.require('spotify');
  const clientId = window.SoundboardIntegrations.config().spotifyClientId;
  if (!clientId) throw new Error('Ask the administrator to configure the shared client ID first.');
  if (state.settings.spotifyClientId !== clientId) {
    throw new Error('The shared music app has changed. Connect your account again in Settings.');
  }
  if (state.settings.spotifyAccessToken && Date.now() < (state.settings.spotifyTokenExpiresAt || Infinity) - 60000) {
    return state.settings.spotifyAccessToken;
  }

  const refreshToken = state.settings.spotifyRefreshToken;
  if (!refreshToken || !clientId) {
    throw new Error('Connect Spotify from settings before importing.');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  window.SoundboardIntegrations.require('spotify');
  if (!response.ok) {
    disconnectSpotify();
    throw new Error('Spotify session expired. Connect Spotify again from settings.');
  }

  const tokens = await response.json();
  window.SoundboardIntegrations.require('spotify');
  if (clientId !== window.SoundboardIntegrations.config().spotifyClientId) {
    throw new Error('App connection settings changed. Please connect your music account again.');
  }
  state.settings.spotifyAccessToken = tokens.access_token;
  state.settings.spotifyRefreshToken = tokens.refresh_token || refreshToken;
  state.settings.spotifyTokenExpiresAt = Date.now() + (tokens.expires_in * 1000);
  saveSettings();
  syncSpotifyInputs();
  return state.settings.spotifyAccessToken;
}

function parseSpotifyUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  const trimmed = rawUrl.trim();
  const normalized = trimmed.replace(/^https?:\/\/open\.spotify\.com\//i, 'https://open.spotify.com/');
  const match = normalized.match(/(?:spotify\.com\/(track|playlist)\/|spotify:(track|playlist):)([A-Za-z0-9]+)/i);

  if (!match) {
    return null;
  }

  const type = (match[1] || match[2] || '').toLowerCase();
  return {
    type,
    id: match[3],
    url: normalized
  };
}

function getSpotifyTrackUri(track) {
  const parsed = parseSpotifyUrl(track?.spotifyUrl);
  return parsed?.type === 'track' ? `spotify:track:${parsed.id}` : null;
}

// Mobile browsers (iOS especially) block programmatic play inside the hidden Spotify
// iframe, so if audio hasn't started shortly after a request, reveal the player for a tap.
const SPOTIFY_TAP_PROMPT_DELAY_MS = 2500;
let spotifyTapPromptTimer = null;
let spotifyIsPlaying = false;

function hideSpotifyTapPrompt() {
  clearTimeout(spotifyTapPromptTimer);
  spotifyTapPromptTimer = null;
  spotifyEmbedWrap.classList.remove('needs-tap');
  spotifyEmbedWrap.setAttribute('aria-hidden', 'true');
}

function scheduleSpotifyTapPrompt() {
  hideSpotifyTapPrompt();
  spotifyIsPlaying = false;
  spotifyTapPromptTimer = setTimeout(() => {
    spotifyTapPromptTimer = null;
    if (state.customType === 'spotify' && !state.isPaused && !spotifyIsPlaying) {
      spotifyEmbedWrap.classList.add('needs-tap');
      spotifyEmbedWrap.setAttribute('aria-hidden', 'false');
      setStatus('Tap play in the Spotify player to start the music.');
    }
  }, SPOTIFY_TAP_PROMPT_DELAY_MS);
}

function handleSpotifyPlaybackUpdate(event) {
  const playbackData = event.data || {};
  spotifyIsPlaying = !playbackData.isPaused && !playbackData.isBuffering;
  if (spotifyIsPlaying) {
    hideSpotifyTapPrompt();
  }

  if (state.customType !== 'spotify' || !state.currentTrack) {
    return;
  }

  const data = playbackData;
  const position = Math.max(0, Number(data.position) || 0);
  const duration = Math.max(0, Number(data.duration) || 0);
  if (duration > 0) {
    if (!state.currentTrack.durationSeconds) {
      state.currentTrack.durationSeconds = duration / 1000;
      savePlaylists();
      renderBoard();
    }
  }
  state.currentTrackDurationSeconds = getTrackDurationSeconds(state.currentTrack);
  const startMilliseconds = Math.max(0, Number(state.currentTrack.startTime) || 0) * 1000;
  state.currentTrackElapsedMs = Math.max(0, position - startMilliseconds);

  if (state.isPaused || data.isPaused || data.isBuffering) {
    state.currentTrackStartedAt = 0;
    clearTrackPlaybackTimers();
    return;
  }

  state.currentTrackStartedAt = performance.now();
  schedulePlayedThreshold();
  scheduleCurrentTrackCompletion();
  syncCurrentAutoplaySchedule();
  if (state.currentTrackDurationSeconds > 0
      && state.currentTrackElapsedMs >= state.currentTrackDurationSeconds * 1000) {
    finishCurrentTrack(state.currentTrack);
  }
}

function createSpotifyEmbedController(track) {
  if (!window.SoundboardIntegrations.enabled('spotify')) return;
  const uri = getSpotifyTrackUri(track);
  if (!spotifyIframeApi || !uri) {
    return;
  }

  spotifyIframeApi.createController(spotifyEmbedHost, {
    width: '100%',
    height: '152',
    uri
  }, (controller) => {
    spotifyEmbedController = controller;
    controller.addListener('playback_update', handleSpotifyPlaybackUpdate);
    const activeTrack = state.currentTrack;
    const activeUri = getSpotifyTrackUri(activeTrack);
    if (activeUri && state.customType === 'spotify') {
      controller.loadEntity(activeUri, false, Number(activeTrack.startTime) || 0);
      if (state.isPaused) {
        controller.pause();
      } else {
        controller.play();
      }
    }
  });
}

function ensureSpotifyEmbedApi(track) {
  if (!window.SoundboardIntegrations.enabled('spotify')) return;
  if (spotifyEmbedController) {
    const uri = getSpotifyTrackUri(track);
    if (uri) {
      spotifyEmbedController.loadEntity(uri, false, Number(track.startTime) || 0);
      if (state.isPaused) {
        spotifyEmbedController.pause();
      } else {
        spotifyEmbedController.play();
      }
    }
    return;
  }

  if (spotifyIframeApi) {
    createSpotifyEmbedController(track);
    return;
  }
  if (spotifyIframeApiRequested) {
    return;
  }

  spotifyIframeApiRequested = true;
  window.onSpotifyIframeApiReady = (iframeApi) => {
    spotifyIframeApi = iframeApi;
    if (state.customType === 'spotify' && state.currentTrack) {
      createSpotifyEmbedController(state.currentTrack);
    }
  };

  const script = document.createElement('script');
  script.src = 'https://open.spotify.com/embed/iframe-api/v1';
  script.async = true;
  document.head.appendChild(script);
}

async function fetchSpotifyOEmbed(url) {
  window.SoundboardIntegrations.require('spotify');
  const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}&format=json`);
  if (!response.ok) {
    throw new Error('Spotify URL could not be read.');
  }

  const payload = await response.json();
  return {
    title: payload.title || 'Spotify track',
    author: payload.author_name || 'Spotify'
  };
}

async function fetchSpotifyTrackDetails(trackId) {
  const token = await getValidSpotifyAccessToken();
  if (!token) {
    throw new Error('Add a Spotify access token before importing tracks.');
  }

  const response = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error('Spotify token is invalid or the track could not be accessed.');
  }

  const data = await response.json();
  const artistNames = (data.artists || []).map((artist) => artist.name).join(', ');
  return {
    title: data.name || 'Spotify track',
    description: artistNames || 'Spotify import',
    url: data.external_urls?.spotify || '',
    durationSeconds: Math.ceil((Number(data.duration_ms) || 0) / 1000)
  };
}

async function fetchSpotifyPlaylistTracks(playlistId, limit = 100) {
  const token = await getValidSpotifyAccessToken();
  if (!token) {
    throw new Error('Add a Spotify access token before importing a playlist.');
  }

  const tracks = [];
  const headers = { Authorization: `Bearer ${token}` };
  const readPage = async (url) => {
    let response = await fetch(url, { headers });
    if (response.status === 429) {
      const wait = Math.min(5, Number(response.headers.get('Retry-After')) || 1);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      response = await fetch(url, { headers });
    }
    return response;
  };

  let nextUrl = `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=50`;
  let usedLegacy = false;
  while (nextUrl) {
    let response = await readPage(nextUrl);
    if (!usedLegacy && !tracks.length && (response.status === 404 || response.status === 400)) {
      usedLegacy = true;
      nextUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;
      response = await readPage(nextUrl);
    }

    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.json())?.error?.message || '';
      } catch (parseError) {
        detail = '';
      }
      if (response.status === 401) {
        throw new Error('Spotify session expired. Click Reconnect Spotify in Settings and try again.');
      }
      if (response.status === 403) {
        throw new Error('Spotify blocked this playlist. Spotify only lets a personal app read playlists you own or collaborate on. Copy it into one of your own playlists or reconnect Spotify. ' + detail);
      }
      if (response.status === 404) {
        throw new Error('Spotify could not find that playlist. It may be private or an editorial playlist Spotify does not share with apps. ' + detail);
      }
      throw new Error(`Spotify playlist could not be loaded (${response.status}). ${detail}`.trim());
    }

    const payload = await response.json();
    tracks.push(...(payload.items || [])
      .map((entry) => entry.item || entry.track)
      .filter((track) => track && track.type !== 'episode')
      .map((track) => ({
        name: track.name || 'Spotify track',
        description: (track.artists || []).map((artist) => artist.name).join(', ') || 'Spotify import',
        artist: (track.artists || []).map((artist) => artist.name).join(', '),
        sourceUrl: track.external_urls?.spotify || '',
        durationSeconds: Math.ceil((Number(track.duration_ms) || 0) / 1000)
      })));
    nextUrl = payload.next;
  }

  return tracks;
}

async function addOnlineMusic() {
  const url = musicUrlInput.value.trim();
  const provider = getUrlIntegration(url);
  if (provider && !window.SoundboardIntegrations.enabled(provider)) {
    setStatus('This music integration is disabled by the administrator.');
    return;
  }
  const apple = parseAppleMusicUrl(url);
  if (apple) {
    if (apple.type !== 'playlist') {
      setStatus('Apple Music currently supports public playlist imports, not individual song imports.');
      return;
    }
    await importAppleMusicPlaylist(apple);
    return;
  }
  if (parseSpotifyUrl(url)) {
    await importSpotifySelection();
    return;
  }
  if (parseYouTubePlaylistId(url) || parseYouTubeEmbedUrl(url)) {
    await addYouTubeToCategory();
    return;
  }

  setStatus(`Paste a music link from ${window.SoundboardIntegrations.names().join(', ')}.`);
  musicUrlInput.focus();
}

async function importAppleMusicPlaylist(playlist) {
  const categoryKey = getImportCategoryKey(musicCategorySelect);
  const overrides = getMusicOverrides();
  if (!overrides) return;
  addMusicButton.disabled = true;
  try {
    window.SoundboardIntegrations.require('appleMusic');
    const tracks = await fetchAppleMusicPlaylistTracks(playlist);
    window.SoundboardIntegrations.require('appleMusic');
    if (!tracks.length) throw new Error('No accessible songs were found in this Apple Music playlist.');
    const previousTracks = state.playlists[categoryKey];
    state.playlists[categoryKey] = [...(previousTracks || []), ...tracks.map((track) => ({
      name: overrides.name || track.name,
      description: overrides.description || track.description,
      mood: 'custom',
      startTime: overrides.startTime,
      stopTime: overrides.stopTime ?? track.durationSeconds,
      durationSeconds: track.durationSeconds,
      appleMusicUrl: track.sourceUrl,
      played: false
    }))];
    try {
      savePlaylists();
    } catch (error) {
      if (previousTracks) state.playlists[categoryKey] = previousTracks;
      else delete state.playlists[categoryKey];
      throw error;
    }
    renderBoard();
    musicCategorySelect.value = '';
    musicUrlInput.value = '';
    clearMusicOverrides();
    setStatus(`Imported ${tracks.length} Apple Music songs into ${formatCategoryTitle(categoryKey)}. Links only; soundboard playback is not supported yet.`);
  } catch (error) {
    console.error('Apple Music import failed.', error);
    setStatus(window.SoundboardIntegrations.enabled('appleMusic')
      ? error.message || 'Apple Music import failed.'
      : 'This music integration was disabled during import. No songs were saved.');
  } finally {
    addMusicButton.disabled = false;
  }
}

async function importSpotifySelection() {
  const spotifyUrl = musicUrlInput.value.trim();
  const categoryKey = getImportCategoryKey(musicCategorySelect);
  const overrides = getMusicOverrides();
  if (!overrides) {
    return;
  }

  if (!spotifyUrl) {
    setStatus('Paste a Spotify track or playlist URL first.');
    return;
  }

  const parsed = parseSpotifyUrl(spotifyUrl);
  if (!parsed) {
    setStatus('This does not look like a Spotify track or playlist URL.');
    return;
  }

  try {
    if (parsed.type === 'playlist') {
      const playlistTracks = await fetchSpotifyPlaylistTracks(parsed.id);
      window.SoundboardIntegrations.require('spotify');

      if (!playlistTracks.length) {
        setStatus('This Spotify playlist does not contain any tracks.');
        return;
      }

      ensureImportCategory(categoryKey);
      playlistTracks.forEach((track) => {
        state.playlists[categoryKey].push({
          name: overrides.name || track.name,
          description: overrides.description || track.description,
          mood: 'custom',
          startTime: overrides.startTime,
          stopTime: overrides.stopTime ?? (track.durationSeconds || getDefaultStopTime()),
          durationSeconds: track.durationSeconds || 0,
          played: false,
          spotifyUrl: track.sourceUrl || spotifyUrl
        });
      });

      savePlaylists();
      renderBoard();
      musicCategorySelect.value = '';
      musicUrlInput.value = '';
      clearMusicOverrides();
      setStatus(`Imported ${playlistTracks.length} Spotify songs into ${formatCategoryTitle(categoryKey)}.`);
      return;
    }

    if (parsed.type === 'track') {
      const trackInfo = await fetchSpotifyTrackDetails(parsed.id);
      window.SoundboardIntegrations.require('spotify');
      ensureImportCategory(categoryKey);
      state.playlists[categoryKey].push({
        name: overrides.name || trackInfo.title,
        description: overrides.description || trackInfo.description,
        mood: 'custom',
        startTime: overrides.startTime,
        stopTime: overrides.stopTime ?? (trackInfo.durationSeconds || getDefaultStopTime()),
        durationSeconds: trackInfo.durationSeconds || 0,
        played: false,
        spotifyUrl: trackInfo.url || spotifyUrl
      });

      savePlaylists();
      renderBoard();
      musicCategorySelect.value = '';
      musicUrlInput.value = '';
      clearMusicOverrides();
      setStatus(`Added ${trackInfo.title} to ${formatCategoryTitle(categoryKey)}.`);
      return;
    }

  } catch (error) {
    setStatus(window.SoundboardIntegrations.enabled('spotify')
      ? error.message || 'Spotify import failed.'
      : 'This music integration was disabled during import. No songs were saved.');
  }
}

async function loadSpreadsheetLibrary() {
  if (!spreadsheetLibraryPromise) {
    spreadsheetLibraryPromise = import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')
      .catch(() => {
        spreadsheetLibraryPromise = null;
        throw new Error('Excel support could not load. Check your internet connection and try again.');
      });
  }
  return spreadsheetLibraryPromise;
}

function normalizeSpreadsheetHeader(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseSpreadsheetTime(value, label, rowNumber) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return (value.getHours() * 3600) + (value.getMinutes() * 60) + value.getSeconds();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${label} on row ${rowNumber} must be a non-negative time.`);
    }
    return Math.round(value > 0 && value < 1 ? value * 86400 : value);
  }

  const text = String(value).trim();
  const hoursMatch = text.match(/^(\d+):([0-5]?\d):([0-5]?\d)$/);
  if (hoursMatch) {
    return (Number(hoursMatch[1]) * 3600) + (Number(hoursMatch[2]) * 60) + Number(hoursMatch[3]);
  }

  const timecode = parseTimecode(text);
  if (timecode !== null) {
    return timecode;
  }

  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds);
  }
  throw new Error(`${label} on row ${rowNumber} must be MM:SS or seconds.`);
}

async function importSpreadsheetFile(file, localMp3Files = []) {
  const XLSX = await loadSpreadsheetLibrary();
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!worksheet) {
    throw new Error('The workbook does not contain a worksheet.');
  }

  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: true });
  if (rows.length < 2) {
    throw new Error('The Tracks sheet needs a header row and at least one song.');
  }

  const headerIndexes = new Map(rows[0].map((header, index) => [normalizeSpreadsheetHeader(header), index]));
  const getCell = (row, ...names) => {
    for (const name of names) {
      const index = headerIndexes.get(normalizeSpreadsheetHeader(name));
      if (index !== undefined) {
        return row[index] ?? '';
      }
    }
    return '';
  };
  const hasSongName = ['song name', 'name', 'title'].some((name) => headerIndexes.has(name));
  const hasSourceColumn = ['source', 'url', 'spotify url', 'youtube url', 'apple music url', 'mp3 data url'].some((name) => headerIndexes.has(name));
  if (!hasSongName || !hasSourceColumn) {
    throw new Error('The first sheet must include Song Name and source URL columns. Download the example workbook for the expected columns.');
  }

  const additions = new Map();
  const localFilesByName = new Map(localMp3Files.map((mp3File) => [mp3File.name.toLowerCase(), mp3File]));
  let importedRows = 0;
  let importedTracks = 0;
  const addTrack = (categoryKey, track) => {
    if (!additions.has(categoryKey)) {
      additions.set(categoryKey, []);
    }
    additions.get(categoryKey).push(track);
    importedTracks += 1;
  };

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (row.every((cell) => String(cell ?? '').trim() === '')) {
      continue;
    }

    const rowNumber = rowIndex + 1;
    const categoryName = String(getCell(row, 'Category', 'Category Name') ?? '').trim();
    const categoryKey = categoryName ? slugifyCategoryName(categoryName) : 'uncategorized';
    const name = String(getCell(row, 'Song Name', 'Name', 'Title') ?? '').trim();
    const description = String(getCell(row, 'Description') ?? '').trim();
    const mood = String(getCell(row, 'Mood') || 'custom').trim().toLowerCase();
    const startTime = parseSpreadsheetTime(getCell(row, 'Start Time (MM:SS)', 'Start Time', 'Start'), 'Start Time', rowNumber) ?? 0;
    const stopTime = parseSpreadsheetTime(getCell(row, 'Stop Time (MM:SS)', 'Stop Time', 'Stop'), 'Stop Time', rowNumber);
    const durationValue = getCell(row, 'Duration Seconds', 'Duration');
    const durationSeconds = durationValue === '' ? 0 : parseSpreadsheetTime(durationValue, 'Duration Seconds', rowNumber) ?? 0;
    const sourceValue = String(getCell(row, 'Source', 'URL') ?? '').trim();
    let spotifyUrl = String(getCell(row, 'Spotify URL', 'Spotify') ?? '').trim();
    let youtubeUrl = String(getCell(row, 'YouTube URL', 'Youtube URL', 'YouTube') ?? '').trim();
    let appleMusicUrl = String(getCell(row, 'Apple Music URL', 'Apple Music') ?? '').trim();
    let audioDataUrl = String(getCell(row, 'MP3 Data URL', 'Audio Data URL') ?? '').trim();
    const rowProvider = spotifyUrl ? 'spotify' : youtubeUrl ? 'youtube' : appleMusicUrl ? 'appleMusic' : getUrlIntegration(sourceValue);
    if (rowProvider && !window.SoundboardIntegrations.enabled(rowProvider)) {
      throw new Error(`The music source on row ${rowNumber} is disabled by the administrator.`);
    }
    let localMp3File = null;
    if (sourceValue) {
      if (spotifyUrl || youtubeUrl || appleMusicUrl || audioDataUrl) {
        throw new Error(`Use either the Source column or legacy source columns on row ${rowNumber}, not both.`);
      }
      if (/^data:audio\//i.test(sourceValue)) {
        audioDataUrl = sourceValue;
      } else if (parseSpotifyUrl(sourceValue)) {
        spotifyUrl = sourceValue;
      } else if (parseYouTubePlaylistId(sourceValue) || parseYouTubeEmbedUrl(sourceValue)) {
        youtubeUrl = sourceValue;
      } else if (parseAppleMusicUrl(sourceValue)) {
        appleMusicUrl = sourceValue;
      } else {
        const normalizedPath = sourceValue.replace(/^file:\/\//i, '').replace(/\\/g, '/').replace(/^['"]|['"]$/g, '');
        const fileName = normalizedPath.split('/').pop().toLowerCase();
        const localFile = localFilesByName.get(fileName);
        if (!localFile) {
          throw new Error(`MP3 file "${fileName}" on row ${rowNumber} was not selected. Choose the matching file above before importing.`);
        }
        if (!localFile.name.toLowerCase().endsWith('.mp3') && !localFile.type.includes('mpeg')) {
          throw new Error(`Source on row ${rowNumber} matched "${localFile.name}", which is not an MP3 file.`);
        }
        localMp3File = localFile;
      }
    }
    const sourceCount = [spotifyUrl, youtubeUrl, appleMusicUrl, audioDataUrl, localMp3File].filter(Boolean).length;

    if (sourceCount > 1) {
      throw new Error(`Use only one source per song on row ${rowNumber}.`);
    }
    if (stopTime !== null && stopTime <= startTime) {
      throw new Error(`Stop Time on row ${rowNumber} must be later than Start Time.`);
    }
    if (audioDataUrl && !/^data:audio\//i.test(audioDataUrl)) {
      throw new Error(`MP3 Data URL on row ${rowNumber} must be an audio data URL.`);
    }

    const makeTrack = (source = {}) => {
      const trackDuration = Number(source.durationSeconds) || durationSeconds;
      const defaultStopTime = trackDuration > startTime ? trackDuration : 0;
      return {
        name: name || source.name || 'Untitled',
        description: description || source.description || 'Custom cue',
        mood,
        startTime,
        stopTime: stopTime ?? defaultStopTime,
        durationSeconds: trackDuration,
        played: false,
        spotifyUrl: source.spotifyUrl || '',
        appleMusicUrl: source.appleMusicUrl || '',
        youtubeUrl: source.youtubeUrl || '',
        audioDataUrl,
        youtubeEmbedUrl: source.youtubeEmbedUrl || ''
      };
    };

    if (spotifyUrl) {
      const parsed = parseSpotifyUrl(spotifyUrl);
      if (!parsed) {
        throw new Error(`Spotify URL on row ${rowNumber} is invalid.`);
      }
      if (parsed.type === 'playlist') {
        const tracks = await fetchSpotifyPlaylistTracks(parsed.id);
        if (!tracks.length) {
          throw new Error(`Spotify playlist on row ${rowNumber} contains no tracks.`);
        }
        tracks.forEach((track) => addTrack(categoryKey, makeTrack({
          name: track.name,
          description: track.description,
          durationSeconds: track.durationSeconds,
          spotifyUrl: track.sourceUrl || ''
        })));
      } else {
        addTrack(categoryKey, makeTrack({ name: `Spotify track ${parsed.id}`, spotifyUrl: parsed.url }));
      }
    } else if (appleMusicUrl) {
      const apple = parseAppleMusicUrl(appleMusicUrl);
      if (!apple) throw new Error(`Apple Music URL on row ${rowNumber} is invalid.`);
      if (apple.type === 'playlist') {
        const tracks = await fetchAppleMusicPlaylistTracks(apple);
        if (!tracks.length) throw new Error(`Apple Music playlist on row ${rowNumber} contains no accessible songs.`);
        tracks.forEach((track) => addTrack(categoryKey, makeTrack({
          ...track, appleMusicUrl: track.sourceUrl
        })));
      } else {
        addTrack(categoryKey, makeTrack({ appleMusicUrl: apple.url }));
      }
    } else if (youtubeUrl) {
      const playlistId = parseYouTubePlaylistId(youtubeUrl);
      if (playlistId) {
        const tracks = await fetchYouTubePlaylistTracks(playlistId);
        if (!tracks.length) {
          throw new Error(`YouTube playlist on row ${rowNumber} contains no tracks.`);
        }
        tracks.forEach((track) => addTrack(categoryKey, makeTrack({
          name: track.name,
          description: track.description,
          durationSeconds: track.durationSeconds,
          youtubeUrl: track.youtubeUrl,
          youtubeEmbedUrl: track.youtubeEmbedUrl
        })));
      } else {
        const youtubeEmbedUrl = parseYouTubeEmbedUrl(youtubeUrl);
        if (!youtubeEmbedUrl) {
          throw new Error(`YouTube URL on row ${rowNumber} is invalid.`);
        }
        const videoId = youtubeEmbedUrl.match(/\/embed\/([^?]+)/)?.[1] || '';
        addTrack(categoryKey, makeTrack({
          name: `YouTube video ${videoId}`,
          description: 'YouTube video',
          youtubeUrl,
          youtubeEmbedUrl
        }));
      }
    } else if (audioDataUrl) {
      addTrack(categoryKey, makeTrack({ audioDataUrl }));
    } else if (localMp3File) {
      const localName = localMp3File.name.replace(/\.mp3$/i, '').trim() || 'Local MP3';
      const track = makeTrack({ name: localName, description: 'Local MP3' });
      Object.defineProperty(track, 'pendingAudioFile', { value: localMp3File, configurable: true });
      addTrack(categoryKey, track);
    } else {
      if (!name) {
        throw new Error(`Song Name is required on row ${rowNumber} when no source is provided.`);
      }
      addTrack(categoryKey, makeTrack());
    }
    importedRows += 1;
  }

  if (!importedTracks) {
    throw new Error('The spreadsheet does not contain any songs to import.');
  }
  for (const tracks of additions.values()) {
    if (tracks.some((track) => !isTrackIntegrationEnabled(track))) {
      throw new Error('A music integration was disabled while importing. No songs were saved.');
    }
  }

  const storedAudioFiles = [];
  try {
    for (const tracks of additions.values()) {
      for (const track of tracks) {
        if (!track.pendingAudioFile) {
          continue;
        }
        const storageId = createLocalAudioStorageId();
        await saveLocalAudioFile(storageId, track.pendingAudioFile);
        storedAudioFiles.push({ storageId, file: track.pendingAudioFile });
        track.audioStorageId = storageId;
        delete track.pendingAudioFile;
      }
    }
  } catch (error) {
    await Promise.all(storedAudioFiles.map(({ storageId }) => deleteLocalAudioFile(storageId).catch(() => {})));
    throw new Error('Unable to store one or more MP3 files in browser storage.');
  }

  const previousPlaylists = state.playlists;
  const nextPlaylists = { ...state.playlists };
  additions.forEach((tracks, categoryKey) => {
    nextPlaylists[categoryKey] = [...(state.playlists[categoryKey] || []), ...tracks];
  });
  state.playlists = nextPlaylists;
  try {
    savePlaylists();
  } catch (error) {
    state.playlists = previousPlaylists;
    await Promise.all(storedAudioFiles.map(({ storageId }) => deleteLocalAudioFile(storageId).catch(() => {})));
    throw new Error('Unable to save imported songs. The spreadsheet may exceed browser storage limits.');
  }
  storedAudioFiles.forEach(({ storageId, file }) => {
    state.localAudioObjectUrls.set(storageId, URL.createObjectURL(file));
  });
  renderBoard();
  return { rows: importedRows, tracks: importedTracks, categories: additions.size };
}

async function handleSpreadsheetUpload(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  setStatus(`Importing ${file.name}...`);
  try {
    const result = await importSpreadsheetFile(file, Array.from(spreadsheetMp3FilesInput.files || []));
    setStatus(`Imported ${result.tracks} songs from ${result.rows} rows across ${result.categories} categories.`);
  } catch (error) {
    setStatus(error.message || 'Excel import failed.');
  } finally {
    event.target.value = '';
  }
}

async function downloadSpreadsheetExample() {
  try {
    const XLSX = await loadSpreadsheetLibrary();
    const workbook = XLSX.utils.book_new();
    const tracksSheet = XLSX.utils.aoa_to_sheet([
      SPREADSHEET_COLUMNS,
      ['Example Category', 'Example Song', 'Replace with a short description', 'custom', '00:00', '00:30', '']
    ]);
    tracksSheet['!cols'] = [
      { wch: 20 }, { wch: 24 }, { wch: 34 }, { wch: 14 }, { wch: 20 },
      { wch: 20 }, { wch: 48 }
    ];
    const instructionsSheet = XLSX.utils.aoa_to_sheet([
      ['Hockey Soundboard spreadsheet'],
      ['Use one song per row on the Tracks sheet.'],
      [`Source auto-detects enabled music-service URLs (${window.SoundboardIntegrations.names().join(', ') || 'none'}), MP3 data URLs, or local MP3 filenames/paths.`],
      ['Mood is optional and defaults to custom. Built-in fallback moods include celebration, concern, neutral, upbeat, defensive, and playful.'],
      ['Start Time and Stop Time accept MM:SS text or seconds. Stop Time must be later than Start Time.'],
      ['Leave Category blank to import into Uncategorized. Played state is managed by the app and is not included.'],
      ['Enabled service playlists expand into individual songs. Shared API credentials are configured by the administrator. Some sources support external links only.'],
      ['Duration is not required; playback uses source metadata. For MP3 filenames/paths, select the matching MP3 files in the app before importing.']
    ]);
    instructionsSheet['!cols'] = [{ wch: 120 }];
    XLSX.utils.book_append_sheet(workbook, tracksSheet, 'Tracks');
    XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions');
    XLSX.writeFile(workbook, 'hockey-soundboard-example.xlsx');
    setStatus('Downloaded the example Excel workbook.');
  } catch (error) {
    setStatus(error.message || 'Could not create the example workbook.');
  }
}

const SHARE_FIELDS = ['name', 'description', 'mood', 'startTime', 'stopTime', 'durationSeconds', 'spotifyUrl', 'youtubeUrl', 'youtubeEmbedUrl', 'appleMusicUrl', 'audioDataUrl'];

function sharableCategoryKeys() {
  return Object.keys(state.playlists).filter((key) => key !== 'built-in-sounds' && isCategoryIntegrationVisible(key));
}

function findOwnSharedCategory(key) {
  return sharedCategories.find((category) => category.mine && category.key === key);
}

async function sharedApi(method, url, body) {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Sharing request failed.');
  }
  return payload;
}

async function refreshSharedCategories() {
  try {
    sharedCategories = (await sharedApi('GET', '/api/shared-categories')).categories || [];
  } catch (error) {
    sharedCategories = [];
  }
  renderCategorySharing();
}

function renderCategorySharing() {
  const keys = sharableCategoryKeys();
  const previous = shareCategorySelect.value;
  shareCategorySelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose a category...';
  shareCategorySelect.appendChild(placeholder);
  keys.forEach((key) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = `${formatCategoryTitle(key)}${findOwnSharedCategory(key) ? ' (public)' : ' (private)'}`;
    shareCategorySelect.appendChild(option);
  });
  if (keys.includes(previous)) {
    shareCategorySelect.value = previous;
  }
  const selectedShared = findOwnSharedCategory(shareCategorySelect.value);
  shareCategoryButton.textContent = selectedShared ? 'Update shared copy' : 'Share with other users';
  const hasSelection = Boolean(shareCategorySelect.value);
  shareCategoryButton.disabled = !hasSelection;
  unshareCategoryButton.classList.toggle('hidden', !selectedShared);
  exportCategoryExcelButton.disabled = !hasSelection;
  exportCategoryCsvButton.disabled = !hasSelection;

  sharedCategoryList.innerHTML = '';
  const others = sharedCategories.filter((category) => !category.mine);
  if (!others.length) {
    const empty = document.createElement('p');
    empty.className = 'spreadsheet-note';
    empty.textContent = 'No categories have been shared by other users yet.';
    sharedCategoryList.appendChild(empty);
    return;
  }
  others.forEach((category) => {
    const row = document.createElement('div');
    row.className = 'shared-category-row';
    const label = document.createElement('span');
    label.textContent = `${category.name} - ${category.trackCount} songs, shared by ${category.owner}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'source-button secondary';
    button.textContent = 'Add to my board';
    button.addEventListener('click', () => addSharedCategory(category, button, false));
    const privateButton = document.createElement('button');
    privateButton.type = 'button';
    privateButton.className = 'source-button secondary';
    privateButton.textContent = 'Save as private';
    privateButton.title = 'Keep a private copy that is hidden from your board until you show it';
    privateButton.addEventListener('click', () => addSharedCategory(category, privateButton, true));
    row.append(label, button, privateButton);
    sharedCategoryList.appendChild(row);
  });
}

function buildSharableTracks(key) {
  const tracks = (state.playlists[key] || []).map((track) => Object.fromEntries(SHARE_FIELDS.map((field) => [field, track[field]])));
  return tracks;
}

async function shareSelectedCategory() {
  const key = shareCategorySelect.value;
  if (!key) {
    return;
  }
  try {
    const result = await sharedApi('PUT', '/api/shared-categories', {
      key,
      name: formatCategoryTitle(key),
      tracks: buildSharableTracks(key)
    });
    await refreshSharedCategories();
    const skipped = result.skipped ? ` ${result.skipped} songs were left out because they use MP3 files stored only in this browser.` : '';
    setStatus(`Shared ${formatCategoryTitle(key)} with ${result.shared} songs.${skipped}`);
  } catch (error) {
    setStatus(error.message || 'Could not share the category.');
  }
}

async function unshareSelectedCategory() {
  const key = shareCategorySelect.value;
  try {
    await sharedApi('POST', '/api/shared-categories/unshare', { key });
    await refreshSharedCategories();
    setStatus(`${formatCategoryTitle(key)} is private again.`);
  } catch (error) {
    setStatus(error.message || 'Could not make the category private.');
  }
}

async function addSharedCategory(category, button, asPrivate = false) {
  button.disabled = true;
  try {
    const detail = await sharedApi('GET', `/api/shared-category?id=${encodeURIComponent(category.id)}`);
    let key = slugifyCategoryName(detail.name);
    if (state.playlists[key]) {
      key = slugifyCategoryName(`${detail.name} ${detail.owner}`);
    }
    for (let suffix = 2; state.playlists[key]; suffix += 1) {
      key = slugifyCategoryName(`${detail.name} ${detail.owner} ${suffix}`);
    }
    state.playlists[key] = detail.tracks.map((track) => ({
      name: track.name || 'Untitled',
      description: track.description || 'Shared cue',
      mood: track.mood || 'custom',
      startTime: Number(track.startTime) || 0,
      stopTime: Number(track.stopTime) || 0,
      durationSeconds: Number(track.durationSeconds) || 0,
      spotifyUrl: track.spotifyUrl || '',
      appleMusicUrl: track.appleMusicUrl || '',
      youtubeUrl: track.youtubeUrl || '',
      youtubeEmbedUrl: track.youtubeEmbedUrl || '',
      audioDataUrl: track.audioDataUrl || '',
      audioStorageId: '',
      audioUrl: '',
      builtInGroup: '',
      played: false,
      repeatable: false
    }));
    if (asPrivate) {
      state.hiddenCategories.add(key);
      saveHiddenCategories();
    }
    savePlaylists();
    renderBoard();
    setStatus(asPrivate
      ? `Saved a private copy of ${formatCategoryTitle(key)} from ${detail.owner}. Show it from the category visibility list.`
      : `Added ${formatCategoryTitle(key)} from ${detail.owner}.`);
  } catch (error) {
    setStatus(error.message || 'Could not add the shared category.');
  } finally {
    button.disabled = false;
  }
}

function buildExportRows(key, useSeconds) {
  const category = formatCategoryTitle(key);
  const time = (value) => {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    if (!seconds) {
      return '';
    }
    return useSeconds ? seconds : formatTimecode(seconds);
  };
  let skipped = 0;
  const rows = [];
  (state.playlists[key] || []).forEach((track) => {
    if (!isTrackIntegrationEnabled(track)) return;
    const source = track.spotifyUrl || track.youtubeUrl || track.appleMusicUrl || track.audioDataUrl || '';
    if (!source) {
      skipped += 1;
      return;
    }
    rows.push([category, track.name, track.description, track.mood, time(track.startTime), time(track.stopTime), source]);
  });
  return { rows, skipped };
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportSkippedNote(skipped) {
  return skipped ? ` ${skipped} songs were left out because they use MP3 files stored only in this browser.` : '';
}

function exportCategoryCsv() {
  const key = shareCategorySelect.value;
  if (!key) {
    return;
  }
  const { rows, skipped } = buildExportRows(key, true);
  const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [SPREADSHEET_COLUMNS, ...rows].map((row) => row.map(quote).join(',')).join('\r\n');
  downloadBlob(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), `${key}.csv`);
  setStatus(`Downloaded ${rows.length} songs as CSV.${exportSkippedNote(skipped)}`);
}

async function exportCategoryExcel() {
  const key = shareCategorySelect.value;
  if (!key) {
    return;
  }
  try {
    const XLSX = await loadSpreadsheetLibrary();
    const { rows, skipped } = buildExportRows(key, false);
    const sheet = XLSX.utils.aoa_to_sheet([SPREADSHEET_COLUMNS, ...rows]);
    sheet['!cols'] = [{ wch: 20 }, { wch: 24 }, { wch: 34 }, { wch: 14 }, { wch: 20 }, { wch: 20 }, { wch: 48 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Tracks');
    XLSX.writeFile(workbook, `${key}.xlsx`);
    setStatus(`Downloaded ${rows.length} songs as Excel.${exportSkippedNote(skipped)}`);
  } catch (error) {
    setStatus(error.message || 'Could not create the Excel file.');
  }
}

shareCategorySelect.addEventListener('change', renderCategorySharing);
shareCategoryButton.addEventListener('click', shareSelectedCategory);
unshareCategoryButton.addEventListener('click', unshareSelectedCategory);
exportCategoryExcelButton.addEventListener('click', exportCategoryExcel);
exportCategoryCsvButton.addEventListener('click', exportCategoryCsv);
refreshSharedCategories();

function handleLogoFileSelection(event) {  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  if (!file.type.startsWith('image/')) {
    setStatus('Please choose an image file.');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = typeof reader.result === 'string' ? reader.result : '';
    if (!dataUrl) {
      setStatus('Unable to load the selected image.');
      return;
    }

    state.settings.headerLogoUrl = dataUrl;
    headerLogoUrlInput.value = dataUrl;

    const headerLogo = document.querySelector('.team-logo');
    if (headerLogo) {
      headerLogo.src = dataUrl;
    }

    document.body.style.setProperty('--watermark-image', `url("${dataUrl}")`);
    saveSettings();
    setStatus(`Loaded local image: ${file.name}`);
    event.target.value = '';
  };
  reader.readAsDataURL(file);
}

function handleHornFileSelection(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  if (!file.type.startsWith('audio/')) {
    setStatus('Please choose an audio file for the horn.');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = typeof reader.result === 'string' ? reader.result : '';
    state.settings.customHornDataUrl = dataUrl;
    state.settings.builtInHornAudioUrl = 'custom';
    customHornOption.disabled = false;
    builtInHornSelect.value = 'custom';
    saveSettings();
    setStatus(`Loaded custom horn: ${file.name}`);
    event.target.value = '';
  };
  reader.readAsDataURL(file);
}

function toggleSettingsPanel() {
  const isOpening = settingsPanel.classList.contains('hidden');
  settingsPanel.classList.toggle('hidden', !isOpening);
  settingsToggleButton.setAttribute('aria-expanded', String(isOpening));
  if (isOpening) {
    document.getElementById('closeSettings').focus();
  } else {
    document.querySelector('.side-menu-toggle').focus();
  }
}

function closeSettingsPanel() {
  if (!settingsPanel.classList.contains('hidden')) {
    toggleSettingsPanel();
  }
}

function syncFullscreenButtons() {
  const isFullscreen = Boolean(document.fullscreenElement);
  enterFullscreenButton.hidden = isFullscreen;
  exitFullscreenButton.hidden = !isFullscreen;
}

async function enterFullscreen() {
  if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen) {
    setStatus('Full screen is not available in this browser.');
    return;
  }
  try {
    await document.documentElement.requestFullscreen();
  } catch (error) {
    setStatus('Unable to enter full screen.');
  }
}

async function exitFullscreen() {
  if (!document.fullscreenElement || !document.exitFullscreen) {
    syncFullscreenButtons();
    return;
  }
  try {
    await document.exitFullscreen();
  } catch (error) {
    setStatus('Unable to exit full screen.');
  }
}

function toggleMusicLibrary() {
  const isExpanded = musicLibraryToggleButton.getAttribute('aria-expanded') === 'true';
  musicLibraryContent.classList.toggle('hidden', isExpanded);
  musicLibraryToggleButton.textContent = isExpanded ? '+' : '−';
  musicLibraryToggleButton.setAttribute('aria-expanded', String(!isExpanded));
  musicLibraryToggleButton.setAttribute('aria-label', `${isExpanded ? 'Expand' : 'Collapse'} Music library`);
  musicLibraryToggleButton.title = `${isExpanded ? 'Expand' : 'Collapse'} Music library`;
}

function toggleBuiltInSounds() {
  const isExpanded = builtInSoundToggleButton.getAttribute('aria-expanded') === 'true';
  builtInSoundContent.classList.toggle('hidden', isExpanded);
  builtInSoundToggleButton.textContent = isExpanded ? '+' : '−';
  builtInSoundToggleButton.setAttribute('aria-expanded', String(!isExpanded));
  builtInSoundToggleButton.setAttribute('aria-label', `${isExpanded ? 'Expand' : 'Collapse'} Built-in sounds`);
  builtInSoundToggleButton.title = `${isExpanded ? 'Expand' : 'Collapse'} Built-in sounds`;
}

function syncMusicSourceVisibility() {
  const offlineMode = offlineModeToggleInput.checked;
  const browserOffline = !navigator.onLine;
  const localOnly = offlineMode || browserOffline;
  const noOnlineIntegrations = !window.SoundboardIntegrations.names().length;
  const useLocalMp3 = localOnly || noOnlineIntegrations || useLocalMp3Input.checked;
  localMp3ModeSwitch.classList.toggle('hidden', localOnly || noOnlineIntegrations);
  useLocalMp3Input.disabled = localOnly;
  onlineMusicSource.classList.toggle('hidden', useLocalMp3);
  localMp3Source.classList.toggle('hidden', !useLocalMp3);
  offlineModeNotice.classList.toggle('hidden', !localOnly);
  offlineModeNotice.textContent = browserOffline
    ? 'You are offline. Online music needs internet; stored MP3s remain available.'
    : 'Offline mode is on. Only locally stored MP3s can play without internet.';
  document.body.dataset.offlineMode = String(localOnly);
}

function isOfflineModeActive() {
  return offlineModeToggleInput.checked || !navigator.onLine;
}

function isTrackAvailableOffline(track) {
  return Boolean(track.audioDataUrl || track.audioStorageId || track.audioUrl) || (!track.spotifyUrl && !track.youtubeUrl && !track.youtubeEmbedUrl && !track.appleMusicUrl);
}

function isTrackPlayableHere(track) {
  return isTrackIntegrationEnabled(track) && (!track.appleMusicUrl || Boolean(track.audioDataUrl || track.audioStorageId || track.audioUrl || track.spotifyUrl || track.youtubeUrl || track.youtubeEmbedUrl));
}

function getUrlIntegration(url) {
  if (parseAppleMusicUrl(url)) return 'appleMusic';
  if (parseSpotifyUrl(url)) return 'spotify';
  if (parseYouTubePlaylistId(url) || parseYouTubeEmbedUrl(url)) return 'youtube';
  return null;
}

function getTrackIntegration(track) {
  if (track.audioDataUrl || track.audioStorageId || track.audioUrl) return null;
  if (track.youtubeUrl || track.youtubeEmbedUrl) return 'youtube';
  if (track.spotifyUrl) return 'spotify';
  if (track.appleMusicUrl) return 'appleMusic';
  return null;
}

function isTrackIntegrationEnabled(track) {
  const provider = getTrackIntegration(track);
  return !provider || window.SoundboardIntegrations.enabled(provider);
}

function isCategoryIntegrationVisible(key) {
  const tracks = state.playlists[key] || [];
  return !tracks.length || tracks.some(isTrackIntegrationEnabled);
}

function syncOfflineModeViews() {
  syncMusicSourceVisibility();
  if (isOfflineModeActive() && state.currentTrack && !isTrackAvailableOffline(state.currentTrack)) {
    clearTrackPlaybackTimers();
    stopActiveCustomPlayback();
    state.currentTrack = null;
    state.currentCategoryKey = null;
    state.currentTrackIndex = -1;
    state.currentTrackElapsedMs = 0;
    state.currentTrackStartedAt = 0;
    state.currentTrackDurationSeconds = 0;
    state.autoTransitioning = false;
    setStatus('Remote playback stopped in offline mode.');
  }
  renderBoard();
}

function toggleOfflineMode() {
  localStorage.setItem(OFFLINE_MODE_KEY, String(offlineModeToggleInput.checked));
  syncOfflineModeViews();
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
}

function slugifyCategoryName(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'custom-category';
}

function formatCategoryTitle(key) {
  return key
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function setStatus(message) {
  statusBar.textContent = message;
}

function openScoreDialog() {
  scoreScorerNumberInput.value = '';
  populateScoreTeamOptions();
  scoreTeamSelect.value = state.settings.scoreHomeTeamName;
  scoreAssistInputs.forEach((input) => {
    input.value = '';
  });
  scoreDialog.classList.remove('hidden');
  scoreScorerNumberInput.focus();
}

function populateScoreTeamOptions() {
  const selectedTeam = scoreTeamSelect.value;
  scoreTeamSelect.innerHTML = '';
  [state.settings.scoreHomeTeamName, state.settings.scoreAwayTeamName].forEach((teamName) => {
    const option = document.createElement('option');
    option.value = teamName;
    option.textContent = teamName;
    scoreTeamSelect.appendChild(option);
  });
  if ([...scoreTeamSelect.options].some((option) => option.value === selectedTeam)) {
    scoreTeamSelect.value = selectedTeam;
  }
}

function pickAnnouncerVoice() {
  const english = scoreSpeechVoices.filter((voice) => /^en/i.test(voice.lang));
  const preferred = [/guy.*natural/i, /davis.*natural/i, /christopher.*natural/i, /eric.*natural/i, /andrew.*natural/i, /brian.*natural/i, /natural|neural/i, /google uk english male/i, /daniel|alex|david|mark|guy/i];
  for (const pattern of preferred) {
    const match = english.find((voice) => pattern.test(voice.name));
    if (match) {
      return match;
    }
  }
  return english[0] || null;
}

function populateScoreVoiceOptions() {
  const selectedVoiceName = state.settings.scoreVoiceName || '';
  scoreSpeechVoices = 'speechSynthesis' in window ? window.speechSynthesis.getVoices() : [];
  scoreVoiceSelect.innerHTML = '';
  const systemOption = document.createElement('option');
  systemOption.value = '';
  systemOption.textContent = 'Announcer (auto-pick best male voice)';
  scoreVoiceSelect.appendChild(systemOption);

  scoreSpeechVoices.forEach((voice, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${voice.name} (${voice.lang})`;
    option.selected = `${voice.name}|${voice.lang}` === selectedVoiceName;
    scoreVoiceSelect.appendChild(option);
  });
}

function openScoreTeamsDialog() {
  scoreHomeTeamNameInput.value = state.settings.scoreHomeTeamName;
  scoreAwayTeamNameInput.value = state.settings.scoreAwayTeamName;
  scoreTeamsDialog.classList.remove('hidden');
  scoreHomeTeamNameInput.focus();
}

function closeScoreTeamsDialog() {
  scoreTeamsDialog.classList.add('hidden');
}

function saveScoreTeams() {
  applyBrandSettings();
  closeScoreTeamsDialog();
  setStatus('Score announcement teams saved.');
}

function closeScoreDialog() {
  scoreDialog.classList.add('hidden');
}

function formatPlayerNumbers(numbers) {
  if (numbers.length < 2) {
    return numbers[0] || '';
  }
  if (numbers.length === 2) {
    return `${numbers[0]} and ${numbers[1]}`;
  }
  return `${numbers.slice(0, -1).join(', ')}, and ${numbers[numbers.length - 1]}`;
}

function announceScore() {
  const scorerValue = scoreScorerNumberInput.value.trim();
  if (!/^\d{1,2}$/.test(scorerValue)) {
    setStatus('Enter a scorer number from 0 to 99.');
    scoreScorerNumberInput.focus();
    return;
  }

  const scorerNumber = Number(scorerValue);
  const teamName = scoreTeamSelect.value.trim();
  if (!teamName) {
    setStatus('Set both team names in Settings before announcing a goal.');
    scoreTeamSelect.focus();
    return;
  }

  const assistValues = scoreAssistInputs.map((input) => input.value.trim()).filter(Boolean);
  if (assistValues.some((value) => !/^\d{1,2}$/.test(value))) {
    setStatus('Assist numbers must be between 0 and 99.');
    scoreAssistInputs.find((input) => input.value.trim() && !/^\d{1,2}$/.test(input.value.trim()))?.focus();
    return;
  }

  const assistNumbers = assistValues.map(Number);
  if (new Set([scorerNumber, ...assistNumbers]).size !== assistNumbers.length + 1) {
    setStatus('Each player number can only appear once.');
    return;
  }

  const assists = assistNumbers.length
    ? ` Assisted by ${assistNumbers.length === 1 ? 'number' : 'numbers'} ${formatPlayerNumbers(assistNumbers)}.`
    : '';
  const announcement = `Goal! Scored by number ${scorerNumber}, for ${teamName}.${assists}`;
  if ('speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function') {
    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(announcement);
    const selectedVoice = scoreSpeechVoices[Number(scoreVoiceSelect.value)];
    const announcerVoice = scoreVoiceSelect.value && selectedVoice ? selectedVoice : pickAnnouncerVoice();
    if (announcerVoice) {
      utterance.voice = announcerVoice;
      utterance.lang = announcerVoice.lang;
    }
    utterance.rate = 0.9;
    utterance.pitch = scoreVoiceSelect.value ? 1 : 0.8;
    utterance.volume = 1;
    window.speechSynthesis.speak(utterance);
  }
  closeScoreDialog();
  setStatus(announcement);
}

function applySoundboardTitle() {
  const title = state.settings.soundboardName || defaultSettings.soundboardName;
  soundboardTitle.textContent = title;
  soundboardTitle.setAttribute('aria-label', `${title}. Long press or press Enter to rename.`);
  soundboardTitle.title = 'Long press to rename soundboard';
  document.title = title;
}

function openSoundboardTitleEditor() {
  soundboardTitleInput.value = state.settings.soundboardName || defaultSettings.soundboardName;
  soundboardTitleEditor.classList.remove('hidden');
  soundboardTitleInput.focus();
  soundboardTitleInput.select();
}

function closeSoundboardTitleEditor() {
  soundboardTitleEditor.classList.add('hidden');
}

function saveSoundboardTitle() {
  const title = soundboardTitleInput.value.trim();
  if (!title) {
    setStatus('Enter a soundboard name.');
    soundboardTitleInput.focus();
    return;
  }

  state.settings.soundboardName = title;
  saveSettings();
  applySoundboardTitle();
  closeSoundboardTitleEditor();
  setStatus(`Soundboard renamed to ${title}.`);
}

function getImportCategoryKey(categorySelect) {
  return categorySelect.value || 'uncategorized';
}

function ensureImportCategory(categoryKey) {
  if (!state.playlists[categoryKey]) {
    state.playlists[categoryKey] = [];
  }
}

function getMusicOverrides() {
  const startValue = musicStartTimeInput.value.trim();
  const stopValue = musicStopTimeInput.value.trim();
  const startTime = startValue ? parseTimecode(startValue) : 0;
  const stopTime = stopValue ? parseTimecode(stopValue) : null;

  if (startTime === null) {
    setStatus('Enter the start time as min:sec, for example 00:10.');
    musicStartTimeInput.focus();
    return null;
  }
  if (stopValue && stopTime === null) {
    setStatus('Enter the stop time as min:sec, for example 00:30.');
    musicStopTimeInput.focus();
    return null;
  }
  if (stopTime !== null && stopTime <= startTime) {
    setStatus('Stop time must be later than start time.');
    musicStopTimeInput.focus();
    return null;
  }

  return {
    name: musicNameOverrideInput.value.trim(),
    description: musicDescriptionOverrideInput.value.trim(),
    startTime,
    stopTime
  };
}

function clearMusicOverrides() {
  musicNameOverrideInput.value = '';
  musicDescriptionOverrideInput.value = '';
  musicStartTimeInput.value = '';
  musicStopTimeInput.value = '';
}

function getDefaultStopTime() {
  return state.customDuration > 0 ? Math.ceil(state.customDuration) : 0;
}

function formatTimecode(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutesPart = Math.floor(seconds / 60);
  const secondsPart = seconds % 60;
  return `${String(minutesPart).padStart(2, '0')}:${String(secondsPart).padStart(2, '0')}`;
}

function parseTimecode(value) {
  const match = value.trim().match(/^(\d+):([0-5]?\d)$/);
  if (!match) {
    return null;
  }

  return (Number(match[1]) * 60) + Number(match[2]);
}

function clearLongPressTimer(button) {
  if (button && button._longPressTimer) {
    window.clearTimeout(button._longPressTimer);
    button._longPressTimer = null;
  }
}

function createCategoryRenameLongPressTimer(heading, categoryKey) {
  clearLongPressTimer(heading);
  heading._longPressTimer = window.setTimeout(() => {
    openCategoryRenameEditor(categoryKey);
  }, 650);
}

function createSoundboardTitleLongPressTimer(heading) {
  clearLongPressTimer(heading);
  heading._longPressTimer = window.setTimeout(openSoundboardTitleEditor, 650);
}

function openCategoryRenameEditor(categoryKey) {
  if (!state.playlists[categoryKey]) {
    return;
  }

  state.categoryRenameKey = categoryKey;
  categoryRenameInput.value = formatCategoryTitle(categoryKey);
  categoryRenameEditor.classList.remove('hidden');
  categoryRenameInput.focus();
  categoryRenameInput.select();
}

function closeCategoryRenameEditor() {
  categoryRenameEditor.classList.add('hidden');
  state.categoryRenameKey = null;
}

function saveCategoryRename() {
  if (state.categoryRenameKey === null) {
    return;
  }

  if (renameCategory(state.categoryRenameKey, categoryRenameInput.value)) {
    closeCategoryRenameEditor();
  }
}

function openSongEditor(categoryKey, index) {
  const track = state.playlists[categoryKey]?.[index];
  if (!track || !isTrackIntegrationEnabled(track)) {
    return;
  }

  state.songEditor = { categoryKey, index };
  editSongNameInput.value = track.name;
  editSongDescriptionInput.value = track.description;
  editSongCategorySelect.value = categoryKey;
  copySongCategorySelect.value = '';
  Array.from(copySongCategorySelect.options).forEach((option) => {
    option.disabled = option.value === categoryKey;
  });
  editSongLinkInput.value = track.spotifyUrl || track.youtubeUrl || track.youtubeEmbedUrl || track.appleMusicUrl || '';
  editStartTimeInput.value = formatTimecode(track.startTime);
  editStopTimeInput.value = formatTimecode(Number(track.stopTime) || Number(track.durationSeconds) || getDefaultStopTime());
  songEditor.classList.remove('hidden');
}

function closeSongEditor() {
  songEditor.classList.add('hidden');
  state.songEditor = { categoryKey: null, index: null };
}

function copySongToCategory() {
  const { categoryKey, index } = state.songEditor;
  const track = state.playlists[categoryKey]?.[index];
  const targetCategoryKey = copySongCategorySelect.value;
  if (!track) {
    setStatus('This song is no longer available. Reopen its settings.');
    return;
  }
  if (!state.playlists[targetCategoryKey] || targetCategoryKey === categoryKey) {
    setStatus('Choose another category to copy this song to.');
    copySongCategorySelect.focus();
    return;
  }
  const copy = { ...track, played: false };
  state.playlists[targetCategoryKey].push(copy);
  try {
    savePlaylists();
  } catch (error) {
    state.playlists[targetCategoryKey].pop();
    console.error('Could not save the copied song.', error);
    setStatus('Could not save the copied song. Check available browser storage and try again.');
    return;
  }
  renderBoard();
  closeSongEditor();
  setStatus(`Copied ${track.name} to ${formatCategoryTitle(targetCategoryKey)}. The original was kept.`);
}

function saveSongEdits() {
  const { categoryKey, index } = state.songEditor;
  if (categoryKey === null || index === null) {
    return;
  }

  const track = state.playlists[categoryKey]?.[index];
  if (!track) {
    return;
  }
  const previousAudioStorageId = track.audioStorageId;
  const targetCategoryKey = editSongCategorySelect.value;
  if (!state.playlists[targetCategoryKey]) {
    setStatus('Choose a category for this song.');
    editSongCategorySelect.focus();
    return;
  }

  const startSeconds = parseTimecode(editStartTimeInput.value);
  const stopSeconds = parseTimecode(editStopTimeInput.value);
  const link = editSongLinkInput.value.trim();
    if (startSeconds === null || stopSeconds === null) {
      setStatus('Enter both times as min:sec, for example 00:05.');
      (startSeconds === null ? editStartTimeInput : editStopTimeInput).focus();
      return;
    }

  const spotifyLink = link ? parseSpotifyUrl(link) : null;
  const youtubeEmbedUrl = link ? parseYouTubeEmbedUrl(link) : null;
  const appleLink = link ? parseAppleMusicUrl(link) : null;
  const provider = getUrlIntegration(link);
  if (provider && !window.SoundboardIntegrations.enabled(provider)) {
    setStatus('This music integration is disabled by the administrator.');
    return;
  }

  if (link && !spotifyLink && !youtubeEmbedUrl && appleLink?.type !== 'song') {
    setStatus('Enter a valid song link from an enabled music integration.');
    editSongLinkInput.focus();
    return;
  }

  track.name = editSongNameInput.value.trim() || track.name;
  track.description = editSongDescriptionInput.value.trim() || track.description;
  track.startTime = startSeconds;
  track.stopTime = stopSeconds > startSeconds ? stopSeconds : startSeconds;
  track.appleMusicUrl = '';

  if (!link) {
    track.spotifyUrl = '';
    track.youtubeUrl = '';
    track.youtubeEmbedUrl = '';
  } else if (spotifyLink) {
    track.spotifyUrl = spotifyLink.url;
    track.youtubeUrl = '';
    track.youtubeEmbedUrl = '';
    delete track.audioDataUrl;
    delete track.audioStorageId;
    delete track.audioUrl;
  } else if (appleLink?.type === 'song') {
    track.appleMusicUrl = appleLink.url;
    track.spotifyUrl = '';
    track.youtubeUrl = '';
    track.youtubeEmbedUrl = '';
    delete track.audioDataUrl;
    delete track.audioStorageId;
    delete track.audioUrl;
  } else {
    track.spotifyUrl = '';
    track.youtubeUrl = link;
    track.youtubeEmbedUrl = youtubeEmbedUrl;
    delete track.audioDataUrl;
    delete track.audioStorageId;
    delete track.audioUrl;
  }

  const movedCategory = targetCategoryKey !== categoryKey;
  if (movedCategory) {
    state.playlists[categoryKey].splice(index, 1);
    state.playlists[targetCategoryKey].push(track);
    const visitedTracks = state.autoplayVisited.get(categoryKey);
    if (visitedTracks?.delete(track)) {
      const targetVisitedTracks = state.autoplayVisited.get(targetCategoryKey) || new Set();
      targetVisitedTracks.add(track);
      state.autoplayVisited.set(targetCategoryKey, targetVisitedTracks);
    }
    if (state.currentTrack === track) {
      state.currentCategoryKey = targetCategoryKey;
      state.currentTrackIndex = state.playlists[targetCategoryKey].length - 1;
    } else if (state.currentCategoryKey === categoryKey) {
      state.currentTrackIndex = state.playlists[categoryKey].indexOf(state.currentTrack);
    }
  }

  savePlaylists();
  if (link && previousAudioStorageId) {
    removeStoredAudioFile(previousAudioStorageId, track);
  }
  renderBoard();
  closeSongEditor();
  if (movedCategory && state.currentTrack === track) {
    syncCurrentAutoplaySchedule();
  }
  setStatus(movedCategory
    ? `Updated ${track.name} and moved it to ${formatCategoryTitle(targetCategoryKey)}.`
    : `Updated ${track.name}.`);
}

function confirmDeleteAction(label) {
  return window.confirm(`Are you sure you want to delete ${label}?`);
}

function deleteSongFromPlaylist() {
  const { categoryKey, index } = state.songEditor;
  if (categoryKey === null || index === null) {
    return;
  }

  const track = state.playlists[categoryKey]?.[index];
  if (!track) {
    return;
  }

  if (!confirmDeleteAction(`"${track.name}" from ${formatCategoryTitle(categoryKey)}`)) {
    return;
  }

  removeStoredAudioFile(track.audioStorageId, track);
  state.playlists[categoryKey].splice(index, 1);
  if (!state.playlists[categoryKey].length) {
    delete state.playlists[categoryKey];
  }

  savePlaylists();
  renderBoard();
  closeSongEditor();
  setStatus('Song deleted.');
}

function getTrackSourceLabel(track) {
  if (track.audioUrl) {
    return 'Built-in';
  }
  if (track.audioDataUrl || track.audioStorageId) {
    return 'MP3';
  }
  if (track.youtubeEmbedUrl || track.youtubeUrl) {
    return 'YouTube';
  }
  if (track.spotifyUrl) {
    return 'Spotify';
  }
  if (track.appleMusicUrl) {
    return 'Apple Music (link only)';
  }
  return 'Built-in';
}

function createTrackSourceBadge(track) {
  const source = getTrackSourceLabel(track);
  const badge = document.createElement('span');
  badge.className = 'track-source-label';
  badge.title = source;
  badge.setAttribute('aria-label', source);

  if (source === 'Spotify') {
    badge.classList.add('track-source-spotify');
    badge.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M5.5 9c4.2-1.3 9.6-.8 13.2 1.4M6.5 12c3.6-1 8-.6 11.2 1.2M7.4 15c2.7-.7 5.8-.4 8.2.8" fill="none" stroke="#092315" stroke-linecap="round" stroke-width="1.6"/></svg>';
  } else if (source === 'YouTube') {
    badge.classList.add('track-source-youtube');
    badge.innerHTML = '<svg viewBox="0 0 24 18" aria-hidden="true"><rect x="1" y="1" width="22" height="16" rx="4" fill="currentColor"/><path d="m10 5 6 4-6 4z" fill="#192634"/></svg>';
  } else {
    badge.textContent = source;
  }

  const timestamp = document.createElement('span');
  timestamp.className = 'track-position';
  timestamp.hidden = true;
  badge.appendChild(timestamp);
  return badge;
}

function syncTrackPlaybackPosition() {
  let position = Math.max(0, Number(state.currentTrack?.startTime) || 0)
    + getCurrentTrackPlayedMilliseconds() / 1000;
  if (state.customType === 'file') {
    position = customAudio.currentTime;
  } else if (state.customType === 'youtube' && youtubeApiReady) {
    position = youtubeApiPlayer.getCurrentTime();
  }
  const text = formatTimecode(Math.floor(Math.max(0, Number(position) || 0)));
  document.querySelectorAll('.track-button .track-position').forEach((timestamp) => {
    const button = timestamp.closest('.track-button');
    const track = state.playlists[button.dataset.categoryKey]?.[Number(button.dataset.index)];
    const active = Boolean(state.currentTrack && track === state.currentTrack);
    timestamp.hidden = !active;
    timestamp.parentElement.classList.toggle('has-position', active);
    if (active && timestamp.textContent !== text) {
      timestamp.textContent = text;
      timestamp.title = `Song position ${text}`;
      timestamp.setAttribute('aria-label', `Song position ${text}`);
    }
  });
}

function stopActiveCustomPlayback() {
  moodCueTimeouts.forEach((timer) => clearTimeout(timer));
  moodCueTimeouts = [];
  activeMoodOscillators.forEach((oscillator) => oscillator.stop());
  activeMoodOscillators = [];
  customAudio.pause();
  customAudio.removeAttribute('src');
  customAudio.load();
  customAudio.ontimeupdate = null;
  customAudio.onended = null;
  customAudio.onloadedmetadata = null;
    if (youtubeApiReady) {
    youtubeApiPlayer.stopVideo();
  } else {
    youtubePlayer.src = 'about:blank';
  }
    if (state.customType === 'spotify' && spotifyEmbedController) {
      spotifyEmbedController.pause();
    }
  youtubeWrap.classList.add('hidden');
    hideSpotifyTapPrompt();
    spotifyEmbedWrap.classList.add('hidden');
  state.customSource = null;
  state.customType = null;
  state.customDuration = 0;
}

function startLocalAudioPlayback(track, source) {
  const startTime = Number(track.startTime) || 0;
  const stopTime = Number(track.stopTime) || 0;
  customAudio.src = source;
  customAudio.currentTime = startTime;
  customAudio.muted = state.isMuted;
  state.customSource = source;
  state.customType = 'file';
  state.currentTrackElapsedMs = 0;
  state.currentTrackStartedAt = performance.now();
  customAudio.play().catch(() => setStatus(`Unable to play ${track.name}.`));
  customAudio.onended = () => {
    if (state.currentTrack === track) {
      finishCurrentTrack(track);
    }
  };
  customAudio.onloadedmetadata = () => {
    state.customDuration = Number.isFinite(customAudio.duration) ? customAudio.duration : 0;
    if (state.customDuration > 0 && !track.durationSeconds) {
      track.durationSeconds = state.customDuration;
      savePlaylists();
      renderBoard();
    }
    state.currentTrackDurationSeconds = getTrackDurationSeconds(track);
    scheduleAutomaticAdvance(state.currentCategoryKey, track, state.currentTrackDurationSeconds);
  };
  customAudio.ontimeupdate = () => {
    if (stopTime > 0 && customAudio.currentTime >= stopTime) {
      customAudio.pause();
      setStatus(`${track.name} finished its selected section.`);
      finishCurrentTrack(track);
    }
  };
  schedulePlayedThreshold();
  setStatus(track.audioUrl
    ? `${track.name} is playing from built-in sounds.`
    : `${track.name} is playing from your MP3.`);
}

function playCustomSource(track) {
  if (!isTrackIntegrationEnabled(track)) return false;
  const storedObjectUrl = track.audioStorageId ? state.localAudioObjectUrls.get(track.audioStorageId) : '';
  const trackAudioSource = track.audioDataUrl || storedObjectUrl || track.audioUrl || '';
  const trackYouTubeSource = track.youtubeEmbedUrl;
  const trackSpotifySource = getSpotifyTrackUri(track);
  const sourceType = trackAudioSource || track.audioStorageId ? 'file' : trackYouTubeSource ? 'youtube' : trackSpotifySource ? 'spotify' : null;
  const source = trackAudioSource || trackYouTubeSource || trackSpotifySource;
  const startTime = Number(track.startTime) || 0;
  const stopTime = Number(track.stopTime) || 0;

  if (!sourceType || (!source && !(sourceType === 'file' && track.audioStorageId)) || state.isPaused) {
    return false;
  }

  stopActiveCustomPlayback();

  if (sourceType === 'file') {
    if (source) {
      startLocalAudioPlayback(track, source);
      return true;
    }

    state.customSource = track.audioStorageId;
    state.customType = 'file';
    setStatus(`Loading ${track.name}...`);
    loadLocalAudioFile(track.audioStorageId).then((file) => {
      if (!file) {
        throw new Error('The stored MP3 file could not be found. Reimport the file to restore it.');
      }
      const objectUrl = URL.createObjectURL(file);
      state.localAudioObjectUrls.set(track.audioStorageId, objectUrl);
      if (state.currentTrack !== track || state.customType !== 'file') {
        return;
      }
      if (state.isPaused) {
        customAudio.src = objectUrl;
        customAudio.pause();
        return;
      }
      startLocalAudioPlayback(track, objectUrl);
    }).catch((error) => {
      if (state.currentTrack === track) {
        clearTrackPlaybackTimers();
        stopActiveCustomPlayback();
        state.currentTrack = null;
        state.currentCategoryKey = null;
        state.currentTrackIndex = -1;
        state.currentTrackElapsedMs = 0;
        state.currentTrackStartedAt = 0;
        state.currentTrackDurationSeconds = 0;
        renderBoard();
        setStatus(error.message || `Unable to load ${track.name}.`);
      }
    });
    return true;
  }

  if (sourceType === 'youtube') {
    spotifyEmbedWrap.classList.add('hidden');
    ensureYouTubeApi();
    youtubeWrap.classList.add('audio-only');
    youtubeWrap.classList.remove('hidden');
    state.customSource = source;
    state.customType = 'youtube';
    state.youtubeVolume = state.pendingFadeInSeconds > 0 ? 0 : 100;
    const playerUrl = new URL(source);
    playerUrl.searchParams.set('start', String(startTime));
    playerUrl.searchParams.set('enablejsapi', '1');
    playerUrl.searchParams.set('origin', window.location.origin);
    if (stopTime > 0) {
      playerUrl.searchParams.set('end', String(stopTime));
    }
    if (youtubeApiReady) {
      loadYouTubeTrackInApi(track);
    } else {
      youtubePlayer.src = playerUrl.toString();
    }
    state.currentTrackDurationSeconds = getTrackDurationSeconds(track);
    scheduleAutomaticAdvance(state.currentCategoryKey, track, state.currentTrackDurationSeconds);
    setStatus(`Loading ${track.name} from YouTube...`);
    return true;
  }

  if (sourceType === 'spotify') {
    youtubeWrap.classList.add('hidden');
    spotifyEmbedWrap.classList.remove('hidden');
    state.customSource = source;
    state.customType = 'spotify';
    state.currentTrackDurationSeconds = getTrackDurationSeconds(track);
    ensureSpotifyEmbedApi(track);
    scheduleSpotifyTapPrompt();
    setStatus(`${track.name} is opening in Spotify.`);
    return true;
  }

  return false;
}

function playTone({ frequency = 220, duration = 0.24, type = 'sine', volume = 0.08, slide = 0 }) {
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
  if (slide !== 0) {
    oscillator.frequency.linearRampToValueAtTime(frequency + slide, audioContext.currentTime + duration);
  }

  gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(volume, audioContext.currentTime + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);

  oscillator.connect(gainNode);
  gainNode.connect(spectrumAnalyser);

  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
  return oscillator;
}

function trackHornOscillator(oscillator) {
  activeHornOscillators.push(oscillator);
  oscillator.onended = () => {
    activeHornOscillators = activeHornOscillators.filter((active) => active !== oscillator);
    if (!activeHornAudio && !activeHornOscillators.length && !hornCueTimeouts.length) {
      hornPlaying = false;
    }
  };
}

function stopHornPlayback() {
  hornCueTimeouts.forEach((timer) => clearTimeout(timer));
  hornCueTimeouts = [];
  if (activeHornAudio) {
    activeHornAudio.onended = null;
    activeHornAudio.pause();
    try {
      activeHornAudio.currentTime = 0;
    } catch (error) {
      // Metadata may not be loaded yet.
    }
    activeHornAudio = null;
  }
  activeHornOscillators.forEach((oscillator) => {
    try {
      oscillator.stop();
    } catch (error) {
      // Oscillator may already have stopped.
    }
  });
  activeHornOscillators = [];
  hornPlaying = false;
}

function playHornTonePattern(cues, gapMilliseconds = 120) {
  hornCueTimeouts.forEach((timer) => clearTimeout(timer));
  hornCueTimeouts = [];
  hornPlaying = true;
  cues.forEach((cue, index) => {
    const timer = window.setTimeout(() => {
      hornCueTimeouts = hornCueTimeouts.filter((active) => active !== timer);
      if (!state.isPaused) {
        trackHornOscillator(playTone(cue));
      }
      if (!activeHornAudio && !activeHornOscillators.length && !hornCueTimeouts.length) {
        hornPlaying = false;
      }
    }, index * gapMilliseconds);
    hornCueTimeouts.push(timer);
  });
}

function playHornAudio(source, statusMessage) {
  stopHornPlayback();
  const hornAudio = new Audio(source);
  activeHornAudio = hornAudio;
  hornPlaying = true;
  hornAudio.volume = 1;
  hornAudio.onended = () => {
    if (activeHornAudio === hornAudio) {
      activeHornAudio = null;
      hornPlaying = false;
    }
  };
  hornAudio.play().catch(() => {
    if (activeHornAudio === hornAudio) {
      activeHornAudio = null;
      hornPlaying = false;
    }
    setStatus('Unable to play the selected horn.');
  });
  setStatus(statusMessage);
}

function playGoalHorn() {
  if (hornPlaying || activeHornAudio || activeHornOscillators.length || hornCueTimeouts.length) {
    stopHornPlayback();
    setStatus('Horn stopped.');
    return;
  }

  if (state.isPaused) {
    state.isPaused = false;
    syncPauseButton();
  }

  if (state.settings.builtInHornAudioUrl === 'custom' && state.settings.customHornDataUrl) {
    playHornAudio(state.settings.customHornDataUrl, 'Playing the custom horn.');
    return;
  }

  if (state.settings.builtInHornAudioUrl && state.settings.builtInHornAudioUrl) {
    playHornAudio(state.settings.builtInHornAudioUrl, `Playing ${builtInHornSelect.selectedOptions[0]?.textContent || 'built-in horn'}.`);
    return;
  }

  if (state.settings.customHornDataUrl) {
    playHornAudio(state.settings.customHornDataUrl, 'Horn is live.');
    return;
  }

  playHornAudio('sounds/Classic_Horn.wav', 'Playing Classic horn.');
}

function playMoodCue(track) {
  if (state.isPaused) {
    return;
  }

  stopActiveCustomPlayback();

  const patternMap = {
    celebration: [
      { frequency: 330, duration: 0.18, type: 'triangle', volume: 0.08 },
      { frequency: 440, duration: 0.18, type: 'triangle', volume: 0.08, slide: 30 },
      { frequency: 660, duration: 0.25, type: 'sine', volume: 0.07, slide: 60 }
    ],
    concern: [
      { frequency: 210, duration: 0.16, type: 'sine', volume: 0.06 },
      { frequency: 180, duration: 0.18, type: 'sawtooth', volume: 0.05, slide: -20 }
    ],
    neutral: [
      { frequency: 220, duration: 0.18, type: 'sine', volume: 0.05 },
      { frequency: 260, duration: 0.16, type: 'triangle', volume: 0.045 }
    ],
    upbeat: [
      { frequency: 300, duration: 0.14, type: 'triangle', volume: 0.07 },
      { frequency: 450, duration: 0.15, type: 'triangle', volume: 0.07, slide: 50 },
      { frequency: 600, duration: 0.18, type: 'sine', volume: 0.06, slide: 80 }
    ],
    defensive: [
      { frequency: 180, duration: 0.18, type: 'square', volume: 0.05 },
      { frequency: 230, duration: 0.2, type: 'triangle', volume: 0.05, slide: 18 }
    ],
    playful: [
      { frequency: 400, duration: 0.15, type: 'sine', volume: 0.06 },
      { frequency: 520, duration: 0.18, type: 'triangle', volume: 0.06, slide: 30 },
      { frequency: 610, duration: 0.2, type: 'sine', volume: 0.05, slide: 40 }
    ]
  };

  const pattern = patternMap[track.mood] || patternMap.neutral;
  pattern.forEach((cue, index) => {
    const timer = setTimeout(() => {
      moodCueTimeouts = moodCueTimeouts.filter((pending) => pending !== timer);
      if (!state.isMuted && !state.isPaused && state.currentTrack === track) {
        const oscillator = playTone(cue);
        activeMoodOscillators.push(oscillator);
        oscillator.onended = () => {
          activeMoodOscillators = activeMoodOscillators.filter((active) => active !== oscillator);
        };
      }
    }, index * 120);
    moodCueTimeouts.push(timer);
  });

  if (state.spectrogramTimer) {
    clearTimeout(state.spectrogramTimer);
  }
  const cueEndMilliseconds = Math.max(...pattern.map((cue, index) => (index * 120) + (cue.duration * 1000)));
  state.currentTrackDurationSeconds = cueEndMilliseconds / 1000;
  scheduleCurrentTrackCompletion();
  scheduleAutomaticAdvance(state.currentCategoryKey, track, state.currentTrackDurationSeconds);

  setStatus(`${track.name} is playing.`);
}

function setCurrentTrack(track) {
  if (state.spectrogramTimer) {
    clearTimeout(state.spectrogramTimer);
    state.spectrogramTimer = null;
  }
  state.currentTrack = track;
}

function syncTrackSpectrogram() {
  if (spectrogramFrameId) {
    cancelAnimationFrame(spectrogramFrameId);
    spectrogramFrameId = 0;
  }

  syncTrackPlaybackPosition();
  document.querySelectorAll('.track-button').forEach((button) => {
    const track = state.playlists[button.dataset.categoryKey]?.[Number(button.dataset.index)];
    button.classList.toggle('playing', !state.isPaused && track === state.currentTrack);
  });
  document.querySelectorAll('.builtin-sound-button').forEach((button) => {
    const track = state.playlists['built-in-sounds']?.[Number(button.dataset.index)];
    button.classList.toggle('playing', !state.isPaused && track === state.currentTrack);
  });

  if (!state.isPaused && state.currentTrack) {
    spectrogramFrameId = requestAnimationFrame(drawTrackSpectrogramFrame);
  }
}

function drawTrackSpectrogramFrame() {
  syncTrackPlaybackPosition();
  const canvas = document.querySelector('.track-button.playing .track-spectrogram');
  if (!canvas || state.isPaused || !state.currentTrack) {
    spectrogramFrameId = 0;
    return;
  }

  const context = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  context.drawImage(canvas, 1, 0, width - 1, height, 0, 0, width - 1, height);
  context.clearRect(width - 1, 0, 1, height);

  const frequencyData = new Uint8Array(spectrumAnalyser.frequencyBinCount);
  if (state.customType === 'youtube' || state.customType === 'spotify') {
    const time = performance.now() / 1000;
    frequencyData.forEach((value, index, data) => {
      const oscillation = Math.sin((time * (1.8 + index * 0.17)) + (index * 0.72));
      data[index] = 30 + ((oscillation + 1) * 92);
    });
  } else {
    spectrumAnalyser.getByteFrequencyData(frequencyData);
  }

  for (let row = 0; row < height; row += 1) {
    const frequencyIndex = Math.min(frequencyData.length - 1, Math.floor(((height - row) / height) * frequencyData.length));
    const intensity = frequencyData[frequencyIndex] / 255;
    if (intensity < 0.035) {
      continue;
    }

    context.fillStyle = `hsl(${150 - (intensity * 145)} 94% ${18 + (intensity * 42)}%)`;
    context.fillRect(width - 1, row, 1, 1);
  }

  spectrogramFrameId = requestAnimationFrame(drawTrackSpectrogramFrame);
}

function renderSongOptions() {
  const editCategoryValue = editSongCategorySelect.value;
  const copyCategoryValue = copySongCategorySelect.value;
  const musicCurrentValue = musicCategorySelect.value;
  const mp3CurrentValue = mp3CategorySelect.value;
  editSongCategorySelect.innerHTML = '';
  copySongCategorySelect.innerHTML = '';
  musicCategorySelect.innerHTML = '';
  mp3CategorySelect.innerHTML = '';

  const editCategoryPlaceholder = document.createElement('option');
  editCategoryPlaceholder.value = '';
  editCategoryPlaceholder.textContent = 'Choose a category';
  editSongCategorySelect.appendChild(editCategoryPlaceholder);
  const copyCategoryPlaceholder = document.createElement('option');
  copyCategoryPlaceholder.value = '';
  copyCategoryPlaceholder.textContent = 'Choose another category';
  copySongCategorySelect.appendChild(copyCategoryPlaceholder);

  const musicCategoryPlaceholder = document.createElement('option');
  musicCategoryPlaceholder.value = '';
  musicCategoryPlaceholder.textContent = 'Uncategorized';
  musicCategorySelect.appendChild(musicCategoryPlaceholder);

  const mp3CategoryPlaceholder = document.createElement('option');
  mp3CategoryPlaceholder.value = '';
  mp3CategoryPlaceholder.textContent = 'Uncategorized';
  mp3CategorySelect.appendChild(mp3CategoryPlaceholder);

  Object.keys(state.playlists).filter(isCategoryIntegrationVisible).forEach((key) => {
    const editCategoryOption = document.createElement('option');
    editCategoryOption.value = key;
    editCategoryOption.textContent = formatCategoryTitle(key);
    editCategoryOption.selected = key === editCategoryValue;
    editSongCategorySelect.appendChild(editCategoryOption);
    const copyCategoryOption = document.createElement('option');
    copyCategoryOption.value = key;
    copyCategoryOption.textContent = formatCategoryTitle(key);
    copyCategoryOption.selected = key === copyCategoryValue;
    copyCategoryOption.disabled = key === state.songEditor.categoryKey;
    copySongCategorySelect.appendChild(copyCategoryOption);

    const musicOption = document.createElement('option');
    musicOption.value = key;
    musicOption.textContent = formatCategoryTitle(key);
    musicOption.selected = key === musicCurrentValue;
    musicCategorySelect.appendChild(musicOption);

    const mp3Option = document.createElement('option');
    mp3Option.value = key;
    mp3Option.textContent = formatCategoryTitle(key);
    mp3Option.selected = key === mp3CurrentValue;
    mp3CategorySelect.appendChild(mp3Option);
  });

}

function clearDropIndicators() {
  document.querySelectorAll('.track-button.drop-before, .track-button.drop-after').forEach((button) => {
    button.classList.remove('drop-before', 'drop-after');
  });
  document.querySelectorAll('.playlist-column.drop-target, .playlist-column.category-drop-target, .playlist-column.category-dragging').forEach((column) => {
    column.classList.remove('drop-target', 'category-drop-target', 'category-dragging');
  });
  boardElement.querySelector('.category-drop-slot')?.remove();
}

const CATEGORY_GRID_ROW_HEIGHT = 110;
const CATEGORY_GRID_GAP = 10;
const CATEGORY_GRID_MIN_COLUMN_WIDTH = 270;
const CATEGORY_GRID_MAX_WIDTH = 2;
const CATEGORY_GRID_MIN_HEIGHT = 3;
const CATEGORY_GRID_MAX_HEIGHT = 10;
const CATEGORY_GRID_DEFAULT_HEIGHT = 4;
let categoryGrid = { columns: 1, rows: CATEGORY_GRID_MAX_HEIGHT, cellWidth: CATEGORY_GRID_MIN_COLUMN_WIDTH, placement: new Map() };

function categoryRectsOverlap(a, b) {
  return a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;
}

function categoryRectOverlapsOthers(placement, key, rect) {
  return [...placement].some(([otherKey, other]) => otherKey !== key && categoryRectsOverlap(other, rect));
}

function computeCategoryPlacement(keys, columns) {
  const placement = new Map();
  const pending = [];
  keys.forEach((key) => {
    const saved = state.categorySizes[key] || {};
    const rect = {
      col: saved.col,
      row: saved.row,
      w: Math.min(columns, saved.w || 1),
      h: saved.h || CATEGORY_GRID_DEFAULT_HEIGHT
    };
    if (Number.isInteger(rect.col) && Number.isInteger(rect.row) && rect.col >= 0 && rect.row >= 0
      && rect.col + rect.w <= columns && !categoryRectOverlapsOthers(placement, key, rect)) {
      placement.set(key, rect);
    } else {
      pending.push({ key, w: rect.w, h: rect.h });
    }
  });

  pending.forEach(({ key, w, h }) => {
    for (let row = 0; !placement.has(key); row += 1) {
      for (let col = 0; col + w <= columns; col += 1) {
        const rect = { col, row, w, h };
        if (!categoryRectOverlapsOthers(placement, key, rect)) {
          placement.set(key, rect);
          break;
        }
      }
    }
  });
  return placement;
}

const MOBILE_BOARD_QUERY = window.matchMedia('(max-width: 720px)');
const MOBILE_VISIBLE_SONGS = 2;

function isMobileBoardLayout() {
  return MOBILE_BOARD_QUERY.matches;
}

// Phones stack categories in desktop reading order without touching saved desktop positions.
function applyMobileBoardLayout(cards) {
  boardElement.classList.add('board-mobile');
  boardElement.style.gridTemplateColumns = '';
  boardElement.style.gridTemplateRows = '';
  boardElement.querySelectorAll('.category-grid-cell').forEach((cell) => cell.remove());
  delete boardElement.dataset.gridColumns;
  categoryGrid = { columns: 1, rows: 0, cellWidth: boardElement.clientWidth, placement: new Map() };

  const position = (card) => {
    const saved = state.categorySizes[card.dataset.categoryKey] || {};
    return Number.isInteger(saved.row) && Number.isInteger(saved.col)
      ? [saved.row, saved.col]
      : [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  };
  cards
    .map((card, index) => ({ card, index, pos: position(card) }))
    .sort((a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || a.index - b.index)
    .forEach(({ card }, order) => {
      card.style.gridColumn = '';
      card.style.gridRow = '';
      card.style.order = String(order);
      fitTrackListToVisibleSongs(card.querySelector('.track-list'));
    });
}

function fitTrackListToVisibleSongs(list) {
  if (!list) {
    return;
  }
  const songs = list.querySelectorAll('.track-button');
  if (songs.length <= MOBILE_VISIBLE_SONGS) {
    list.style.maxHeight = '';
    return;
  }
  const first = songs[0].getBoundingClientRect();
  const last = songs[MOBILE_VISIBLE_SONGS - 1].getBoundingClientRect();
  if (!first.height || !last.height) {
    return;
  }
  list.style.maxHeight = `${Math.ceil(last.bottom - first.top) + 2}px`;
}

function updateCategoryGridLayout() {
  const boardWidth = boardElement.clientWidth;
  if (!boardWidth) {
    return;
  }

  const cards = [...boardElement.querySelectorAll('.playlist-column')];
  if (isMobileBoardLayout()) {
    applyMobileBoardLayout(cards);
    return;
  }
  if (boardElement.classList.contains('board-mobile')) {
    boardElement.classList.remove('board-mobile');
    cards.forEach((card) => {
      card.style.order = '';
      const list = card.querySelector('.track-list');
      if (list) {
        list.style.maxHeight = '';
      }
    });
  }

  const columns = Math.max(1, Math.floor((boardWidth + CATEGORY_GRID_GAP) / (CATEGORY_GRID_MIN_COLUMN_WIDTH + CATEGORY_GRID_GAP)));
  const cellWidth = (boardWidth - CATEGORY_GRID_GAP * (columns - 1)) / columns;
  const placement = computeCategoryPlacement(cards.map((card) => card.dataset.categoryKey), columns);
  const bottom = Math.max(0, ...[...placement.values()].map((rect) => rect.row + rect.h));
  const rows = Math.max(CATEGORY_GRID_MAX_HEIGHT, bottom + 2);
  categoryGrid = { columns, rows, cellWidth, placement };

  boardElement.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  boardElement.style.gridTemplateRows = `repeat(${rows}, ${CATEGORY_GRID_ROW_HEIGHT}px)`;

  const cells = boardElement.querySelectorAll('.category-grid-cell');
  if (cells.length !== columns * rows || boardElement.dataset.gridColumns !== String(columns)) {
    cells.forEach((cell) => cell.remove());
    const fragment = document.createDocumentFragment();
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        const cell = document.createElement('div');
        cell.className = 'category-grid-cell';
        cell.setAttribute('aria-hidden', 'true');
        cell.style.gridColumn = String(col + 1);
        cell.style.gridRow = String(row + 1);
        fragment.appendChild(cell);
      }
    }
    boardElement.prepend(fragment);
    boardElement.dataset.gridColumns = String(columns);
  }

  cards.forEach((card) => {
    const rect = placement.get(card.dataset.categoryKey);
    card.style.gridColumn = `${rect.col + 1} / span ${rect.w}`;
    card.style.gridRow = `${rect.row + 1} / span ${rect.h}`;
  });
}

function getCategoryGridDropTarget(event) {
  const current = categoryGrid.placement.get(state.categoryDragKey);
  if (!current) {
    return null;
  }
  const boardRect = boardElement.getBoundingClientRect();
  const offset = state.categoryDragOffset || { x: 0, y: 0 };
  const col = Math.round((event.clientX - boardRect.left - offset.x) / (categoryGrid.cellWidth + CATEGORY_GRID_GAP));
  const row = Math.round((event.clientY - boardRect.top - offset.y) / (CATEGORY_GRID_ROW_HEIGHT + CATEGORY_GRID_GAP));
  const rect = {
    col: Math.max(0, Math.min(categoryGrid.columns - current.w, col)),
    row: Math.max(0, Math.min(categoryGrid.rows - current.h, row)),
    w: current.w,
    h: current.h
  };
  return { ...rect, valid: !categoryRectOverlapsOthers(categoryGrid.placement, state.categoryDragKey, rect) };
}

function showCategoryDropSlot(target) {
  let slot = boardElement.querySelector('.category-drop-slot');
  if (!slot) {
    slot = document.createElement('div');
    slot.className = 'category-drop-slot';
    slot.setAttribute('aria-hidden', 'true');
    boardElement.appendChild(slot);
  }
  slot.classList.toggle('invalid', !target.valid);
  slot.style.gridColumn = `${target.col + 1} / span ${target.w}`;
  slot.style.gridRow = `${target.row + 1} / span ${target.h}`;
}

boardElement.addEventListener('dragover', (event) => {
  if (!state.categoryDragKey || isMobileBoardLayout()) {
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const target = getCategoryGridDropTarget(event);
  if (target) {
    showCategoryDropSlot(target);
  }
});

boardElement.addEventListener('drop', (event) => {
  const categoryKey = state.categoryDragKey;
  if (!categoryKey) {
    return;
  }
  event.preventDefault();
  if (isMobileBoardLayout()) {
    state.categoryDragKey = null;
    clearDropIndicators();
    return;
  }
  const target = getCategoryGridDropTarget(event);
  state.categoryDragKey = null;
  clearDropIndicators();
  if (!target?.valid) {
    setStatus('That spot is already taken.');
    return;
  }
  commitCategoryLayout(categoryKey, target);
  saveCategorySizes();
  updateCategoryGridLayout();
  setStatus(`${formatCategoryTitle(categoryKey)} moved.`);
});

function setDropIndicator(button, event) {
  if (!button) {
    clearDropIndicators();
    return;
  }

  const rect = button.getBoundingClientRect();
  const midpoint = rect.top + (rect.height / 2);
  const placeAfter = event.clientY > midpoint;

  clearDropIndicators();
  button.classList.add(placeAfter ? 'drop-after' : 'drop-before');
}

function scrollTrackListToButton(list, button) {
  if (!list || !button) {
    return;
  }

  requestAnimationFrame(() => {
    if (!list.isConnected || !button.isConnected) {
      return;
    }
    const listRect = list.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    if (buttonRect.top < listRect.top) {
      list.scrollTop -= listRect.top - buttonRect.top;
    } else if (buttonRect.bottom > listRect.bottom) {
      list.scrollTop += buttonRect.bottom - listRect.bottom;
    }
  });
}

function commitCategoryLayout(categoryKey, rect) {
  categoryGrid.placement.forEach((placed, key) => {
    const saved = state.categorySizes[key] || {};
    state.categorySizes[key] = { w: saved.w || 1, h: saved.h || CATEGORY_GRID_DEFAULT_HEIGHT, col: placed.col, row: placed.row };
  });
  state.categorySizes[categoryKey] = { col: rect.col, row: rect.row, w: rect.w, h: rect.h };
}

function resizeCategoryCard(categoryKey, width, height, persist = true) {
  const current = categoryGrid.placement.get(categoryKey);
  if (!current) {
    return false;
  }
  const w = Math.max(1, Math.min(CATEGORY_GRID_MAX_WIDTH, categoryGrid.columns, Math.round(width)));
  const h = Math.max(CATEGORY_GRID_MIN_HEIGHT, Math.min(CATEGORY_GRID_MAX_HEIGHT, Math.round(height)));
  const next = { col: Math.min(current.col, categoryGrid.columns - w), row: current.row, w, h };
  if (categoryRectOverlapsOthers(categoryGrid.placement, categoryKey, next)) {
    return false;
  }
  if (next.col === current.col && w === current.w && h === current.h) {
    return true;
  }
  commitCategoryLayout(categoryKey, next);
  updateCategoryGridLayout();
  if (persist) {
    saveCategorySizes();
  }
  return true;
}

function beginCategoryCardResize(event, categoryKey, column) {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();

  const startX = event.clientX;
  const startY = event.clientY;
  const rect = column.getBoundingClientRect();

  const handlePointerMove = (moveEvent) => {
    const width = (rect.width + moveEvent.clientX - startX + CATEGORY_GRID_GAP) / (categoryGrid.cellWidth + CATEGORY_GRID_GAP);
    const height = (rect.height + moveEvent.clientY - startY + CATEGORY_GRID_GAP) / (CATEGORY_GRID_ROW_HEIGHT + CATEGORY_GRID_GAP);
    resizeCategoryCard(categoryKey, width, height, false);
  };
  const finishResize = () => {
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', finishResize);
    document.removeEventListener('pointercancel', finishResize);
    saveCategorySizes();
  };

  document.addEventListener('pointermove', handlePointerMove);
  document.addEventListener('pointerup', finishResize);
  document.addEventListener('pointercancel', finishResize);
}

window.addEventListener('resize', updateCategoryGridLayout);

function reorderSongs(sourceCategoryKey, fromIndex, targetCategoryKey, targetIndex) {
  const sourceTracks = state.playlists[sourceCategoryKey];
  const targetTracks = state.playlists[targetCategoryKey];
  if (!sourceTracks || !targetTracks || fromIndex < 0 || fromIndex >= sourceTracks.length || targetIndex < 0) {
    return;
  }

  const [movedTrack] = sourceTracks.splice(fromIndex, 1);
  const sameCategory = sourceCategoryKey === targetCategoryKey;
  const insertIndex = Math.max(0, Math.min(targetIndex - (sameCategory && fromIndex < targetIndex ? 1 : 0), targetTracks.length));
  targetTracks.splice(insertIndex, 0, movedTrack);

  if (!sameCategory) {
    const sourceVisitedTracks = state.autoplayVisited.get(sourceCategoryKey);
    if (sourceVisitedTracks?.delete(movedTrack)) {
      const targetVisitedTracks = state.autoplayVisited.get(targetCategoryKey) || new Set();
      targetVisitedTracks.add(movedTrack);
      state.autoplayVisited.set(targetCategoryKey, targetVisitedTracks);
    }
  }

  if (state.currentCategoryKey === sourceCategoryKey && state.currentTrack) {
    state.currentTrackIndex = sourceTracks.indexOf(state.currentTrack);
  }
  const movedCurrentTrack = state.currentTrack === movedTrack;
  if (movedCurrentTrack) {
    state.currentCategoryKey = targetCategoryKey;
    state.currentTrackIndex = insertIndex;
  } else if (state.currentCategoryKey === targetCategoryKey && state.currentTrack) {
    state.currentTrackIndex = targetTracks.indexOf(state.currentTrack);
  }

  savePlaylists();
  renderBoard();
  if (movedCurrentTrack) {
    syncCurrentAutoplaySchedule();
  }
  setStatus(sameCategory
    ? 'Song order updated.'
    : `Moved song to ${formatCategoryTitle(targetCategoryKey)}.`);
}

function renderBoard() {
  boardElement.innerHTML = '';
  renderCategoryVisibilityPicker();

  const visibleCategories = Object.entries(state.playlists)
    .filter(([key]) => key !== 'built-in-sounds' && !state.hiddenCategories.has(key) && isCategoryIntegrationVisible(key));

  visibleCategories.forEach(([key, tracks]) => {
    const column = document.createElement('section');
    column.className = 'playlist-column';
    column.dataset.categoryKey = key;
    column.addEventListener('dragover', (event) => {
      if (!state.dragInfo || event.target.closest('.track-button')) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      column.classList.add('drop-target');
    });
    column.addEventListener('dragleave', (event) => {
      if (!column.contains(event.relatedTarget)) {
        column.classList.remove('drop-target', 'category-drop-target');
      }
    });
    column.addEventListener('drop', (event) => {
      if (!state.dragInfo || event.target.closest('.track-button')) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const { categoryKey: sourceCategoryKey, fromIndex } = state.dragInfo;
      reorderSongs(sourceCategoryKey, fromIndex, key, tracks.length);
      state.dragInfo = null;
      clearDropIndicators();
    });

    const headerRow = document.createElement('div');
    headerRow.className = 'playlist-header';

    const headerTop = document.createElement('div');
    headerTop.className = 'playlist-header-top';

    const heading = document.createElement('h2');
    heading.textContent = formatCategoryTitle(key);
    heading.title = 'Drag to reorder; long press to rename category';
    heading.tabIndex = 0;
    heading.draggable = true;
    heading.setAttribute('aria-label', `${formatCategoryTitle(key)} category. Long press or press Enter to rename.`);
    heading.addEventListener('pointerdown', () => createCategoryRenameLongPressTimer(heading, key));
    heading.addEventListener('pointerup', () => clearLongPressTimer(heading));
    heading.addEventListener('pointerleave', () => clearLongPressTimer(heading));
    heading.addEventListener('pointercancel', () => clearLongPressTimer(heading));
    heading.addEventListener('contextmenu', (event) => event.preventDefault());
    heading.addEventListener('dragstart', (event) => {
      clearLongPressTimer(heading);
      state.categoryDragKey = key;
      const columnRect = column.getBoundingClientRect();
      state.categoryDragOffset = { x: event.clientX - columnRect.left, y: event.clientY - columnRect.top };
      state.dragInfo = null;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', `category:${key}`);
      column.classList.add('category-dragging');
    });
    heading.addEventListener('dragend', () => {
      state.categoryDragKey = null;
      clearDropIndicators();
    });
    heading.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openCategoryRenameEditor(key);
      }
    });
    const categorySettings = getCategorySettings(key);

    const playButton = document.createElement('button');
    playButton.type = 'button';
    playButton.className = 'playlist-play';
    playButton.setAttribute('aria-label', `Play ${formatCategoryTitle(key)} category`);
    playButton.textContent = '▶';
    playButton.addEventListener('click', () => {
      const firstAvailableIndex = tracks.findIndex((track) => !track.played && isTrackPlayableHere(track) && (!isOfflineModeActive() || isTrackAvailableOffline(track)));
      if (firstAvailableIndex < 0) {
        setStatus(isOfflineModeActive()
          ? `No offline-ready songs in ${formatCategoryTitle(key)}.`
          : `No unplayed soundboard-playable songs in ${formatCategoryTitle(key)}. External-link entries cannot play here.`);
        return;
      }

      resumeForCategoryPlayback();
      startCategoryTrack(key, firstAvailableIndex, tracks[firstAvailableIndex]);
    });

    const headerActions = document.createElement('div');
    headerActions.className = 'playlist-header-actions';

    const autoplayButton = document.createElement('button');
    autoplayButton.type = 'button';
    autoplayButton.className = 'playlist-autoplay';
    autoplayButton.setAttribute('aria-pressed', String(categorySettings.autoplay));
    autoplayButton.setAttribute('aria-label', `${categorySettings.autoplay ? 'Turn off' : 'Turn on'} autoplay for ${formatCategoryTitle(key)}`);
    autoplayButton.textContent = categorySettings.autoplay ? 'Auto On' : 'Auto Off';
    autoplayButton.addEventListener('click', () => {
      updateCategorySetting(key, 'autoplay', !getCategorySettings(key).autoplay);
      renderBoard();
      setStatus(`${formatCategoryTitle(key)} autoplay ${getCategorySettings(key).autoplay ? 'enabled' : 'disabled'}.`);
    });

    headerActions.appendChild(playButton);
    headerActions.appendChild(autoplayButton);
    headerTop.appendChild(heading);
    headerTop.appendChild(headerActions);

    headerRow.appendChild(headerTop);

    const fadeControl = document.createElement('label');
    fadeControl.className = 'playlist-fade-control';
    const fadeLabel = document.createElement('span');
    fadeLabel.textContent = 'Fade to next';
    const fadeInput = document.createElement('input');
    fadeInput.type = 'number';
    fadeInput.min = '0';
    fadeInput.max = '10';
    fadeInput.step = '0.25';
    fadeInput.value = String(categorySettings.crossfadeSeconds);
    fadeInput.setAttribute('aria-label', `${formatCategoryTitle(key)} fade duration in seconds`);
    fadeInput.addEventListener('change', () => {
      const seconds = Math.min(10, Math.max(0, Number(fadeInput.value) || 0));
      updateCategorySetting(key, 'crossfadeSeconds', seconds);
      fadeInput.value = String(seconds);
    });
    const fadeUnits = document.createElement('span');
    fadeUnits.textContent = 'sec';
    fadeControl.append(fadeLabel, fadeInput, fadeUnits);

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'playlist-reset';
    resetButton.setAttribute('aria-label', `Reset ${formatCategoryTitle(key)} category`);
    resetButton.textContent = '↺';
    resetButton.addEventListener('click', () => {
      tracks.forEach((track) => {
        track.played = false;
      });
      state.autoplayVisited.delete(key);
      savePlaylists();
      renderBoard();
      setStatus(`Reset category: ${formatCategoryTitle(key)}.`);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'playlist-delete';
    deleteButton.setAttribute('aria-label', `Delete ${formatCategoryTitle(key)} category`);
    deleteButton.textContent = '🗑';
    deleteButton.addEventListener('click', () => {
      const categoryName = formatCategoryTitle(key);
      if (!confirmDeleteAction(`the ${categoryName} category`)) {
        return;
      }

      delete state.playlists[key];
      tracks.forEach((track) => removeStoredAudioFile(track.audioStorageId, track));
      delete state.categorySettings[key];
      delete state.categorySizes[key];
      state.hiddenCategories.delete(key);
      state.autoplayVisited.delete(key);
      savePlaylists();
      saveCategorySettings();
      saveCategorySizes();
      saveHiddenCategories();
      renderBoard();
      setStatus(`Deleted category: ${categoryName}.`);
    });

    const list = document.createElement('div');
    list.className = 'track-list';

    tracks.forEach((track, index) => {
      if (!isTrackIntegrationEnabled(track)) return;
      if (isOfflineModeActive() && !isTrackAvailableOffline(track)) {
        return;
      }

      const button = document.createElement('button');
      button.className = 'track-button';
      button.type = 'button';
      button.draggable = true;
      button.dataset.categoryKey = key;
      button.dataset.index = String(index);
      button.innerHTML = `
        <canvas class="track-spectrogram" width="84" height="24" aria-hidden="true"></canvas>
        <span class="track-title"></span>
        <span class="track-description"></span>
      `;
      button.querySelector('.track-title').textContent = track.name;
      button.querySelector('.track-description').textContent = track.description;
      const durationLabel = document.createElement('span');
      durationLabel.className = 'track-duration-label';
      durationLabel.textContent = formatTrackCardDuration(track);
      durationLabel.title = `Clip duration ${durationLabel.textContent}`;
      button.appendChild(durationLabel);
      button.appendChild(createTrackSourceBadge(track));
      if (!isTrackPlayableHere(track)) {
        const openLabel = document.createElement('span');
        openLabel.textContent = 'Open in Apple Music';
        button.appendChild(openLabel);
      }
      {
        const dragHandle = document.createElement('span');
        dragHandle.className = 'track-drag-handle';
        dragHandle.textContent = '\u2807';
        dragHandle.title = 'Edit this song';
        dragHandle.setAttribute('aria-hidden', 'true');
        dragHandle.addEventListener('click', (clickEvent) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
          openSongEditor(key, index);
        });
        button.appendChild(dragHandle);
      }
      button.classList.toggle('playing', !state.isPaused && track === state.currentTrack);

      button.addEventListener('click', (event) => {
        if (track.played) {
          setStatus(`${track.name} has already been used in this playlist.`);
          return;
        }
        if (!isTrackPlayableHere(track)) {
          const apple = parseAppleMusicUrl(track.appleMusicUrl);
          if (apple?.type === 'song') {
            window.open(apple.url, '_blank', 'noopener,noreferrer');
            setStatus('Opened Apple Music. This song cannot play inside the soundboard yet.');
          } else {
            setStatus('This Apple Music song link is invalid. Update it in song settings.');
          }
          return;
        }
        if (state.isPaused) {
          setStatus('Playback is paused. Resume before selecting a song.');
          return;
        }

        startCategoryTrack(key, index, track);
      });

      button.classList.toggle('played', track.played);
      button.title = track.played ? 'Already used in this playlist' : '';

      button.addEventListener('dragstart', (event) => {
        state.dragInfo = { categoryKey: key, fromIndex: index };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
      });

      button.addEventListener('dragover', (event) => {
        if (state.categoryDragKey) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropIndicator(button, event);
      });

      button.addEventListener('drop', (event) => {
        if (state.categoryDragKey) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (!state.dragInfo) {
          clearDropIndicators();
          return;
        }

        const isAfter = event.clientY > button.getBoundingClientRect().top + (button.getBoundingClientRect().height / 2);
        const targetIndex = isAfter ? index + 1 : index;
        reorderSongs(state.dragInfo.categoryKey, state.dragInfo.fromIndex, key, targetIndex);
        state.dragInfo = null;
        clearDropIndicators();
      });

      button.addEventListener('dragend', () => {
        state.dragInfo = null;
        clearDropIndicators();
      });

      list.appendChild(button);
    });

    const currentTrackIndex = state.currentCategoryKey === key ? tracks.indexOf(state.currentTrack) : -1;
    const targetTrackIndex = currentTrackIndex >= 0 && (!isOfflineModeActive() || isTrackAvailableOffline(tracks[currentTrackIndex]))
      ? currentTrackIndex
      : tracks.findIndex((track) => !track.played && isTrackPlayableHere(track) && (!isOfflineModeActive() || isTrackAvailableOffline(track)));
    if (targetTrackIndex >= 0) {
      scrollTrackListToButton(list, list.querySelector(`[data-index="${targetTrackIndex}"]`));
    }

    const footerRow = document.createElement('div');
    footerRow.className = 'playlist-footer';
    footerRow.appendChild(resetButton);
    footerRow.appendChild(deleteButton);

    const resizeHandle = document.createElement('button');
    resizeHandle.type = 'button';
    resizeHandle.className = 'playlist-resize-handle';
    resizeHandle.setAttribute('aria-label', `Resize ${formatCategoryTitle(key)} category`);
    resizeHandle.title = 'Drag to resize category (up to 2 wide, 10 tall); use arrow keys when focused';
    resizeHandle.addEventListener('pointerdown', (event) => beginCategoryCardResize(event, key, column));
    resizeHandle.addEventListener('keydown', (event) => {
      const current = categoryGrid.placement.get(key);
      if (!current) {
        return;
      }
      let { w, h } = current;
      if (event.key === 'ArrowRight') w += 1;
      else if (event.key === 'ArrowLeft') w -= 1;
      else if (event.key === 'ArrowDown') h += 1;
      else if (event.key === 'ArrowUp') h -= 1;
      else return;
      event.preventDefault();
      resizeCategoryCard(key, w, h);
    });

    column.appendChild(headerRow);
    column.appendChild(fadeControl);
    column.appendChild(list);
    column.appendChild(footerRow);
    column.appendChild(resizeHandle);
    boardElement.appendChild(column);
  });

  updateCategoryGridLayout();
  noVisibleCategoriesMessage.classList.toggle('hidden', visibleCategories.length > 0);
  renderBuiltInSoundPicker();
  renderSongOptions();
  syncTrackSpectrogram();
}

function renderCategoryVisibilityPicker() {
  renderCategorySharing();
  categoryVisibilityPicker.innerHTML = '';
  Object.keys(state.playlists).filter((key) => key !== 'built-in-sounds' && isCategoryIntegrationVisible(key)).forEach((key) => {
    const label = document.createElement('label');
    label.className = 'category-visibility-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !state.hiddenCategories.has(key);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        state.hiddenCategories.delete(key);
      } else {
        state.hiddenCategories.add(key);
      }
      saveHiddenCategories();
      renderBoard();
    });
    const name = document.createElement('span');
    name.textContent = formatCategoryTitle(key);
    label.append(checkbox, name);
    categoryVisibilityPicker.appendChild(label);
  });
}

function renderBuiltInSoundPicker() {
  builtInSoundPicker.innerHTML = '';
  const tracks = state.playlists['built-in-sounds'] || [];
  ['Hockey & Crowd', 'Horns', 'Hype & Reveals', 'Reactions'].forEach((groupName) => {
    const groupTracks = tracks
      .map((track, index) => ({ track, index }))
      .filter(({ track }) => track.builtInGroup === groupName);
    if (!groupTracks.length) {
      return;
    }

    const group = document.createElement('section');
    group.className = 'builtin-sound-group';
    const heading = document.createElement('h4');
    heading.textContent = groupName;
    const buttonGrid = document.createElement('div');
    buttonGrid.className = 'builtin-sound-group-grid';

    groupTracks.forEach(({ track, index }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'builtin-sound-button';
      button.dataset.index = String(index);
      button.textContent = track.name;
      button.setAttribute('aria-label', `Play built-in sound: ${track.name}`);
      button.classList.toggle('playing', !state.isPaused && track === state.currentTrack);
      button.addEventListener('click', () => {
        if (state.isPaused) {
          setStatus('Playback is paused. Resume before selecting a sound.');
          return;
        }
        startCategoryTrack('built-in-sounds', index, track);
      });
      buttonGrid.appendChild(button);
    });

    group.append(heading, buttonGrid);
    builtInSoundPicker.appendChild(group);
  });
}

function addCategory() {
  const rawName = newCategoryInput.value.trim();
  if (!rawName) {
    setStatus('Type a category name first.');
    return;
  }

  const key = slugifyCategoryName(rawName);
  if (state.playlists[key]) {
    setStatus('That category already exists.');
    return;
  }

  state.playlists[key] = [];
  savePlaylists();
  renderBoard();
  newCategoryInput.value = '';
  setStatus(`Added category: ${formatCategoryTitle(key)}`);
}

function renameCategory(categoryKey, rawName) {
  const trimmedName = rawName.trim();
  if (!trimmedName) {
    setStatus('Enter a category name.');
    categoryRenameInput.focus();
    return false;
  }

  const newKey = slugifyCategoryName(trimmedName);
  if (newKey === categoryKey) {
    return true;
  }
  if (state.playlists[newKey]) {
    setStatus('A category with that name already exists.');
    categoryRenameInput.focus();
    categoryRenameInput.select();
    return false;
  }

  const renamedCurrentCategory = state.currentCategoryKey === categoryKey;
  const renamedPlaylists = {};
  Object.entries(state.playlists).forEach(([key, tracks]) => {
    renamedPlaylists[key === categoryKey ? newKey : key] = tracks;
  });
  state.playlists = renamedPlaylists;

  if (Object.prototype.hasOwnProperty.call(state.categorySizes, categoryKey)) {
    state.categorySizes[newKey] = state.categorySizes[categoryKey];
    delete state.categorySizes[categoryKey];
    saveCategorySizes();
  }

  if (Object.prototype.hasOwnProperty.call(state.categorySettings, categoryKey)) {
    state.categorySettings[newKey] = state.categorySettings[categoryKey];
    delete state.categorySettings[categoryKey];
  }
  if (state.hiddenCategories.delete(categoryKey)) {
    state.hiddenCategories.add(newKey);
    saveHiddenCategories();
  }
  if (state.autoplayVisited.has(categoryKey)) {
    state.autoplayVisited.set(newKey, state.autoplayVisited.get(categoryKey));
    state.autoplayVisited.delete(categoryKey);
  }
  if (state.currentCategoryKey === categoryKey) {
    state.currentCategoryKey = newKey;
  }
  if (state.songEditor.categoryKey === categoryKey) {
    state.songEditor.categoryKey = newKey;
  }
  if (state.dragInfo?.categoryKey === categoryKey) {
    state.dragInfo.categoryKey = newKey;
  }

  [musicCategorySelect, mp3CategorySelect].forEach((select) => {
    if (select.value === categoryKey) {
      select.value = newKey;
    }
  });

  savePlaylists();
  saveCategorySettings();
  renderBoard();
  if (renamedCurrentCategory) {
    syncCurrentAutoplaySchedule();
  }
  setStatus(`Renamed category to ${formatCategoryTitle(newKey)}.`);
  return true;
}

function stopMusicPlayback() {
  markCurrentTrackPlayed();
  clearTrackPlaybackTimers();
  stopActiveCustomPlayback();
  state.currentTrack = null;
  state.currentCategoryKey = null;
  state.currentTrackIndex = -1;
  state.currentTrackElapsedMs = 0;
  state.currentTrackStartedAt = 0;
  state.currentTrackDurationSeconds = 0;
  state.autoTransitioning = false;
  state.pendingFadeInSeconds = 0;
  rampPlaybackGain(1, 0);
  renderBoard();
  setStatus('Music stopped. Select a song to start playback.');
}

function togglePause() {
  state.isPaused = !state.isPaused;
  syncPauseButton();

  if (state.isPaused) {
    state.currentTrackElapsedMs = getCurrentTrackPlayedMilliseconds();
    state.currentTrackStartedAt = 0;
    clearTrackPlaybackTimers();
    state.autoTransitioning = false;
    customAudio.pause();
    activeHornAudio?.pause();
    if (state.customType === 'youtube') {
      sendYouTubeCommand('pauseVideo');
    } else if (state.customType === 'spotify' && spotifyEmbedController) {
      spotifyEmbedController.pause();
    }
    hideSpotifyTapPrompt();
    audioContext.suspend().catch(() => {});
    rampPlaybackGain(1, 0);
    sendYouTubeVolume(100);
    syncTrackSpectrogram();
    setStatus('Playback paused. Ready when the next moment hits.');
  } else {
    state.currentTrackStartedAt = state.currentTrack ? performance.now() : 0;
    if (activeHornAudio?.paused) {
      activeHornAudio.play().catch(() => {});
    }
    if (state.customType === 'spotify' && spotifyEmbedController) {
      spotifyEmbedController.resume();
      scheduleSpotifyTapPrompt();
    }
    audioContext.resume().then(() => {
      if (state.customType === 'file' && customAudio.src) {
        customAudio.play().catch(() => {});
      } else if (state.customType === 'youtube') {
        sendYouTubeCommand('playVideo');
      }
    }).catch(() => {});
    schedulePlayedThreshold();
    scheduleCurrentTrackCompletion();
    syncCurrentAutoplaySchedule();
    syncTrackSpectrogram();
    setStatus('Back in the game.');
  }
}

function resumeForCategoryPlayback() {
  if (!state.isPaused) {
    return;
  }

  state.isPaused = false;
  syncPauseButton();
  state.currentTrackStartedAt = state.currentTrack ? performance.now() : 0;
  if (activeHornAudio?.paused) {
    activeHornAudio.play().catch(() => {});
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
}

function syncPauseButton() {
  pauseToggleButton.textContent = state.isPaused ? 'Resume' : 'Pause';
  pauseToggleButton.setAttribute('aria-label', state.isPaused ? 'Resume playback' : 'Pause playback');
  pauseToggleButton.setAttribute('aria-pressed', String(state.isPaused));
  pauseToggleButton.classList.toggle('paused', state.isPaused);
  pauseToggleButton.classList.toggle('pause-active', !state.isPaused);
  pauseToggleButton.title = state.isPaused
    ? 'Playback is paused. Click to resume.'
    : 'Click to pause playback.';
}

function parseYouTubePlaylistId(rawUrl) {
  const value = (rawUrl || '').trim();
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^www\./, '').replace(/^m\./, '').toLowerCase();
    const supportedHosts = ['youtube.com', 'music.youtube.com', 'youtu.be', 'youtube-nocookie.com'];
    if (!supportedHosts.includes(hostname)) {
      return null;
    }

    const playlistId = url.searchParams.get('list');
    if (playlistId && /^[A-Za-z0-9_-]+$/.test(playlistId)) {
      return playlistId;
    }

    if (url.pathname === '/playlist' || url.pathname === '/playlist/') {
      const fallbackList = url.searchParams.get('list');
      return fallbackList && /^[A-Za-z0-9_-]+$/.test(fallbackList) ? fallbackList : null;
    }

    return null;
  } catch (error) {
    return null;
  }
}

function parseYouTubeDurationSeconds(duration) {
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) {
    return 0;
  }
  return (Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0);
}

async function fetchYouTubePlaylistTracks(playlistId, requireDurations = false) {
  window.SoundboardIntegrations.require('youtube');
  if (!window.SoundboardIntegrations.config().youtubeConfigured) {
    throw new Error('Ask the administrator to configure the shared API key before importing a playlist.');
  }

  const tracks = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      part: 'snippet,contentDetails',
      maxResults: '50',
      playlistId,
      resource: 'playlistItems'
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const response = await fetch(`/api/youtube?${params.toString()}`, { credentials: 'same-origin' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Could not read this playlist. Check shared API setup and playlist visibility.');
    }

    const data = await response.json();
    tracks.push(...(data.items || [])
      .map((item) => ({
        videoId: item.contentDetails?.videoId || item.snippet?.resourceId?.videoId,
        name: item.snippet?.title || 'YouTube video',
        description: item.snippet?.videoOwnerChannelTitle || 'YouTube video',
        artist: item.snippet?.videoOwnerChannelTitle || ''
      }))
      .filter((track) => track.videoId));
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  if (!tracks.length) {
    return [];
  }

  const durations = new Map();
  for (let offset = 0; offset < tracks.length; offset += 50) {
    const params = new URLSearchParams({
      part: 'contentDetails',
      id: tracks.slice(offset, offset + 50).map((track) => track.videoId).join(','),
      resource: 'videos'
    });
    const response = await fetch(`/api/youtube?${params.toString()}`, { credentials: 'same-origin' });
    if (!response.ok && requireDurations) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Could not read song lengths. Check shared API quota and permissions, then retry.');
    }
    if (response.ok) {
      const data = await response.json();
      (data.items || []).forEach((video) => {
        durations.set(video.id, parseYouTubeDurationSeconds(video.contentDetails?.duration || ''));
      });
    }
  }

  return tracks.map((track) => {
    const youtubeUrl = `https://www.youtube.com/watch?v=${track.videoId}&list=${playlistId}`;
    return {
      ...track,
      youtubeUrl,
      youtubeEmbedUrl: parseYouTubeEmbedUrl(youtubeUrl),
      durationSeconds: durations.get(track.videoId) || 0
    };
  });
}

function parseYouTubeEmbedUrl(rawUrl) {
  const value = rawUrl.trim();
  const match = value.match(/(?:music\.youtube\.com\/watch\?v=|(?:www\.)?youtube\.com\/watch\?v=|(?:www\.)?youtube\.com\/embed\/|(?:www\.)?youtube\.com\/shorts\/|youtu\.be\/|youtube-nocookie\.com\/embed\/)([A-Za-z0-9_-]{11})/i);
  if (!match) {
    return null;
  }

  const id = match[1];
  return `https://www.youtube.com/embed/${id}?autoplay=1&controls=1&rel=0&playsinline=1`;
}

function handleLocalMp3Selection(event) {
  const file = event.target.files?.[0];
  state.pendingMp3File = null;
  addLocalMp3Button.disabled = true;
  if (!file) {
    return;
  }

  if (!file.name.toLowerCase().endsWith('.mp3') && !file.type.includes('mpeg')) {
    setStatus('Please choose an MP3 file.');
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  state.pendingMp3File = file;
  addLocalMp3Button.disabled = false;
  state.customSource = objectUrl;
  state.customType = 'file';
  state.customDuration = 0;
  if (youtubePlayer) {
    youtubePlayer.src = '';
    youtubeWrap.classList.add('hidden');
  }
  customAudio.onloadedmetadata = () => {
    state.customDuration = Number.isFinite(customAudio.duration) ? customAudio.duration : 0;
  };
  customAudio.src = objectUrl;
  customAudio.muted = state.isMuted;
  setStatus(`Loaded local MP3: ${file.name}`);
}

async function addLocalMp3ToCategory() {
  const categoryKey = getImportCategoryKey(mp3CategorySelect);
  const file = state.pendingMp3File;
  const overrides = getMusicOverrides();
  if (!overrides) {
    return;
  }
  if (!file) {
    setStatus('Choose an MP3 file first.');
    localAudioInput.click();
    return;
  }

  const storageId = createLocalAudioStorageId();
  const name = overrides.name || file.name.replace(/\.mp3$/i, '').trim() || 'Local MP3';
  const durationSeconds = getDefaultStopTime();
  const createdCategory = !state.playlists[categoryKey];
  const track = {
    name,
    description: overrides.description || 'Local MP3',
    mood: 'custom',
    startTime: overrides.startTime,
    stopTime: overrides.stopTime ?? durationSeconds,
    durationSeconds,
    played: false,
    audioStorageId: storageId
  };

  addLocalMp3Button.disabled = true;
  setStatus(`Saving ${file.name}...`);
  try {
    await saveLocalAudioFile(storageId, file);
    ensureImportCategory(categoryKey);
    state.playlists[categoryKey].push(track);
    try {
      savePlaylists();
    } catch (error) {
      state.playlists[categoryKey].pop();
      if (createdCategory) {
        delete state.playlists[categoryKey];
      }
      throw new Error('Unable to save the MP3 entry in browser storage.');
    }

    const objectUrl = state.customType === 'file' && state.customSource?.startsWith('blob:')
      ? state.customSource
      : URL.createObjectURL(file);
    state.localAudioObjectUrls.set(storageId, objectUrl);
    customAudio.src = objectUrl;
    state.customSource = objectUrl;
    state.customType = 'file';
    renderBoard();
    mp3CategorySelect.value = '';
    localAudioInput.value = '';
    state.pendingMp3File = null;
    clearMusicOverrides();
    setStatus(`Added "${name}" to ${formatCategoryTitle(categoryKey)}.`);
  } catch (error) {
    await deleteLocalAudioFile(storageId).catch(() => {});
    setStatus(error.message || 'Unable to store this MP3 in browser storage.');
  } finally {
    addLocalMp3Button.disabled = !state.pendingMp3File;
  }
}

async function addYouTubeToCategory() {
  if (!window.SoundboardIntegrations.enabled('youtube')) {
    setStatus('This music integration is disabled by the administrator.');
    return;
  }
  const categoryKey = getImportCategoryKey(musicCategorySelect);
  const overrides = getMusicOverrides();
  if (!overrides) {
    return;
  }
  const url = musicUrlInput.value.trim();
  const embedUrl = parseYouTubeEmbedUrl(url);

  const playlistId = parseYouTubePlaylistId(url);
  if (playlistId) {
    setStatus('Loading every song from the YouTube playlist...');
    const startLength = (state.playlists[categoryKey] || []).length;
    try {
      const playlistTracks = await fetchYouTubePlaylistTracks(playlistId);
      window.SoundboardIntegrations.require('youtube');
      if (!playlistTracks.length) {
        setStatus('This YouTube playlist does not contain any playable videos.');
        return;
      }

      ensureImportCategory(categoryKey);
      playlistTracks.forEach((track) => {
        state.playlists[categoryKey].push({
          name: overrides.name || track.name,
          description: overrides.description || track.description,
          mood: 'custom',
          startTime: overrides.startTime,
          stopTime: overrides.stopTime ?? track.durationSeconds,
          durationSeconds: track.durationSeconds,
          played: false,
          youtubeUrl: track.youtubeUrl,
          youtubeEmbedUrl: track.youtubeEmbedUrl
        });
      });

      savePlaylists();
      renderBoard();
      musicCategorySelect.value = '';
      musicUrlInput.value = '';
      clearMusicOverrides();
      setStatus(`Added ${playlistTracks.length} songs from the YouTube playlist to ${formatCategoryTitle(categoryKey)}.`);
    } catch (error) {
      state.playlists[categoryKey]?.splice(startLength);
      setStatus(window.SoundboardIntegrations.enabled('youtube')
        ? error.message || 'Unable to import this YouTube playlist.'
        : 'This music integration was disabled during import. No songs were saved.');
    }
    return;
  }

  if (!embedUrl) {
    setStatus('Paste a valid YouTube URL first.');
    musicUrlInput.focus();
    return;
  }

  const videoId = embedUrl.match(/\/embed\/([^?]+)/)?.[1] || '';
  let name = `YouTube video ${videoId}`;
  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (response.ok) {
      const video = await response.json();
      name = video.title || name;
    }
  } catch (error) {
    name = `YouTube video ${videoId}`;
  }

  name = overrides.name || name;
  if (!window.SoundboardIntegrations.enabled('youtube')) {
    setStatus('This music integration was disabled during the import. No songs were saved.');
    return;
  }
  ensureImportCategory(categoryKey);
  state.playlists[categoryKey].push({
    name,
    description: overrides.description || 'YouTube video',
    mood: 'custom',
    startTime: overrides.startTime,
    stopTime: overrides.stopTime ?? 0,
    durationSeconds: 0,
    played: false,
    youtubeUrl: url,
    youtubeEmbedUrl: embedUrl
  });

  try {
    savePlaylists();
  } catch (error) {
    state.playlists[categoryKey].pop();
    setStatus('Unable to save this YouTube video to the category.');
    return;
  }

  renderBoard();
  musicCategorySelect.value = '';
  musicUrlInput.value = '';
  clearMusicOverrides();
  setStatus(`Added "${name}" to ${formatCategoryTitle(categoryKey)}.`);
}

pauseToggleButton.addEventListener('click', togglePause);
document.getElementById('stopPlayback').addEventListener('click', stopMusicPlayback);
enterFullscreenButton.addEventListener('click', enterFullscreen);
exitFullscreenButton.addEventListener('click', exitFullscreen);
document.addEventListener('fullscreenchange', syncFullscreenButtons);
scoreButton.addEventListener('click', openScoreDialog);
scoreTeamsButton.addEventListener('click', openScoreTeamsDialog);
saveScoreTeamsButton.addEventListener('click', saveScoreTeams);
cancelScoreTeamsButton.addEventListener('click', closeScoreTeamsDialog);
announceScoreButton.addEventListener('click', announceScore);
cancelScoreButton.addEventListener('click', closeScoreDialog);
scoreVoiceSelect.addEventListener('change', () => {
  const voice = scoreSpeechVoices[Number(scoreVoiceSelect.value)];
  state.settings.scoreVoiceName = voice ? `${voice.name}|${voice.lang}` : '';
  saveSettings();
});
if ('speechSynthesis' in window) {
  window.speechSynthesis.addEventListener('voiceschanged', populateScoreVoiceOptions);
}
soundboardTitle.addEventListener('pointerdown', () => createSoundboardTitleLongPressTimer(soundboardTitle));
soundboardTitle.addEventListener('pointerup', () => clearLongPressTimer(soundboardTitle));
soundboardTitle.addEventListener('pointerleave', () => clearLongPressTimer(soundboardTitle));
soundboardTitle.addEventListener('pointercancel', () => clearLongPressTimer(soundboardTitle));
soundboardTitle.addEventListener('contextmenu', (event) => event.preventDefault());
soundboardTitle.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openSoundboardTitleEditor();
  }
});
saveSoundboardTitleButton.addEventListener('click', saveSoundboardTitle);
cancelSoundboardTitleButton.addEventListener('click', closeSoundboardTitleEditor);
youtubePlayer.addEventListener('load', () => {
  if (state.customType === 'youtube') {
    sendYouTubeVolume(state.youtubeVolume);
  }
});
goalHornButton.addEventListener('click', playGoalHorn);
settingsToggleButton.addEventListener('click', toggleSettingsPanel);
document.body.appendChild(settingsPanel);
document.getElementById('closeSettings').addEventListener('click', closeSettingsPanel);
settingsPanel.addEventListener('click', (event) => {
  if (event.target === settingsPanel) {
    closeSettingsPanel();
  }
});
settingsPanel.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSettingsPanel();
  } else if (event.key === 'Tab') {
    const focusable = Array.from(settingsPanel.querySelectorAll('button, input, select, a[href]'))
      .filter((element) => !element.disabled && element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
musicLibraryToggleButton.addEventListener('click', toggleMusicLibrary);
builtInSoundToggleButton.addEventListener('click', toggleBuiltInSounds);
useLocalMp3Input.addEventListener('change', syncMusicSourceVisibility);
offlineModeToggleInput.addEventListener('change', toggleOfflineMode);
window.addEventListener('online', syncOfflineModeViews);
window.addEventListener('offline', syncOfflineModeViews);
applySettingsButton.addEventListener('click', applyBrandSettings);
logoFileInput.addEventListener('change', handleLogoFileSelection);
hornFileInput.addEventListener('change', handleHornFileSelection);
builtInHornSelect.addEventListener('change', () => {
  if (builtInHornSelect.value === 'custom' && !state.settings.customHornDataUrl) {
    builtInHornSelect.value = 'sounds/Default_Horn.wav';
    setStatus('Upload a custom horn audio file before selecting it.');
    hornFileInput.click();
    return;
  }
  state.settings.builtInHornAudioUrl = builtInHornSelect.value;
  saveSettings();
  setStatus(builtInHornSelect.value
    ? `Horn button set to ${builtInHornSelect.selectedOptions[0].textContent}.`
    : 'Horn button cleared.');
});
localAudioInput.addEventListener('change', handleLocalMp3Selection);
playlistSpreadsheetInput.addEventListener('change', handleSpreadsheetUpload);
addLocalMp3Button.addEventListener('click', addLocalMp3ToCategory);
addMusicButton.addEventListener('click', addOnlineMusic);
addCategoryButton.addEventListener('click', addCategory);
downloadSpreadsheetExampleButton.addEventListener('click', downloadSpreadsheetExample);
saveSongEditsButton.addEventListener('click', saveSongEdits);
setupPlaylistConversion();
copySongButton.addEventListener('click', copySongToCategory);
deleteSongButton.addEventListener('click', deleteSongFromPlaylist);
cancelSongEditButton.addEventListener('click', closeSongEditor);
saveCategoryRenameButton.addEventListener('click', saveCategoryRename);
cancelCategoryRenameButton.addEventListener('click', closeCategoryRenameEditor);
spotifyConnectButton.addEventListener('click', connectSpotify);
spotifyDisconnectButton.addEventListener('click', disconnectSpotify);

songEditor.addEventListener('click', (event) => {
  if (event.target === songEditor) {
    closeSongEditor();
  }
});

scoreDialog.addEventListener('click', (event) => {
  if (event.target === scoreDialog) {
    closeScoreDialog();
  }
});

scoreDialog.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeScoreDialog();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    announceScore();
  }
});

scoreTeamsDialog.addEventListener('click', (event) => {
  if (event.target === scoreTeamsDialog) {
    closeScoreTeamsDialog();
  }
});

scoreTeamsDialog.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeScoreTeamsDialog();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    saveScoreTeams();
  }
});

soundboardTitleInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveSoundboardTitle();
  } else if (event.key === 'Escape') {
    closeSoundboardTitleEditor();
  }
});

soundboardTitleEditor.addEventListener('click', (event) => {
  if (event.target === soundboardTitleEditor) {
    closeSoundboardTitleEditor();
  }
});

categoryRenameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveCategoryRename();
  } else if (event.key === 'Escape') {
    closeCategoryRenameEditor();
  }
});

categoryRenameEditor.addEventListener('click', (event) => {
  if (event.target === categoryRenameEditor) {
    closeCategoryRenameEditor();
  }
});

headerLogoVisibleInput.checked = state.settings.headerLogoVisible;
builtInHornSelect.value = state.settings.builtInHornAudioUrl || 'sounds/Default_Horn.wav';
scoreHomeTeamNameInput.value = state.settings.scoreHomeTeamName;
scoreAwayTeamNameInput.value = state.settings.scoreAwayTeamName;
customHornOption.disabled = !state.settings.customHornDataUrl;
watermarkVisibleInput.checked = state.settings.watermarkVisible;
headerLogoUrlInput.value = state.settings.headerLogoUrl;
watermarkOpacityInput.value = String(state.settings.watermarkOpacity);
applySoundboardTitle();
spotifyRedirectUriInput.addEventListener('change', () => {
  const value = spotifyRedirectUriInput.value.trim();
  state.settings.spotifyRedirectUri = value;
  saveSettings();
  syncSpotifyInputs();
  setStatus(value ? 'Spotify redirect URI saved.' : 'Spotify redirect URI reset to default.');
});

syncSpotifyInputs();
syncPauseButton();
populateScoreVoiceOptions();

document.body.dataset.headerLogoVisible = String(state.settings.headerLogoVisible);
document.body.dataset.watermarkVisible = String(state.settings.watermarkVisible);
document.body.style.setProperty('--watermark-opacity', (state.settings.watermarkOpacity / 100).toString());
document.body.style.setProperty('--watermark-image', `url("${state.settings.headerLogoUrl}")`);

const headerLogo = document.querySelector('.team-logo');
if (headerLogo) {
  headerLogo.src = state.settings.headerLogoUrl;
}

document.addEventListener('integrations-changed', () => {
  if (state.currentTrack && !isTrackIntegrationEnabled(state.currentTrack)) {
    clearTrackPlaybackTimers();
    stopActiveCustomPlayback();
    state.currentTrack = null;
    state.currentCategoryKey = null;
    state.currentTrackIndex = -1;
    state.currentTrackElapsedMs = 0;
    state.currentTrackStartedAt = 0;
    state.currentTrackDurationSeconds = 0;
    state.autoTransitioning = false;
  }
  if (!window.SoundboardIntegrations.enabled('spotify') && spotifyAuthPopup) {
    spotifyAuthPopup.close();
    spotifyAuthPopup = null;
  }
  closeSongEditor();
  document.getElementById('playlistConversionDialog').classList.add('hidden');
  document.getElementById('playlistConversionStatus').textContent = '';
  syncMusicSourceVisibility();
  syncSpotifyInputs();
  window.SoundboardIntegrations.syncUI();
  renderBoard();
  refreshSharedCategories().catch((error) => {
    console.error('Could not refresh shared categories after integration settings changed.', error);
    setStatus('Integration settings changed, but shared categories could not refresh. Try again.');
  });
  setStatus('Integration settings updated. Saved songs and credentials were kept.');
});

renderBoard();
syncOfflineModeViews();
syncFullscreenButtons();
registerServiceWorker();
handleSpotifyCallback();

window.addEventListener('pointerdown', () => {
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
}, { once: true });
