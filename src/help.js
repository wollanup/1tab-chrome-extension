// i18n
[
    'helpTitle',
    'helpTitleBody',
    'helpIntro',
    'helpExactTitle',
    'helpExactDesc',
    'helpPathTitle',
    'helpPathDesc',
    'helpDomainTitle',
    'helpDomainDesc',
    'helpNote'
].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        const msg = chrome.i18n.getMessage(id);
        if (msg) {
            el.innerText = msg;
        }
    }
});

const i18nMap = [
    // Path table
    ['exampleLabel1', 'exampleLabel'],
    ['exampleLabel2', 'exampleLabel'],
    ['exampleLabel3', 'exampleLabel'],
    ['url1Label', 'url1Label'],
    ['url2Label', 'url2Label'],
    ['resultLabel', 'resultLabel'],
    ['resultPath1', 'resultDiff'],
    ['resultPath2', 'resultDiff'],
    ['resultPath3', 'resultDoublon'],
    // Exact table
    ['exampleLabel4', 'exampleLabel'],
    ['exampleLabel5', 'exampleLabel'],
    ['url1LabelExact', 'url1Label'],
    ['url2LabelExact', 'url2Label'],
    ['resultLabelExact', 'resultLabel'],
    ['resultExact1', 'resultDoublon'],
    ['resultExact2', 'resultDiff'],
    // Domain table
    ['exampleLabel6', 'exampleLabel'],
    ['exampleLabel7', 'exampleLabel'],
    ['exampleLabel8', 'exampleLabel'],
    ['url1LabelDomain', 'url1Label'],
    ['url2LabelDomain', 'url2Label'],
    ['resultLabelDomain', 'resultLabel'],
    ['resultDomain1', 'resultDoublon'],
    ['resultDomain2', 'resultDoublon'],
    ['resultDomain3', 'resultDiff']
];
i18nMap.forEach(([id, key], idx) => {
    const el = document.getElementById(id);
    if (el) {
        const msg = chrome.i18n.getMessage(key);
        if (msg) {
            if (el.classList.contains('badge')) {
                el.textContent = msg;
            } else {
                el.innerText = msg + (key === 'exampleLabel' ? ' ' + (idx % 3 + 1) : '');
            }
        }
    }
});
