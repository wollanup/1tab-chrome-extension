// -----------------------
// i18n
document.querySelectorAll('[id]').forEach(el => {
  const msg = chrome.i18n.getMessage(el.id);
  if (msg) {
    if (el.tagName === "INPUT" || el.tagName === "OPTION" || el.tagName === "BUTTON") {
      el.textContent = msg;
    } else {
      el.innerText = msg;
    }
  }
});

// -----------------------
// constantes
const DEFAULTS = { matchMode: 'exact'};

// -----------------------
// éléments DOM
const modeSelect = document.getElementById('mode');
const saveBtn = document.getElementById('save');


// -----------------------
// récupération des valeurs stockées au chargement
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get({ matchMode: DEFAULTS.matchMode }, (opts) => {
    modeSelect.value = opts.matchMode || DEFAULTS.matchMode;
  });
});

// -----------------------
// sauvegarde
modeSelect.addEventListener('change', () => {
  const mode = modeSelect.value;  
  chrome.storage.local.set({ matchMode: mode });
});
