(function () {
  const ROSTER_KEY = 'hockey-soundboard-roster-v1';
  const POSITIONS = ['F', 'C', 'LW', 'RW', 'D', 'G', 'P'];

  function loadRoster() {
    try {
      const data = JSON.parse(localStorage.getItem(ROSTER_KEY) || '{}');
      return {
        link: typeof data.link === 'string' ? data.link : '',
        players: Array.isArray(data.players) ? data.players : []
      };
    } catch (error) {
      return { link: '', players: [] };
    }
  }

  function saveRoster(roster) {
    localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
  }

  function safeUrl(value) {
    const text = String(value || '').trim();
    if (!text) {
      return '';
    }
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
    try {
      const url = new URL(candidate);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch (error) {
      return '';
    }
  }

  const POSITION_ALIASES = {
    forward: 'F', fwd: 'F', f: 'F', center: 'C', centre: 'C', c: 'C',
    'left wing': 'LW', lw: 'LW', 'right wing': 'RW', rw: 'RW', wing: 'F', w: 'F',
    defense: 'D', defence: 'D', defenseman: 'D', defenceman: 'D', d: 'D',
    goalie: 'G', goaltender: 'G', goalkeeper: 'G', g: 'G',
    player: 'P', p: 'P'
  };

  function normalizePosition(value) {
    const text = String(value || '').trim();
    return POSITION_ALIASES[text.toLowerCase()] || text.toUpperCase().slice(0, 4);
  }

  function normalizeHeader(value) {
    return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  async function loadSpreadsheetLibrary() {
    if (!window.rosterSheetLibrary) {
      window.rosterSheetLibrary = import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs').catch(() => {
        window.rosterSheetLibrary = null;
        throw new Error('Spreadsheet support could not load. Check your internet connection.');
      });
    }
    return window.rosterSheetLibrary;
  }

  async function parseRosterBuffer(buffer) {
    const XLSX = await loadSpreadsheetLibrary();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) {
      throw new Error('No sheet found in that file.');
    }
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
      .filter((row) => row.some((cell) => String(cell).trim() !== ''));
    if (rows.length < 2) {
      throw new Error('The spreadsheet needs a header row and at least one player.');
    }
    const headers = rows[0].map(normalizeHeader);
    const find = (...names) => headers.findIndex((header) => names.includes(header));
    const nameIndex = find('name', 'player', 'player name', 'full name');
    const firstIndex = find('first name', 'first', 'firstname');
    const lastIndex = find('last name', 'last', 'lastname', 'surname');
    const numberIndex = find('number', 'no', 'jersey', 'jersey number', 'jersey no', 'num', '#');
    const positionIndex = find('position', 'pos');
    if (nameIndex < 0 && firstIndex < 0 && lastIndex < 0) {
      throw new Error('Could not find a Name column. Use headers like Name, Number, Position.');
    }
    const imported = [];
    rows.slice(1).forEach((row) => {
      const name = nameIndex >= 0
        ? String(row[nameIndex]).trim()
        : `${firstIndex >= 0 ? String(row[firstIndex]).trim() : ''} ${lastIndex >= 0 ? String(row[lastIndex]).trim() : ''}`.trim();
      if (!name) {
        return;
      }
      imported.push({
        name: name.slice(0, 60),
        number: numberIndex >= 0 ? String(row[numberIndex]).replace(/\D/g, '').slice(0, 3) : '',
        position: positionIndex >= 0 ? normalizePosition(row[positionIndex]) : ''
      });
    });
    if (!imported.length) {
      throw new Error('No players were found in that spreadsheet.');
    }
    return imported;
  }

  function googleSheetRequestUrl(text) {
    const match = String(text).match(/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
    if (!match) {
      return '';
    }
    const gid = String(text).match(/[#?&]gid=(\d+)/);
    return `/api/google-sheet?id=${encodeURIComponent(match[1])}&gid=${gid ? gid[1] : '0'}`;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  const wrap = document.querySelector('.side-menu');
  const toggle = wrap.querySelector('.side-menu-toggle');
  const list = wrap.querySelector('.side-menu-list');
  const rosterItem = el('button', 'side-menu-item', 'Team Roster');
  rosterItem.type = 'button';
  const scoreSheetItem = el('button', 'side-menu-item', 'Game Score Sheet');
  scoreSheetItem.type = 'button';
  scoreSheetItem.addEventListener('click', () => {
    list.classList.add('hidden');
    toggle.setAttribute('aria-expanded', 'false');
    document.dispatchEvent(new Event('open-game-score-sheet'));
  });
  const rulesItem = el('button', 'side-menu-item', 'Game Rules');
  rulesItem.type = 'button';
  rulesItem.addEventListener('click', () => {
    list.classList.add('hidden');
    toggle.setAttribute('aria-expanded', 'false');
    document.dispatchEvent(new Event('open-game-rules'));
  });
  const conversionItem = el('button', 'side-menu-item', 'Playlist Conversion');
  conversionItem.type = 'button';
  conversionItem.setAttribute('data-integrations-any', '');
  conversionItem.addEventListener('click', () => {
    list.classList.add('hidden');
    toggle.setAttribute('aria-expanded', 'false');
    document.dispatchEvent(new Event('open-playlist-conversion'));
  });
  list.prepend(rosterItem, scoreSheetItem, rulesItem, conversionItem);
  window.SoundboardIntegrations.syncUI();
  document.getElementById('settingsToggle').addEventListener('click', () => {
    list.classList.add('hidden');
    toggle.setAttribute('aria-expanded', 'false');
  });

  const dialog = el('div', 'song-editor roster-editor hidden');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'rosterDialogHeading');
  dialog.tabIndex = -1;
  const card = el('div', 'song-editor-card roster-card');
  const rosterHeading = el('div', 'roster-heading');
  const heading = el('h3', '', 'Team Roster');
  heading.id = 'rosterDialogHeading';
  rosterHeading.appendChild(heading);
  card.appendChild(rosterHeading);

  const linkField = el('label', 'editor-field wide');
  linkField.appendChild(el('span', '', 'Official USA Hockey roster link'));
  const linkInput = el('input');
  linkInput.type = 'url';
  linkInput.placeholder = 'https://www.usahockey.com/...';
  linkField.appendChild(linkInput);
  const openLink = el('a', 'roster-open-link', 'Open official roster ↗');
  openLink.target = '_blank';
  openLink.rel = 'noopener noreferrer';
  rosterHeading.appendChild(openLink);

  const table = el('div', 'roster-table');
  table.setAttribute('role', 'table');
  const tableHeader = el('div', 'roster-row roster-header');
  tableHeader.setAttribute('role', 'row');
  ['#', 'Player', 'Position', ''].forEach((label) => {
    const cell = el('span', '', label);
    cell.setAttribute('role', 'columnheader');
    tableHeader.appendChild(cell);
  });
  const players = el('div', 'roster-players');
  players.setAttribute('role', 'rowgroup');
  table.append(tableHeader, players);

  const addRow = el('div', 'roster-row roster-add');
  const nameInput = el('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Player name';
  nameInput.setAttribute('aria-label', 'Player name');
  nameInput.maxLength = 60;
  const numberInput = el('input');
  numberInput.type = 'text';
  numberInput.placeholder = '#';
  numberInput.setAttribute('aria-label', 'Jersey number');
  numberInput.maxLength = 3;
  numberInput.inputMode = 'numeric';
  const positionSelect = el('select');
  positionSelect.setAttribute('aria-label', 'Player position');
  POSITIONS.forEach((position) => {
    const option = el('option', '', position === 'P' ? 'P - Player' : position);
    option.value = position;
    positionSelect.appendChild(option);
  });
  const addButton = el('button', 'source-button', 'Add');
  addButton.type = 'button';
  addRow.append(numberInput, nameInput, positionSelect, addButton);

  function createOptionSection(title, className) {
    const section = el('details', `roster-option ${className}`);
    section.appendChild(el('summary', '', title));
    const content = el('div', 'roster-option-content');
    section.appendChild(content);
    return { section, content };
  }

  const addSection = createOptionSection('Add a player', 'roster-add-option');
  addSection.content.appendChild(addRow);

  const importBox = el('div', 'roster-import');
  importBox.appendChild(el('p', 'roster-import-hint', 'Columns: Name, Number, Position. File type is detected automatically.'));
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.setAttribute('aria-label', 'Choose roster spreadsheet');
  fileInput.accept = '.csv,.tsv,.txt,.xlsx,.xlsm,.xls,.ods,.numbers,.html,text/csv';
  const sheetsRow = el('div', 'roster-sheets-row');
  const sheetsInput = el('input');
  sheetsInput.type = 'url';
  sheetsInput.setAttribute('aria-label', 'Google Sheets roster link');
  sheetsInput.placeholder = 'Or paste a Google Sheets link';
  const sheetsButton = el('button', 'source-button secondary', 'Import link');
  sheetsButton.type = 'button';
  sheetsRow.append(sheetsInput, sheetsButton);
  const replaceLabel = el('label', 'roster-replace');
  const replaceBox = el('input');
  replaceBox.type = 'checkbox';
  replaceBox.checked = true;
  replaceLabel.append(replaceBox, document.createTextNode(' Replace current players'));
  const importStatus = el('p', 'roster-status');
  importBox.append(fileInput, sheetsRow, replaceLabel, importStatus);
  const importSection = createOptionSection('Import roster', 'roster-import-option');
  importSection.content.appendChild(importBox);

  const linkSection = createOptionSection('Official roster link', 'roster-link-option');
  linkSection.content.appendChild(linkField);

  const options = el('div', 'roster-options');
  options.append(addSection.section, importSection.section, linkSection.section);
  const closeRow = el('div', 'editor-actions');
  const closeButton = el('button', 'source-button ghost', 'Close');
  closeButton.type = 'button';
  closeRow.appendChild(closeButton);
  card.append(table, options, closeRow);
  dialog.appendChild(card);

  let roster = loadRoster();

  function sortedPlayers() {
    return roster.players
      .map((player, index) => ({ player, index }))
      .sort((a, b) => (Number(a.player.number) || 999) - (Number(b.player.number) || 999));
  }

  function renderPlayers() {
    players.textContent = '';
    const sorted = sortedPlayers();
    sorted.forEach(({ player, index }) => {
      const row = el('div', 'roster-row roster-player');
      row.setAttribute('role', 'row');
      row.append(
        el('span', 'roster-number', player.number ? `#${player.number}` : '—'),
        el('span', 'roster-name', player.name),
        el('span', 'roster-position', player.position || '')
      );
      row.querySelectorAll('span').forEach((cell) => cell.setAttribute('role', 'cell'));
      const remove = el('button', 'roster-remove', '✕');
      remove.type = 'button';
      remove.title = `Remove ${player.name}`;
      remove.setAttribute('aria-label', `Remove ${player.name}`);
      remove.addEventListener('click', () => {
        roster.players.splice(index, 1);
        saveRoster(roster);
        renderPlayers();
      });
      const actions = el('span');
      actions.setAttribute('role', 'cell');
      actions.appendChild(remove);
      row.appendChild(actions);
      players.appendChild(row);
    });
    for (let index = sorted.length; index < 17; index += 1) {
      const row = el('div', 'roster-row roster-slot-empty');
      row.setAttribute('role', 'row');
      row.setAttribute('aria-label', `Empty roster slot ${index + 1}`);
      for (let cellIndex = 0; cellIndex < 4; cellIndex += 1) {
        const cell = el('span');
        cell.setAttribute('role', 'cell');
        row.appendChild(cell);
      }
      players.appendChild(row);
    }
  }

  function updateLink() {
    const url = safeUrl(linkInput.value);
    openLink.classList.toggle('hidden', !url);
    if (url) {
      openLink.href = url;
    } else {
      openLink.removeAttribute('href');
    }
  }

  function openDialog() {
    roster = loadRoster();
    linkInput.value = roster.link;
    updateLink();
    renderPlayers();
    list.classList.add('hidden');
    toggle.setAttribute('aria-expanded', 'false');
    dialog.classList.remove('hidden');
    dialog.focus();
  }

  function closeDialog() {
    dialog.classList.add('hidden');
  }

  function addPlayer() {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    roster.players.push({
      name,
      number: numberInput.value.replace(/\D/g, '').slice(0, 3),
      position: positionSelect.value
    });
    saveRoster(roster);
    nameInput.value = '';
    numberInput.value = '';
    renderPlayers();
    numberInput.focus();
  }

  async function applyImport(getBuffer) {
    importStatus.textContent = 'Importing...';
    try {
      const imported = await parseRosterBuffer(await getBuffer());
      roster = loadRoster();
      roster.players = replaceBox.checked ? imported : roster.players.concat(imported);
      saveRoster(roster);
      renderPlayers();
      importStatus.textContent = `Imported ${imported.length} player${imported.length === 1 ? '' : 's'}.`;
    } catch (error) {
      importStatus.textContent = error.message || 'Import failed.';
    }
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (file) {
      await applyImport(() => file.arrayBuffer());
    }
    fileInput.value = '';
  });
  sheetsButton.addEventListener('click', () => {
    const requestUrl = googleSheetRequestUrl(sheetsInput.value);
    if (!requestUrl) {
      importStatus.textContent = 'Paste a full Google Sheets link (docs.google.com/spreadsheets/d/...).';
      return;
    }
    applyImport(async () => {
      const response = await fetch(requestUrl, { credentials: 'same-origin' });
      if (!response.ok) {
        let message = 'Could not read the Google Sheet.';
        try {
          message = (await response.json()).error || message;
        } catch (error) {
          // keep default message
        }
        throw new Error(message);
      }
      return response.arrayBuffer();
    });
  });

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const hidden = list.classList.toggle('hidden');
    toggle.setAttribute('aria-expanded', String(!hidden));
  });
  document.addEventListener('click', (event) => {
    if (!wrap.contains(event.target)) {
      list.classList.add('hidden');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
  rosterItem.addEventListener('click', openDialog);
  addButton.addEventListener('click', addPlayer);
  [nameInput, numberInput].forEach((input) => input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addPlayer();
    }
  }));
  linkInput.addEventListener('input', updateLink);
  linkInput.addEventListener('change', () => {
    const url = safeUrl(linkInput.value);
    roster.link = url;
    linkInput.value = url;
    saveRoster(roster);
    updateLink();
  });
  closeButton.addEventListener('click', closeDialog);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      closeDialog();
    }
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeDialog();
    }
  });

  document.body.appendChild(dialog);
})();
