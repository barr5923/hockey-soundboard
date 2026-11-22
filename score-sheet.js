(function () {
  const STORAGE_KEY = 'hockey-soundboard-score-sheet-v1';
  const SHEET_WIDTH = 800;
  const SHEET_HEIGHT = 1040;
  const fields = [];
  const sections = [];
  const metadata = [];
  let savedValues = {};
  let undoSnapshot = null;

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
  const download = el('button', 'source-button', 'Download PDF');
  download.type = 'button';
  const reset = el('button', 'source-button secondary', 'Reset Score Sheet');
  reset.type = 'button';
  const close = el('button', 'source-button ghost', 'Close');
  close.type = 'button';
  actions.append(download, reset, close);
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

  function save() {
    const values = {};
    fields.forEach(({ key, input }) => {
      values[key] = input.value;
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
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

  function currentPeriodColumn() {
    return period.value === 'OT' ? 5 : Number(period.value) + 1;
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

  function recordGoalieStat(teamKey, stat, amount = 1) {
    const row = stat === 'shots' ? 0 : 1;
    setNumericValue(fieldsByKey[`${teamKey}-goalies-${row}-${currentPeriodColumn()}`], amount);
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

  goalButton.addEventListener('click', () => {
    const teamKey = team.value;
    const row = firstEmptyRow(`${teamKey}-scoring`, 13);
    if (row < 0) {
      failQuickAction(`${teamNames[teamKey]} scoring has no blank rows left.`);
      return;
    }
    if (!player.value.trim()) {
      failQuickAction('Enter the goal scorer number first.');
      player.focus();
      return;
    }
    snapshotValues();
    fieldsByKey[`${teamKey}-scoring-${row}-0`].value = period.value;
    fieldsByKey[`${teamKey}-scoring-${row}-1`].value = gameTime.value.trim();
    fieldsByKey[`${teamKey}-scoring-${row}-2`].value = player.value.trim();
    fieldsByKey[`${teamKey}-scoring-${row}-3`].value = assistOne.value.trim();
    fieldsByKey[`${teamKey}-scoring-${row}-4`].value = assistTwo.value.trim();
    setNumericValue(fieldsByKey[`${teamKey}-score`], 1);
    const defendingTeam = teamKey === 'home' ? 'visitor' : 'home';
    recordGoalieStat(defendingTeam, 'shots');
    finishQuickAction(`Goal added for ${teamNames[teamKey]}.`);
  });

  saveButton.addEventListener('click', () => {
    snapshotValues();
    recordGoalieStat(team.value, 'saves');
    recordGoalieStat(team.value, 'shots');
    finishQuickAction(`Save added for ${teamNames[team.value]}.`);
  });

  shotButton.addEventListener('click', () => {
    snapshotValues();
    recordGoalieStat(team.value, 'shots');
    finishQuickAction(`Shot on ${teamNames[team.value]} added.`);
  });

  penaltyButton.addEventListener('click', () => {
    const teamKey = team.value;
    const row = firstEmptyRow(`${teamKey}-penalties`, 12);
    if (row < 0) {
      failQuickAction(`${teamNames[teamKey]} penalties have no blank rows left.`);
      return;
    }
    if (!player.value.trim() || !penaltyName.value.trim()) {
      failQuickAction('Enter a player number and penalty type first.');
      (player.value.trim() ? penaltyName : player).focus();
      return;
    }
    snapshotValues();
    fieldsByKey[`${teamKey}-penalties-${row}-0`].value = period.value;
    fieldsByKey[`${teamKey}-penalties-${row}-1`].value = player.value.trim();
    fieldsByKey[`${teamKey}-penalties-${row}-2`].value = penaltyName.value.trim();
    fieldsByKey[`${teamKey}-penalties-${row}-3`].value = penaltyMinutes.value;
    fieldsByKey[`${teamKey}-penalties-${row}-4`].value = gameTime.value.trim();
    fieldsByKey[`${teamKey}-penalties-${row}-5`].value = gameTime.value.trim();
    finishQuickAction(`Penalty added for ${teamNames[teamKey]}.`);
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
