(() => {
  let nextId = 0;
  let openPicker = null;

  function create(select, label) {
    const wrapper = document.createElement('div');
    wrapper.className = 'song-picker';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Choose a song';
    input.autocomplete = 'off';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-label', label);
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    const list = document.createElement('div');
    list.className = 'song-picker-list';
    list.id = `song-picker-list-${++nextId}`;
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    input.setAttribute('aria-controls', list.id);
    if (select.parentNode) select.parentNode.insertBefore(wrapper, select);
    select.hidden = true;
    wrapper.append(select, input, list);
    let active = -1;
    let choices = [];

    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
      if (openPicker === close) openPicker = null;
    }

    function sync() {
      const placeholder = [...select.options].find((option) => option.value === '');
      if (placeholder && !placeholder.disabled) placeholder.disabled = true;
      input.disabled = select.disabled;
      const selected = select.selectedOptions[0];
      input.value = selected && selected.value ? selected.textContent : '';
      close();
    }

    function highlight(index) {
      if (!choices.length) return;
      active = Math.max(0, Math.min(index, choices.length - 1));
      choices.forEach((choice, i) => choice.node.classList.toggle('active', i === active));
      input.setAttribute('aria-activedescendant', choices[active].node.id);
      choices[active].node.scrollIntoView({ block: 'nearest' });
    }

    function choose(option) {
      if (option.disabled) return;
      select.value = option.value;
      input.value = option.textContent;
      close();
      select.dispatchEvent(new Event('change', { bubbles: true }));
      input.focus();
    }

    function show(all = false) {
      if (input.disabled) return;
      if (openPicker && openPicker !== close) openPicker();
      openPicker = close;
      list.replaceChildren();
      choices = [];
      active = -1;
      input.removeAttribute('aria-activedescendant');
      const query = all ? '' : input.value.trim().toLocaleLowerCase();
      [...select.options].forEach((option, index) => {
        if (!option.value || !option.textContent.toLocaleLowerCase().includes(query)) return;
        const item = document.createElement('div');
        item.id = `${list.id}-option-${index}`;
        item.className = 'song-picker-option';
        item.textContent = option.textContent;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        if (option.disabled) {
          item.setAttribute('aria-disabled', 'true');
        } else {
          item.addEventListener('pointerdown', (event) => event.preventDefault());
          item.addEventListener('click', () => choose(option));
          choices.push({ node: item, option });
        }
        list.append(item);
      });
      if (!list.children.length) {
        const empty = document.createElement('div');
        empty.className = 'song-picker-empty';
        empty.textContent = 'No matching songs';
        list.append(empty);
      }
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    input.addEventListener('click', () => show(Boolean(select.value)));
    input.addEventListener('input', () => {
      if (select.value) {
        select.value = '';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      show();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (list.hidden) show(Boolean(select.value));
        highlight(active < 0 ? (event.key === 'ArrowDown' ? 0 : choices.length - 1)
          : active + (event.key === 'ArrowDown' ? 1 : -1));
      } else if (event.key === 'Enter' && !list.hidden) {
        event.preventDefault();
        if (active >= 0) choose(choices[active].option);
      } else if (event.key === 'Escape') {
        if (!list.hidden) {
          event.stopPropagation();
          close();
        }
      }
    });
    wrapper.addEventListener('focusout', (event) => {
      if (!wrapper.contains(event.relatedTarget)) close();
    });
    select.addEventListener('change', () => {
      if (select.value) sync();
    });
    new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true });
    sync();
    return wrapper;
  }

  window.SongPicker = { create };
  create(document.getElementById('sharedAudioSelect'), 'Search shared songs');
  create(document.getElementById('sharedPlaylistSong'), 'Search songs in the shared playlist');
})();
