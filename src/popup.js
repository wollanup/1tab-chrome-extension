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
let paused = false;
const pauseBtn = document.getElementById('pauseBtn');
const pauseIcon = document.getElementById('pauseIcon');
const pauseLabel = document.getElementById('pauseLabel');


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
  document.getElementById('dupesLabel').textContent = chrome.i18n.getMessage(labelKey, [String(dupes)]);
}

// On popup load, request stats from background
chrome.runtime.sendMessage({ type: 'getStats' }, (res) => {
  if (res) {
    updateGauge(res.duplicateTabsPrevented || 0, res.totalTabsOpened || 0);
  }
});

// SVG icons
const svgPause = '<svg width="20" height="20" viewBox="0 0 20 20"><rect x="4" y="4" width="4" height="12" rx="1.5" fill="currentColor"/><rect x="12" y="4" width="4" height="12" rx="1.5" fill="currentColor"/></svg>';
const svgPlay = '<svg width="20" height="20" viewBox="0 0 20 20"><polygon points="6,4 16,10 6,16" fill="currentColor"/></svg>';

function setGaugePaused(paused) {
  const gauge = document.querySelector('.gauge');
  const statsContainer = document.getElementById('statsContainer');
  if (paused) {
    gauge.classList.add('paused');
    statsContainer.classList.add('paused');
  } else {
    gauge.classList.remove('paused');
    statsContainer.classList.remove('paused');
  }
}

function updatePauseButton() {
  setGaugePaused(paused);
  const pausedLabel = document.getElementById('pausedLabel');
  if (paused) {
    pauseIcon.innerHTML = svgPlay;
    pauseLabel.textContent = chrome.i18n.getMessage('resume');
    pauseBtn.classList.add('btn-outline-success');
    pauseBtn.classList.remove('btn-outline-warning');
    pausedLabel.textContent = chrome.i18n.getMessage('paused');
    pausedLabel.style.display = '';
  } else {
    pauseIcon.innerHTML = svgPause;
    pauseLabel.textContent = chrome.i18n.getMessage('pause');
    pauseBtn.classList.remove('btn-outline-success');
    pauseBtn.classList.add('btn-outline-warning');
    pausedLabel.textContent = '';
    pausedLabel.style.display = 'none';
  }
}

pauseBtn.addEventListener('click', () => {
  paused = !paused;
  updatePauseButton();
  chrome.runtime.sendMessage({ type: 'setPaused', paused });
});

document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.sendMessage({ type: 'getPaused' }, (res) => {
    paused = !!(res?.paused);
    updatePauseButton();
  });
});
