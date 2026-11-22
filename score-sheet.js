(function () {
  const STORAGE_KEY = 'hockey-soundboard-score-sheet-v1';
  const HISTORY_KEY = 'hockey-soundboard-score-sheet-history-v1';
  const SHEET_WIDTH = 800;
  const SHEET_HEIGHT = 1040;
  const fields = [];
  const sections = [];
  const metadata = [];
  let savedValues = {};
  let undoSnapshot = null;
  let history = [];

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

  const dialog = el('div', 'song-editor score-sheet-editor hidden');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'scoreSheetHeading');
  const card = el('div', 'score-sheet-card');
  const toolbar = el('div', 'score-sheet-toolbar');
  const heading = el('h3', '', 'Game Score Sheet');
  heading.id = 'scoreSheetHeading';
  const actions = el('div', 'score-sheet-actions');
  const saveGame = el('button', 'source-button secondary', 'Save Game & Start New');
  saveGame.type = 'button';
  const download = el('button', 'source-button', 'Download PDF');
  download.type = 'button';
  const reset = el('button', 'source-button secondary', 'Reset Score Sheet');
  reset.type = 'button';
  const close = el('button', 'source-button ghost', 'Close');
  close.type = 'button';
  actions.append(download, saveGame, reset, close);
  toolbar.append(heading, actions);
  const status = el('p', 'score-sheet-status');
  status.setAttribute('role', 'status');
  const hint = el('p', 'score-sheet-hint', 'Fill in the blank sheet below. Entries save on this browser. Download PDF exports the completed sheet; typed sign-offs are not digital signatures.');
  const workspace = el('div', 'score-sheet-workspace');
  const quickControls = el('aside', 'score-sheet-quick-controls');
  quickControls.setAttribute('aria-label', 'Quick score sheet controls');
  const scroll = el('div', 'score-sheet-scroll');
  const sheet = el('div', 'game-score-sheet');
  sheet.setAttribute('aria-label', 'Blank hockey game score sheet');
  sheet.appendChild(el('h4', 'score-sheet-title', 'HOCKEY GAME SCORE SHEET'));
  scroll.appendChild(sheet);
  workspace.append(quickControls, scroll);
  card.append(toolbar, hint, status, workspace);
  dialog.appendChild(card);
  document.body.appendChild(dialog);

  function reportError(message, error) {
    console.error(message, error);
    status.textContent = message;
    status.classList.add('is-error');
  }

  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      throw new Error('Invalid saved score sheet.');
    }
    savedValues = stored;
  } catch (error) {
    reportError('The saved score sheet could not be loaded. A blank sheet is shown.', error);
  }
  try {
    const storedHistory = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    history = Array.isArray(storedHistory) ? storedHistory : [];
  } catch (error) {
    console.error('Could not load score sheet history.', error);
    history = [];
  }

  function save() {
    const values = {};
    fields.forEach(({ key, input }) => {
      values[key] = input.value;
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
      window.SoundboardScoreSheet?.refresh();
      status.textContent = 'Score sheet saved on this browser.';
      status.classList.remove('is-error');
    } catch (error) {
      reportError('Could not save this score sheet. Download a PDF to keep your entries.', error);
    }
  }

  function field(key, label, maxLength = 60) {
    const input = el('input', 'score-sheet-input');
    input.type = 'text';
    input.maxLength = maxLength;
    input.setAttribute('aria-label', label);
    input.autocomplete = 'off';
    input.value = typeof savedValues[key] === 'string' ? savedValues[key].slice(0, maxLength) : '';
    input.addEventListener('input', save);
    fields.push({ key, input });
    return input;
  }

  function meta(key, label, x, y, width, maxLength = 60) {
    const container = el('label', 'score-sheet-meta');
    Object.assign(container.style, { left: `${x}px`, top: `${y}px`, width: `${width}px` });
    container.appendChild(el('span', '', `${label}:`));
    const input = field(key, label, maxLength);
    container.appendChild(input);
    sheet.appendChild(container);
    metadata.push({ label, x, y, width, input });
  }

  meta('date', 'Date', 16, 35, 150, 20);
  meta('time', 'Time', 180, 35, 130, 20);
  meta('rink', 'Rink', 325, 35, 285);
  meta('game-number', 'Game #', 625, 35, 159, 20);
  meta('visitor-team', 'Visitor team', 16, 62, 374);
  meta('home-team', 'Home team', 410, 62, 374);

  function tableSection(key, title, x, y, width, columns, rowCount, rowHeight, presets = []) {
    const container = el('section', 'score-sheet-section');
    Object.assign(container.style, { left: `${x}px`, top: `${y}px`, width: `${width}px` });
    container.appendChild(el('h5', '', title));
    const table = el('table');
    const caption = el('caption', 'score-sheet-sr-only', title);
    const header = el('tr');
    columns.forEach(({ label, width: columnWidth }) => {
      const th = el('th', '', label);
      th.scope = 'col';
      th.style.width = `${columnWidth}%`;
      header.appendChild(th);
    });
    const thead = el('thead');
    thead.appendChild(header);
    const tbody = el('tbody');
    const rows = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const row = el('tr');
      row.style.height = `${rowHeight}px`;
      const cells = columns.map(({ label, maxLength = 40 }, columnIndex) => {
        const td = el('td');
        const preset = presets[rowIndex] && presets[rowIndex][columnIndex];
        const input = preset === undefined
          ? field(`${key}-${rowIndex}-${columnIndex}`, `${title}, row ${rowIndex + 1}, ${label}`, maxLength)
          : null;
        td.appendChild(input || el('span', 'score-sheet-cell-label', preset));
        row.appendChild(td);
        return { input, preset };
      });
      rows.push(cells);
      tbody.appendChild(row);
    }
    table.append(caption, thead, tbody);
    container.appendChild(table);
    sheet.appendChild(container);
    sections.push({ title, x, y, width, columns, rows, rowHeight });
  }

  const rosterColumns = [
    { label: 'No', width: 16, maxLength: 3 },
    { label: 'Pos', width: 16, maxLength: 4 },
    { label: 'Player', width: 68, maxLength: 60 }
  ];
  const scoringColumns = [
    { label: 'Per', width: 12, maxLength: 3 },
    { label: 'Time', width: 25, maxLength: 8 },
    { label: 'G', width: 15, maxLength: 3 },
    { label: 'A1', width: 15, maxLength: 3 },
    { label: 'A2', width: 15, maxLength: 3 },
    { label: 'S/P', width: 18, maxLength: 4 }
  ];
  tableSection('visitor-roster', 'VISITOR ROSTER', 16, 96, 178, rosterColumns, 17, 20);
  tableSection('home-roster', 'HOME ROSTER', 606, 96, 178, rosterColumns, 17, 20);
  meta('visitor-score', 'Visitor final score', 200, 96, 194, 3);
  meta('home-score', 'Home final score', 406, 96, 194, 3);
  tableSection('visitor-scoring', 'VISITOR SCORING', 194, 123, 206, scoringColumns, 13, 17);
  tableSection('home-scoring', 'HOME SCORING', 400, 123, 206, scoringColumns, 13, 17);

  const goalieColumns = [
    { label: 'No', width: 12, maxLength: 3 },
    { label: 'Record', width: 28 },
    { label: '1', width: 12, maxLength: 3 },
    { label: '2', width: 12, maxLength: 3 },
    { label: '3', width: 12, maxLength: 3 },
    { label: 'OT', width: 12, maxLength: 3 },
    { label: 'Total', width: 12, maxLength: 4 }
  ];
  const goaliePresets = [
    [undefined, 'Shots'], [undefined, 'Saves'],
    [undefined, 'Shots'], [undefined, 'Saves']
  ];
  tableSection('visitor-goalies', 'VISITOR GOALTENDERS', 194, 386, 206, goalieColumns, 4, 16, goaliePresets);
  tableSection('home-goalies', 'HOME GOALTENDERS', 400, 386, 206, goalieColumns, 4, 16, goaliePresets);

  const coachColumns = [{ label: 'Role', width: 40 }, { label: 'Name / sign-off', width: 60, maxLength: 60 }];
  const coachPresets = [['Head coach'], ['Sign-off'], ['Asst. coach'], ['Sign-off'], ['Asst. coach'], ['Sign-off']];
  tableSection('visitor-coaches', 'VISITOR STAFF', 16, 492, 178, coachColumns, 6, 21, coachPresets);
  tableSection('home-coaches', 'HOME STAFF', 606, 492, 178, coachColumns, 6, 21, coachPresets);
  const officialColumns = [{ label: 'Role', width: 30 }, { label: 'Name / sign-off', width: 70, maxLength: 80 }];
  tableSection('officials', 'GAME OFFICIALS', 194, 492, 412, officialColumns, 6, 21,
    [['Referee 1'], ['Referee 2'], ['Linesperson 1'], ['Linesperson 2'], ['Sign-off'], ['Sign-off time']]);
  const contactColumns = [{ label: 'Detail', width: 32 }, { label: 'Value', width: 68, maxLength: 60 }];
  tableSection('visitor-contact', 'VISITOR TEAM DETAILS', 16, 662, 384, contactColumns, 3, 18,
    [['Roster #'], ['Manager'], ['Phone']]);
  tableSection('home-contact', 'HOME TEAM DETAILS', 400, 662, 384, contactColumns, 3, 18,
    [['Roster #'], ['Manager'], ['Phone']]);
  const penaltyColumns = [
    { label: 'Per', width: 8, maxLength: 3 },
    { label: 'Player', width: 10, maxLength: 3 },
    { label: 'Penalty', width: 38, maxLength: 60 },
    { label: 'Min', width: 8, maxLength: 4 },
    { label: 'Off', width: 12, maxLength: 8 },
    { label: 'Start', width: 12, maxLength: 8 },
    { label: 'On', width: 12, maxLength: 8 }
  ];
  tableSection('visitor-penalties', 'PENALTIES - VISITOR', 16, 764, 384, penaltyColumns, 12, 19);
  tableSection('home-penalties', 'PENALTIES - HOME', 400, 764, 384, penaltyColumns, 12, 19);

  const fieldsByKey = Object.fromEntries(fields.map((entry) => [entry.key, entry.input]));
  const teamNames = {
    visitor: 'Visitor',
    home: 'Home'
  };

  function quickControl(labelText, control) {
    const label = el('label', 'score-sheet-quick-field');
    label.append(el('span', '', labelText), control);
    return label;
  }

  quickControls.appendChild(el('h4', '', 'Live Game Entry'));
  quickControls.appendChild(el('p', 'score-sheet-quick-note',
    'Quick entries update the matching scoring, goalie, and penalty rows below.'));

  const team = el('select');
  team.innerHTML = '<option value="visitor">Visitor</option><option value="home">Home</option>';
  const period = el('select');
  period.innerHTML = '<option value="1">Period 1</option><option value="2">Period 2</option><option value="3">Period 3</option><option value="OT">OT</option>';
  const gameTime = el('input');
  gameTime.type = 'text';
  gameTime.maxLength = 8;
  gameTime.placeholder = 'MM:SS';
  gameTime.autocomplete = 'off';
  const player = el('input');
  player.type = 'text';
  player.maxLength = 3;
  player.placeholder = 'Player #';
  player.autocomplete = 'off';
  const assistOne = el('input');
  assistOne.type = 'text';
  assistOne.maxLength = 3;
  assistOne.placeholder = 'Assist 1';
  assistOne.autocomplete = 'off';
  const assistTwo = el('input');
  assistTwo.type = 'text';
  assistTwo.maxLength = 3;
  assistTwo.placeholder = 'Assist 2';
  assistTwo.autocomplete = 'off';
  const penaltyName = el('input');
  penaltyName.type = 'text';
  penaltyName.maxLength = 60;
  penaltyName.placeholder = 'Penalty type';
  penaltyName.autocomplete = 'off';
  const penaltyMinutes = el('select');
  penaltyMinutes.innerHTML = '<option value="2">2 min</option><option value="4">4 min</option><option value="5">5 min</option><option value="10">10 min</option>';

  quickControls.append(
    quickControl('Team', team),
    quickControl('Period', period),
    quickControl('Game time', gameTime),
    quickControl('Player #', player),
    quickControl('Assist 1', assistOne),
    quickControl('Assist 2', assistTwo),
    quickControl('Penalty', penaltyName),
    quickControl('Minutes', penaltyMinutes)
  );

  const quickButtons = el('div', 'score-sheet-quick-buttons');
  const goalButton = el('button', 'score-sheet-quick-button goal', 'Goal for team');
  const saveButton = el('button', 'score-sheet-quick-button', 'Save by team');
  const shotButton = el('button', 'score-sheet-quick-button', 'Shot on team');
  const penaltyButton = el('button', 'score-sheet-quick-button penalty', 'Add penalty');
  const undoButton = el('button', 'score-sheet-quick-button undo', 'Undo last entry');
  [goalButton, saveButton, shotButton, penaltyButton, undoButton].forEach((button) => {
    button.type = 'button';
  });
  quickButtons.append(goalButton, saveButton, shotButton, penaltyButton, undoButton);
  quickControls.appendChild(quickButtons);

  const categoryActions = el('section', 'scorekeeper-category-actions');
  categoryActions.append(
    el('h3', '', 'Scorekeeper'),
    el('p', 'scorekeeper-score', '0 - 0')
  );
  const categoryButtons = el('div', 'scorekeeper-category-buttons');
  const categoryGoal = el('button', 'score-sheet-quick-button goal', 'Goal');
  const categoryPenalty = el('button', 'score-sheet-quick-button penalty', 'Penalty');
  const categorySave = el('button', 'score-sheet-quick-button', 'Save');
  const categoryShot = el('button', 'score-sheet-quick-button', 'Shot');
  const categoryEdit = el('button', 'score-sheet-quick-button undo', 'Edit Sheet');
  const categoryHistory = el('button', 'score-sheet-quick-button undo', 'Game History');
  const categoryUndo = el('button', 'score-sheet-quick-button undo', 'Undo');
  [categoryGoal, categoryPenalty, categorySave, categoryShot, categoryUndo, categoryEdit, categoryHistory]
    .forEach((button) => { button.type = 'button'; });
  categoryButtons.append(categoryGoal, categoryPenalty, categorySave, categoryShot,
    categoryUndo, categoryEdit, categoryHistory);
  categoryActions.appendChild(categoryButtons);

  const eventDialog = el('div', 'song-editor score-sheet-entry-editor hidden');
  eventDialog.setAttribute('role', 'dialog');
  eventDialog.setAttribute('aria-modal', 'true');
  const eventCard = el('form', 'song-editor-card score-sheet-entry-card');
  const eventHeading = el('h3', '', 'Add Goal');
  const eventStatus = el('p', 'auth-error');
  eventStatus.setAttribute('role', 'status');
  const eventFields = el('div', 'editor-grid compact');
  const eventTeam = el('select');
  eventTeam.innerHTML = '<option value="visitor">Visitor</option><option value="home">Home</option>';
  const eventPeriod = el('select');
  eventPeriod.innerHTML = '<option value="1">Period 1</option><option value="2">Period 2</option><option value="3">Period 3</option><option value="OT">OT</option>';
  const eventTime = el('input');
  eventTime.placeholder = 'MM:SS';
  eventTime.maxLength = 8;
  const eventPlayer = el('input');
  eventPlayer.placeholder = 'Player #';
  eventPlayer.maxLength = 3;
  const eventAssistOne = el('input');
  eventAssistOne.placeholder = 'Assist 1';
  eventAssistOne.maxLength = 3;
  const eventAssistTwo = el('input');
  eventAssistTwo.placeholder = 'Assist 2';
  eventAssistTwo.maxLength = 3;
  const eventStrength = el('select');
  eventStrength.innerHTML = '<option value="">Even strength</option><option value="PP">Power play</option><option value="SH">Short-handed</option><option value="EN">Empty net</option><option value="PS">Penalty shot</option>';
  const eventPenalty = el('input');
  eventPenalty.placeholder = 'Penalty type';
  eventPenalty.maxLength = 60;
  const eventMinutes = el('select');
  eventMinutes.innerHTML = '<option value="2">2 min</option><option value="4">4 min</option><option value="5">5 min</option><option value="10">10 min</option>';
  const eventOff = el('input');
  const eventStart = el('input');
  const eventOn = el('input');
  [eventOff, eventStart, eventOn].forEach((input) => {
    input.placeholder = 'MM:SS';
    input.maxLength = 8;
  });
  const eventSubmit = el('button', 'source-button', 'Submit');
  eventSubmit.type = 'submit';
  const eventCancel = el('button', 'source-button ghost', 'Cancel');
  eventCancel.type = 'button';
  eventCard.append(eventHeading, eventStatus, eventFields, eventSubmit, eventCancel);
  eventDialog.appendChild(eventCard);
  document.body.appendChild(eventDialog);
  let eventType = 'goal';

  function entryLabel(text, control) {
    const label = el('label', 'editor-field');
    label.append(el('span', '', text), control);
    return label;
  }

  function closeEventDialog() {
    eventDialog.classList.add('hidden');
  }

  function openEventDialog(type) {
    eventType = type;
    eventHeading.textContent = type === 'goal' ? 'Add Goal' : 'Add Penalty';
    eventSubmit.textContent = type === 'goal' ? 'Add Goal' : 'Add Penalty';
    eventFields.replaceChildren(
      entryLabel('Team', eventTeam),
      entryLabel('Period', eventPeriod),
      entryLabel('Game time', eventTime),
      entryLabel('Player #', eventPlayer)
    );
    if (type === 'goal') {
      eventFields.append(
        entryLabel('Assist 1', eventAssistOne),
        entryLabel('Assist 2', eventAssistTwo),
        entryLabel('Goal type', eventStrength)
      );
    } else {
      eventFields.append(
        entryLabel('Penalty', eventPenalty),
        entryLabel('Minutes', eventMinutes),
        entryLabel('Off', eventOff),
        entryLabel('Start', eventStart),
        entryLabel('On', eventOn)
      );
    }
    eventTeam.value = team.value;
    eventPeriod.value = period.value;
    eventTime.value = gameTime.value;
    eventPlayer.value = player.value;
    eventAssistOne.value = assistOne.value;
    eventAssistTwo.value = assistTwo.value;
    eventPenalty.value = penaltyName.value;
    eventMinutes.value = penaltyMinutes.value;
    eventOff.value = eventTime.value;
    eventStart.value = eventTime.value;
    eventOn.value = '';
    eventStatus.textContent = '';
    eventDialog.classList.remove('hidden');
    eventTime.focus();
  }

  eventCancel.addEventListener('click', closeEventDialog);
  eventDialog.addEventListener('click', (event) => {
    if (event.target === eventDialog) closeEventDialog();
  });

  function currentPeriodColumn(value = period.value) {
    return value === 'OT' ? 5 : Number(value) + 1;
  }

  function snapshotValues() {
    undoSnapshot = new Map(fields.map(({ input }) => [input, input.value]));
  }

  function setNumericValue(input, value) {
    if (!input) return;
    input.value = String(Math.max(0, (Number.parseInt(input.value, 10) || 0) + value));
  }

  function firstEmptyRow(prefix, rowCount) {
    for (let row = 0; row < rowCount; row += 1) {
      const cells = fields.filter(({ key }) => key.startsWith(`${prefix}-${row}-`));
      if (cells.every(({ input }) => !input.value.trim())) return row;
    }
    return -1;
  }

  function recordGoalieStat(teamKey, stat, amount = 1, periodValue = period.value) {
    const row = stat === 'shots' ? 0 : 1;
    setNumericValue(fieldsByKey[`${teamKey}-goalies-${row}-${currentPeriodColumn(periodValue)}`], amount);
    setNumericValue(fieldsByKey[`${teamKey}-goalies-${row}-6`], amount);
  }

  function failQuickAction(message) {
    status.textContent = message;
    status.classList.add('is-error');
  }

  function finishQuickAction(message) {
    save();
    if (!status.classList.contains('is-error')) {
      status.textContent = message;
    }
  }

  function addGoal(teamKey, periodValue, timeValue, playerValue, assistOneValue, assistTwoValue, strengthValue = '') {
    const row = firstEmptyRow(`${teamKey}-scoring`, 13);
    if (row < 0) {
      failQuickAction(`${teamNames[teamKey]} scoring has no blank rows left.`);
      return false;
    }
    if (!playerValue.trim()) {
      failQuickAction('Enter the goal scorer number first.');
      return false;
    }
    snapshotValues();
    fieldsByKey[`${teamKey}-scoring-${row}-0`].value = periodValue;
    fieldsByKey[`${teamKey}-scoring-${row}-1`].value = timeValue;
    fieldsByKey[`${teamKey}-scoring-${row}-2`].value = playerValue;
    fieldsByKey[`${teamKey}-scoring-${row}-3`].value = assistOneValue;
    fieldsByKey[`${teamKey}-scoring-${row}-4`].value = assistTwoValue;
    fieldsByKey[`${teamKey}-scoring-${row}-5`].value = strengthValue;
    setNumericValue(fieldsByKey[`${teamKey}-score`], 1);
    const defendingTeam = teamKey === 'home' ? 'visitor' : 'home';
    recordGoalieStat(defendingTeam, 'shots', 1, periodValue);
    finishQuickAction(`Goal added for ${teamNames[teamKey]}.`);
    return true;
  }

  function addPenalty(teamKey, periodValue, timeValue, playerValue, penaltyValue, minutesValue,
    offValue = timeValue, startValue = timeValue, onValue = '') {
    const row = firstEmptyRow(`${teamKey}-penalties`, 12);
    if (row < 0) {
      failQuickAction(`${teamNames[teamKey]} penalties have no blank rows left.`);
      return false;
    }
    snapshotValues();
    fieldsByKey[`${teamKey}-penalties-${row}-0`].value = periodValue;
    fieldsByKey[`${teamKey}-penalties-${row}-1`].value = playerValue;
    fieldsByKey[`${teamKey}-penalties-${row}-2`].value = penaltyValue;
    fieldsByKey[`${teamKey}-penalties-${row}-3`].value = minutesValue;
    fieldsByKey[`${teamKey}-penalties-${row}-4`].value = offValue;
    fieldsByKey[`${teamKey}-penalties-${row}-5`].value = startValue;
    fieldsByKey[`${teamKey}-penalties-${row}-6`].value = onValue;
    finishQuickAction(`Penalty added for ${teamNames[teamKey]}.`);
    return true;
  }

  goalButton.addEventListener('click', () => openEventDialog('goal'));
  categoryGoal.addEventListener('click', () => openEventDialog('goal'));

  saveButton.addEventListener('click', () => {
    snapshotValues();
    recordGoalieStat(team.value, 'saves');
    recordGoalieStat(team.value, 'shots');
    finishQuickAction(`Save added for ${teamNames[team.value]}.`);
  });
  categorySave.addEventListener('click', () => saveButton.click());

  shotButton.addEventListener('click', () => {
    snapshotValues();
    recordGoalieStat(team.value, 'shots');
    finishQuickAction(`Shot on ${teamNames[team.value]} added.`);
  });
  categoryShot.addEventListener('click', () => shotButton.click());

  penaltyButton.addEventListener('click', () => openEventDialog('penalty'));
  categoryPenalty.addEventListener('click', () => openEventDialog('penalty'));
  categoryEdit.addEventListener('click', () => document.dispatchEvent(new Event('open-game-score-sheet')));

  eventCard.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!eventPlayer.value.trim()) {
      eventStatus.textContent = 'Enter a player number.';
      eventPlayer.focus();
      return;
    }
    if (eventType === 'goal') {
      if (addGoal(eventTeam.value, eventPeriod.value, eventTime.value.trim(),
        eventPlayer.value.trim(), eventAssistOne.value.trim(), eventAssistTwo.value.trim(), eventStrength.value)) {
        closeEventDialog();
      }
    } else {
      if (!eventPenalty.value.trim()) {
        eventStatus.textContent = 'Enter a penalty type.';
        eventPenalty.focus();
        return;
      }
      if (addPenalty(eventTeam.value, eventPeriod.value, eventTime.value.trim(),
        eventPlayer.value.trim(), eventPenalty.value.trim(), eventMinutes.value,
        eventOff.value.trim(), eventStart.value.trim(), eventOn.value.trim())) {
        closeEventDialog();
      }
    }
  });

  undoButton.addEventListener('click', () => {
    if (!undoSnapshot) {
      failQuickAction('There is no quick entry to undo.');
      return;
    }
    fields.forEach(({ input }) => {
      input.value = undoSnapshot.get(input) ?? input.value;
    });
    undoSnapshot = null;
    finishQuickAction('Last quick entry undone.');
  });
  categoryUndo.addEventListener('click', () => undoButton.click());

  const historyDialog = el('div', 'song-editor score-sheet-history-editor hidden');
  historyDialog.setAttribute('role', 'dialog');
  const historyCard = el('div', 'song-editor-card score-sheet-history-card');
  const historyHeading = el('h3', '', 'Saved Game Sheets');
  const historyList = el('div', 'score-sheet-history-list');
  const historyClose = el('button', 'source-button ghost', 'Close');
  historyClose.type = 'button';
  historyCard.append(historyHeading, historyList, historyClose);
  historyDialog.appendChild(historyCard);
  document.body.appendChild(historyDialog);

  function collectValues() {
    return Object.fromEntries(fields.map(({ key, input }) => [key, input.value]));
  }

  function renderHistory() {
    historyList.replaceChildren();
    if (!history.length) {
      historyList.appendChild(el('p', '', 'No completed game sheets saved yet.'));
      return;
    }
    history.slice().reverse().forEach((entry) => {
      const row = el('div', 'score-sheet-history-row');
      const title = `${entry.values['visitor-team'] || 'Visitor'} ${entry.values['visitor-score'] || '0'} - `
        + `${entry.values['home-score'] || '0'} ${entry.values['home-team'] || 'Home'}`;
      row.appendChild(el('strong', '', title));
      row.appendChild(el('span', '', new Date(entry.savedAt).toLocaleString()));
      const open = el('button', 'source-button secondary', 'Edit / Resume');
      open.type = 'button';
      open.addEventListener('click', () => {
        if (!window.confirm('Load this saved game into the current editable score sheet? Save the current game first if needed.')) return;
        fields.forEach(({ key, input }) => {
          input.value = typeof entry.values[key] === 'string' ? entry.values[key] : '';
        });
        undoSnapshot = null;
        save();
        historyDialog.classList.add('hidden');
        document.dispatchEvent(new Event('open-game-score-sheet'));
      });
      row.appendChild(open);
      historyList.appendChild(row);
    });
  }

  categoryHistory.addEventListener('click', () => {
    renderHistory();
    historyDialog.classList.remove('hidden');
  });
  historyClose.addEventListener('click', () => historyDialog.classList.add('hidden'));
  historyDialog.addEventListener('click', (event) => {
    if (event.target === historyDialog) historyDialog.classList.add('hidden');
  });

  saveGame.addEventListener('click', () => {
    const values = collectValues();
    const hasData = Object.values(values).some((value) => value.trim());
    if (!hasData) {
      status.textContent = 'There is no game data to save.';
      status.classList.add('is-error');
      return;
    }
    history.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, savedAt: Date.now(), values });
    history = history.slice(-50);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (error) {
      reportError('Could not save the game to history.', error);
      return;
    }
    fields.forEach(({ input }) => { input.value = ''; });
    undoSnapshot = null;
    save();
    status.textContent = 'Game saved to history. A blank score sheet is ready.';
  });

  function updateScoreCategory() {
    categoryActions.querySelector('.scorekeeper-score').textContent =
      `${teamName('visitor')} ${fieldsByKey['visitor-score'].value || 0} - `
      + `${fieldsByKey['home-score'].value || 0} ${teamName('home')}`;
  }

  function teamName(teamKey) {
    return fieldsByKey[`${teamKey}-team`].value.trim() || teamNames[teamKey];
  }

  window.SoundboardScoreSheet = {
    createCategory() {
      updateScoreCategory();
      return categoryActions;
    },
    open: () => document.dispatchEvent(new Event('open-game-score-sheet')),
    refresh: updateScoreCategory
  };

  function drawText(context, text, x, y, width, size = 11, bold = false) {
    context.font = `${bold ? 'bold ' : ''}${size}px Arial`;
    const measured = context.measureText(text).width;
    if (measured > width) {
      context.font = `${bold ? 'bold ' : ''}${Math.max(5, size * width / measured)}px Arial`;
    }
    context.fillStyle = '#111';
    context.fillText(text, x, y, width);
  }

  function renderCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = SHEET_WIDTH * 3;
    canvas.height = SHEET_HEIGHT * 3;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas rendering is not available in this browser.');
    }
    context.scale(3, 3);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, SHEET_WIDTH, SHEET_HEIGHT);
    context.strokeStyle = '#222';
    context.lineWidth = 0.6;
    drawText(context, 'HOCKEY GAME SCORE SHEET', 260, 23, 300, 16, true);
    metadata.forEach(({ label, x, y, width, input }) => {
      context.font = 'bold 11px Arial';
      const labelWidth = context.measureText(`${label}: `).width;
      drawText(context, `${label}:`, x, y + 15, labelWidth, 11, true);
      drawText(context, input.value, x + labelWidth + 3, y + 15, width - labelWidth - 4);
      context.beginPath();
      context.moveTo(x + labelWidth, y + 20);
      context.lineTo(x + width, y + 20);
      context.stroke();
    });
    sections.forEach(({ title, x, y, width, columns, rows, rowHeight }) => {
      context.fillStyle = '#e8edf2';
      context.fillRect(x, y, width, 22);
      context.strokeRect(x, y, width, 22);
      drawText(context, title, x + 5, y + 15, width - 10, 11, true);
      let cellX = x;
      columns.forEach(({ label, width: percent }, columnIndex) => {
        const cellWidth = width * percent / 100;
        context.fillStyle = '#f3f5f7';
        context.fillRect(cellX, y + 22, cellWidth, 18);
        context.strokeRect(cellX, y + 22, cellWidth, 18);
        drawText(context, label, cellX + 3, y + 35, cellWidth - 6, 9, true);
        rows.forEach((cells, rowIndex) => {
          const cellY = y + 40 + rowIndex * rowHeight;
          context.strokeRect(cellX, cellY, cellWidth, rowHeight);
          const { input, preset } = cells[columnIndex];
          drawText(context, input ? input.value : preset, cellX + 3, cellY + rowHeight * 0.7, cellWidth - 6, 10);
        });
        cellX += cellWidth;
      });
    });
    drawText(context, 'Game score sheet | Typed sign-offs are not digital signatures.', 16, 1039, 768, 7);
    return canvas;
  }

  function createPdf(canvas) {
    const jpeg = atob(canvas.toDataURL('image/jpeg', 0.95).split(',')[1]);
    const imageBytes = Uint8Array.from(jpeg, (character) => character.charCodeAt(0));
    const encoder = new TextEncoder();
    const chunks = [];
    const offsets = [0];
    let length = 0;
    const append = (value) => {
      const bytes = typeof value === 'string' ? encoder.encode(value) : value;
      chunks.push(bytes);
      length += bytes.length;
    };
    const object = (id, content) => {
      offsets[id] = length;
      append(`${id} 0 obj\n${content}\nendobj\n`);
    };
    append('%PDF-1.4\n');
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Sheet 4 0 R >> >> /Contents 5 0 R >>');
    offsets[4] = length;
    append(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`);
    append(imageBytes);
    append('\nendstream\nendobj\n');
    const content = 'q\n612 0 0 792 0 0 cm\n/Sheet Do\nQ\n';
    object(5, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
    const xrefOffset = length;
    append('xref\n0 6\n0000000000 65535 f \n');
    offsets.slice(1).forEach((offset) => append(`${String(offset).padStart(10, '0')} 00000 n \n`));
    append(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
    return new Blob(chunks, { type: 'application/pdf' });
  }

  download.addEventListener('click', () => {
    try {
      const pdf = createPdf(renderCanvas());
      const url = URL.createObjectURL(pdf);
      const anchor = el('a');
      anchor.href = url;
      anchor.download = 'game-score-sheet.pdf';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      if (!status.classList.contains('is-error')) {
        status.textContent = 'PDF download started.';
      }
    } catch (error) {
      reportError('Could not create the PDF. Please try again or use another browser.', error);
    }
  });

  reset.addEventListener('click', () => {
    if (!window.confirm('Reset the game score sheet? This will permanently clear all entries in this browser.')) {
      return;
    }
    fields.forEach(({ input }) => {
      input.value = '';
    });
    undoSnapshot = null;
    save();
    if (!status.classList.contains('is-error')) {
      status.textContent = 'Score sheet reset. All entries have been cleared.';
    }
  });

  function closeDialog() {
    dialog.classList.add('hidden');
    document.querySelector('.side-menu-toggle').focus();
  }
  close.addEventListener('click', closeDialog);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      closeDialog();
    }
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeDialog();
    }
    if (event.key === 'Tab') {
      const inputs = dialog.querySelectorAll('button, input');
      const first = inputs[0];
      const last = inputs[inputs.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  document.addEventListener('open-game-score-sheet', () => {
    dialog.classList.remove('hidden');
    download.focus();
  });
})();
