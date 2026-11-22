(() => {
  const dialog = document.getElementById('localSongManagement');
  const openButton = document.getElementById('localSongManagementOpen');
  const closeButton = document.getElementById('localSongManagementClose');
  const status = document.getElementById('localSongManagementStatus');
  const search = document.getElementById('localSongSearch');
  const filter = document.getElementById('localSongFilter');
  const libraryRows = document.getElementById('localSongLibraryRows');
  const categoryList = document.getElementById('localSongCategoryList');
  const uploadArea = document.getElementById('localSongUpload');
  const filesInput = document.getElementById('localSongFiles');
  const categoryName = document.getElementById('localSongCategoryName');
  const createButton = document.getElementById('localSongCategoryCreate');
  let songs = [];
  let categories = [];
  let admin = false;
  let busy = false;

  function setBusy(value) {
    busy = value;
    document.querySelector('.local-song-columns').inert = value;
  }

  function say(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  async function request(method, url, body) {
    const response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
    return result;
  }

  function timecode(seconds) {
    const total = Math.max(0, Math.ceil(Number(seconds) || 0));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  function parseTime(value) {
    const match = /^(\d+):([0-5]\d)$/.exec(value.trim());
    if (!match) throw new Error('Use MM:SS for start and stop times.');
    const result = Number(match[1]) * 60 + Number(match[2]);
    if (!Number.isSafeInteger(result)) throw new Error('The time is too large.');
    return result;
  }

  function makeDraft(track) {
    const song = songs.find((entry) => entry.audioUrl === track.audioUrl);
    const end = Number(track.stopTime) || 0;
    const displayEnd = end ? timecode(end) : song && song.durationSeconds ? timecode(song.durationSeconds) : '';
    return {
      track: { ...track },
      name: track.name,
      description: track.description || '',
      start: timecode(track.startTime),
      stop: displayEnd,
      automaticEnd: end === 0,
      originalStop: displayEnd
    };
  }

  function prepareCategory(category) {
    return { ...category, draft: category.tracks.map(makeDraft), dirty: false, expanded: false };
  }

  function isDirty() {
    return categories.some((category) => category.dirty)
      || songs.some((song) => song.draftName !== song.name || song.draftDescription !== song.description);
  }

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function button(text, label) {
    const node = el('button', text, 'source-button');
    node.type = 'button';
    if (label) node.setAttribute('aria-label', label);
    return node;
  }

  function cell(row, value) {
    const node = el('td');
    if (value instanceof Node) node.append(value);
    else node.textContent = value;
    row.append(node);
    return node;
  }

  function input(value, label, maxLength, readonly = !admin) {
    const node = document.createElement('input');
    node.type = 'text';
    node.value = value;
    node.setAttribute('aria-label', label);
    if (maxLength) node.maxLength = maxLength;
    node.readOnly = readonly;
    return node;
  }

  function assignedCategories(song) {
    return categories.filter((category) => category.tracks.some((track) => track.audioUrl === song.audioUrl));
  }

  function renderLibrary() {
    const query = search.value.trim().toLocaleLowerCase();
    const visible = songs.filter((song) => {
      const assigned = assignedCategories(song);
      return (filter.value !== 'unsorted' || assigned.length === 0)
        && `${song.draftName} ${song.draftDescription} ${assigned.map((category) => category.name).join(' ')}`
          .toLocaleLowerCase().includes(query);
    });
    document.getElementById('localSongCount').textContent =
      `${visible.length} of ${songs.length} songs shown. To Sort contains songs not saved in a category template.`;
    libraryRows.replaceChildren();
    visible.forEach((song) => {
      const row = el('tr');
      if (admin) {
        row.draggable = true;
        row.title = 'Drag this song to a category, or use that category’s Add song menu.';
        row.addEventListener('dragstart', (event) => {
          event.dataTransfer.setData('application/x-soundboard-song', song.id);
          event.dataTransfer.effectAllowed = 'copy';
        });
      }
      const name = input(song.draftName, `Library name for ${song.name}`, 160);
      const description = input(song.draftDescription, `Library description for ${song.name}`, 300);
      const save = button('Save', `Save library details for ${song.name}`);
      save.disabled = busy || (song.draftName === song.name && song.draftDescription === song.description);
      const changed = () => {
        song.draftName = name.value;
        song.draftDescription = description.value;
        save.disabled = busy || (song.draftName === song.name && song.draftDescription === song.description);
      };
      name.addEventListener('input', changed);
      description.addEventListener('input', changed);
      cell(row, name);
      cell(row, description);
      cell(row, assignedCategories(song).map((category) => category.name).join(', ') || 'To Sort');
      cell(row, '00:00');
      cell(row, song.durationSeconds ? timecode(song.durationSeconds) : 'Unknown');
      const actions = cell(row, '');
      if (!song.available) actions.append(el('span', 'File unavailable', 'local-song-warning'));
      if (admin) {
        actions.append(save);
        save.addEventListener('click', async () => {
          if (busy) return;
          const nameChanged = song.draftName.trim() !== song.name;
          if (nameChanged && categories.some((category) => category.dirty)) {
            return say('Save or discard category changes before renaming a library song.', true);
          }
          setBusy(true);
          save.disabled = true;
          try {
            const result = await request('PUT', '/api/admin/local-song', {
              id: song.id, name: song.draftName, description: song.draftDescription,
              previousName: song.name, previousDescription: song.description
            });
            song.name = song.draftName = result.name;
            song.description = song.draftDescription = result.description;
            song.nameVersion = result.nameVersion;
            if (nameChanged) {
              const updates = new Map(result.updatedCategories.map((entry) => [entry.id, entry]));
              categories.forEach((category) => {
                category.tracks.forEach((track) => {
                  if (track.audioUrl === song.audioUrl) {
                    track.name = result.name;
                    track.sharedAudioNameVersion = result.nameVersion;
                  }
                });
                category.draft.forEach((draft) => {
                  if (draft.track.audioUrl === song.audioUrl) {
                    draft.track.name = result.name;
                    draft.track.sharedAudioNameVersion = result.nameVersion;
                    draft.name = result.name;
                  }
                });
                const update = updates.get(category.id);
                if (update && category.updated === update.previousUpdated) category.updated = update.updated;
              });
              document.dispatchEvent(new CustomEvent('shared-audio-renamed', {
                detail: { id: song.id, name: result.name, version: result.nameVersion }
              }));
            }
            say(nameChanged
              ? 'Song name updated in the library and playlists.'
              : 'Library details saved. Existing category descriptions were not changed.');
            document.dispatchEvent(new Event('managed-playlists-changed'));
          } catch (error) {
            say(error.message, true);
          } finally {
            setBusy(false);
            renderLibrary();
            renderCategories();
          }
        });
        const remove = button('Delete', `Delete ${song.name} from the shared library`);
        actions.append(remove);
        remove.addEventListener('click', async () => {
          if (busy) return;
          if (isDirty()) return say('Save or discard your edits before deleting a song.', true);
          if (!confirm(`Permanently delete "${song.name}" from the shared library? This cannot be undone.`)) return;
          setBusy(true);
          try {
            const result = await request('POST', '/api/admin/local-song/delete', { id: song.id });
            songs = songs.filter((entry) => entry.id !== song.id);
            say(result.warning || 'Song deleted from the shared library.', Boolean(result.warning));
            document.dispatchEvent(new Event('managed-playlists-changed'));
          } catch (error) {
            say(error.message, true);
          } finally {
            setBusy(false);
            renderLibrary();
            renderCategories();
          }
        });
      }
      libraryRows.append(row);
    });
  }

  function addSong(category, songId) {
    const song = songs.find((entry) => entry.id === songId);
    if (!song || !song.available) {
      say('That audio file is not available.', true);
      return;
    }
    if (category.draft.some((entry) => entry.track.audioUrl === song.audioUrl)) {
      say('That song is already in this category.', true);
      return;
    }
    category.draft.push(makeDraft({
      name: song.name, description: song.description, mood: 'custom',
      startTime: 0, stopTime: 0, durationSeconds: 0,
      audioUrl: song.audioUrl, repeatable: false, sharedAudioNameVersion: song.nameVersion || undefined
    }));
    category.dirty = true;
    category.expanded = true;
    renderCategories();
    say(`Added to ${category.name} as a draft. Save the category to publish it.`);
  }

  function categoryPayload(category) {
    return category.draft.map((draft) => {
      const start = parseTime(draft.start);
      const stop = draft.automaticEnd && draft.stop === draft.originalStop ? 0 : parseTime(draft.stop);
      if (!draft.name.trim()) throw new Error('Each song needs a name.');
      if (stop && stop <= start) throw new Error('Stop must be later than start.');
      return {
        ...draft.track, name: draft.name, description: draft.description,
        startTime: start, stopTime: stop
      };
    });
  }

  function renderCategories() {
    categoryList.replaceChildren();
    categories.forEach((category) => {
      const section = el('details', undefined, 'local-song-category');
      section.open = category.expanded;
      section.addEventListener('toggle', () => { category.expanded = section.open; });
      const heading = el('summary', `${category.name} (${category.draft.length})${category.dirty ? ' — unsaved' : ''}`);
      section.append(heading);
      if (admin) {
        section.addEventListener('dragover', (event) => {
          if (Array.from(event.dataTransfer.types).includes('application/x-soundboard-song')) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }
        });
        section.addEventListener('drop', (event) => {
          const songId = event.dataTransfer.getData('application/x-soundboard-song');
          if (songId) {
            event.preventDefault();
            addSong(category, songId);
          }
        });
        const controls = el('div', undefined, 'local-song-category-controls');
        const select = document.createElement('select');
        select.setAttribute('aria-label', `Song to add to ${category.name}`);
        select.add(new Option('Choose a song', ''));
        songs.forEach((song) => {
          const option = new Option(song.name, song.id);
          option.disabled = !song.available || category.draft.some((entry) => entry.track.audioUrl === song.audioUrl);
          select.add(option);
        });
        const add = button('Add song', `Add selected song to ${category.name}`);
        add.addEventListener('click', () => {
          if (!select.value) return say('Choose an available song first.', true);
          addSong(category, select.value);
        });
        const save = button('Save category', `Save ${category.name}`);
        save.disabled = !category.dirty || busy;
        const discard = button('Discard changes', `Discard changes to ${category.name}`);
        discard.disabled = !category.dirty || busy;
        discard.addEventListener('click', () => {
          category.draft = category.tracks.map(makeDraft);
          category.dirty = false;
          renderCategories();
          say('Category changes discarded.');
        });
        save.addEventListener('click', async () => {
          if (busy) return;
          let tracks;
          try {
            tracks = categoryPayload(category);
          } catch (error) {
            say(error.message, true);
            return;
          }
          setBusy(true);
          save.disabled = true;
          try {
            const result = await request('PUT', '/api/admin/local-categories', {
              id: category.id, updated: category.updated, tracks
            });
            category.tracks = result.tracks;
            category.updated = result.updated;
            category.draft = result.tracks.map(makeDraft);
            category.dirty = false;
            say(`${category.name} saved. Existing personal boards were not changed.`);
            document.dispatchEvent(new Event('managed-playlists-changed'));
          } catch (error) {
            say(error.message, true);
          } finally {
            setBusy(false);
            renderLibrary();
            renderCategories();
          }
        });
        controls.append(window.SongPicker.create(select, `Search songs to add to ${category.name}`), add, save, discard);
        section.append(controls);
      }
      const wrap = el('div', undefined, 'local-song-table-wrap');
      const table = el('table', undefined, 'local-song-table');
      const thead = document.createElement('thead');
      const header = document.createElement('tr');
      ['Name', 'Description', 'Category', 'Start', 'Stop', 'Actions'].forEach((label) => header.append(el('th', label)));
      thead.append(header);
      const tbody = document.createElement('tbody');
      category.draft.forEach((draft, index) => {
        const row = document.createElement('tr');
        const markDirty = () => {
          category.dirty = true;
          heading.textContent = `${category.name} (${category.draft.length}) — unsaved`;
          const save = section.querySelector('.local-song-category-controls button:nth-of-type(2)');
          const discard = section.querySelector('.local-song-category-controls button:nth-of-type(3)');
          if (save) save.disabled = false;
          if (discard) discard.disabled = false;
        };
        [
          ['name', 160, 'Name'], ['description', 300, 'Description'],
          ['start', 16, 'Start'], ['stop', 16, 'Stop']
        ].forEach(([key, maxLength, label], fieldIndex) => {
          if (fieldIndex === 2) cell(row, category.name);
          const field = input(draft[key], `${label} for ${draft.name} in ${category.name}`, maxLength);
          if (key === 'stop' && draft.automaticEnd) {
            field.placeholder = 'Unknown';
            field.title = 'End of file; changing this value sets an explicit stop time.';
          }
          field.addEventListener('input', () => { draft[key] = field.value; markDirty(); });
          cell(row, field);
        });
        const actions = cell(row, '');
        if (admin) {
          const remove = button('Remove', `Remove ${draft.name} from ${category.name}`);
          remove.addEventListener('click', () => {
            category.draft.splice(index, 1);
            category.dirty = true;
            renderCategories();
            say('Song removed from the draft. Save the category to publish the change.');
          });
          actions.append(remove);
        }
        tbody.append(row);
      });
      table.append(thead, tbody);
      wrap.append(table);
      section.append(wrap);
      categoryList.append(section);
    });
    if (!categories.length) categoryList.append(el('p', 'No category templates yet.'));
  }

  async function load(preserveExpanded = false) {
    const expanded = new Set(categories.filter((category) => category.expanded).map((category) => category.id));
    const data = await request('GET', '/api/local-song-management');
    songs = data.songs.map((song) => ({ ...song, draftName: song.name, draftDescription: song.description }));
    categories = data.categories.map(prepareCategory);
    if (preserveExpanded) categories.forEach((category) => { category.expanded = expanded.has(category.id); });
    else if (categories.length) categories[0].expanded = true;
    renderLibrary();
    renderCategories();
  }

  function upload(file, index, total) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/shared-audio?name=${encodeURIComponent(file.name)}`);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = (event) => {
        const progress = event.lengthComputable ? ` (${Math.round(event.loaded / event.total * 100)}%)` : '';
        say(`Uploading ${index} of ${total}: ${file.name}${progress}`);
      };
      xhr.onerror = () => reject(new Error(`Network error uploading ${file.name}.`));
      xhr.onload = () => {
        let result;
        try { result = JSON.parse(xhr.responseText); }
        catch { reject(new Error(`Invalid server response uploading ${file.name}.`)); return; }
        if (xhr.status < 200 || xhr.status >= 300) reject(new Error(`${file.name}: ${result.error || `HTTP ${xhr.status}`}`));
        else resolve(result);
      };
      xhr.send(file);
    });
  }

  async function uploadFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length || busy || !admin) return;
    if (isDirty()) {
      say('Save or discard your edits before uploading files.', true);
      return;
    }
    setBusy(true);
    filesInput.disabled = true;
    let completed = 0;
    try {
      for (const file of files) {
        await upload(file, completed + 1, files.length);
        completed += 1;
      }
      await load();
      say(`Uploaded ${completed} ${completed === 1 ? 'song' : 'songs'}. New songs are in To Sort.`);
    } catch (error) {
      try {
        await load();
        say(`${error.message} ${completed} of ${files.length} files uploaded.`, true);
      } catch (reloadError) {
        say(`${error.message} ${completed} files uploaded; could not refresh: ${reloadError.message}`, true);
      }
    } finally {
      filesInput.value = '';
      filesInput.disabled = false;
      setBusy(false);
      if (completed) document.dispatchEvent(new Event('managed-playlists-changed'));
    }
  }

  openButton.addEventListener('click', async () => {
    if (busy) return;
    document.getElementById('sideMenuList').classList.add('hidden');
    document.querySelector('.side-menu-toggle').setAttribute('aria-expanded', 'false');
    dialog.classList.remove('hidden');
    closeButton.focus();
    admin = Boolean(window.SOUNDBOARD_USER && window.SOUNDBOARD_USER.isAdmin);
    uploadArea.classList.toggle('hidden', !admin);
    document.getElementById('localSongCreateCategory').classList.toggle('hidden', !admin);
    say('Loading shared songs and category templates...');
    songs = [];
    categories = [];
    renderLibrary();
    renderCategories();
    setBusy(true);
    try {
      await load();
      say(admin ? 'Drag a song to a category or use its Add song menu.' : 'Only administrators can edit shared songs and categories.');
    } catch (error) {
      say(`${error.message} Local Song Management requires a connection.`, true);
    } finally {
      setBusy(false);
    }
  });
  closeButton.addEventListener('click', () => {
    if (busy) return say('Please wait for the current operation to finish.', true);
    if (isDirty() && !confirm('Discard unsaved Local Song Management changes?')) return;
    dialog.classList.add('hidden');
    document.querySelector('.side-menu-toggle').focus();
  });
  search.addEventListener('input', renderLibrary);
  filter.addEventListener('change', renderLibrary);
  filesInput.addEventListener('change', () => uploadFiles(filesInput.files));
  uploadArea.addEventListener('dragover', (event) => {
    if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
  });
  uploadArea.addEventListener('drop', (event) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    uploadFiles(event.dataTransfer.files);
  });
  createButton.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    createButton.disabled = true;
    try {
      const category = prepareCategory(await request('POST', '/api/admin/local-categories', { name: categoryName.value }));
      category.expanded = true;
      categories.push(category);
      categories.sort((a, b) => a.name.localeCompare(b.name));
      categoryName.value = '';
      renderCategories();
      say(`${category.name} created.`);
      document.dispatchEvent(new Event('managed-playlists-changed'));
    } catch (error) {
      say(error.message, true);
    } finally {
      setBusy(false);
      createButton.disabled = false;
      renderCategories();
    }
  });
  document.addEventListener('shared-audio-names-refreshed', async (event) => {
    if (dialog.classList.contains('hidden') || busy) return;
    const changed = event.detail.some((rename) => {
      const song = songs.find((entry) => entry.id === rename.id);
      return song && rename.version > (song.nameVersion || 0);
    });
    if (changed && isDirty()) {
      say('Shared song names changed elsewhere. Reopen Local Song Management to refresh; unsaved category edits may conflict.', true);
    } else if (changed) {
      setBusy(true);
      try {
        await load(true);
        say('Shared song names refreshed.');
      } catch (error) {
        say(`Could not refresh shared song names: ${error.message}`, true);
      } finally {
        setBusy(false);
      }
    }
  });
})();
