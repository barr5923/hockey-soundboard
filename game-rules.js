(function () {
  const dialog = document.getElementById('gameRulesDialog');
  const close = document.getElementById('closeGameRules');

  function closeDialog() {
    dialog.classList.add('hidden');
    document.querySelector('.side-menu-toggle').focus();
  }

  document.addEventListener('open-game-rules', () => {
    dialog.classList.remove('hidden');
    close.focus();
  });
  close.addEventListener('click', closeDialog);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      closeDialog();
    }
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
    } else if (event.key === 'Tab') {
      const focusable = dialog.querySelectorAll('button, a[href]');
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
})();
