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

// --- Stats gauge ---
function updateGauge(dupes, total) {
  const percent = total > 0 ? Math.round(dupes / total * 100) : 0;
  document.getElementById('dupesPercent').textContent = percent + '%';
  document.getElementById('totalTabs').textContent = chrome.i18n.getMessage('totalTabsLabel', [String(total)]);

  // Gauge animation
  const circle = document.querySelector('.gauge-fg');
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  circle.setAttribute('stroke', '#0d6efd');
  circle.setAttribute('stroke-dasharray', circumference);
  circle.setAttribute('stroke-dashoffset', circumference * (1 - percent / 100));
  circle.setAttribute('stroke-linecap', 'round');

  // Plural rules (generic)
  const lang = chrome.i18n.getUILanguage();
  const pluralCategory = new Intl.PluralRules(lang).select(dupes); // e.g. 'one', 'other', 'few', etc.
  const labelKey = 'dupesLabel_' + pluralCategory;
  const labelTemplate = chrome.i18n.getMessage(labelKey, [String(dupes)]);
  document.getElementById('dupesLabel').textContent = labelTemplate;
}

// On popup load, request stats from background
chrome.runtime.sendMessage({ type: 'getStats' }, (res) => {
  if (res) {
    updateGauge(res.duplicateTabsPrevented || 0, res.totalTabsOpened || 0);
  }
});
