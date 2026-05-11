import './style.css'
import { translations } from './translations'
import { supabase } from './lib/supabase'

// Data State
let currentLang = 'en';
let ARCHIVE_DATA = { NFI: [], SFI: [] };
let ARCHIVE_BUNDLES = [];
let SELECTED_MONTHS = new Set(); // Key: "YEAR-MONTH"

// Initialize UI
document.addEventListener('DOMContentLoaded', () => {
  const browserLang = navigator.language.startsWith('pt') ? 'pt' : 'en';
  currentLang = browserLang;
  
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === currentLang);
  });

  setLanguage(currentLang);
  setupUpload();
  setupControls();
  setupLanguageSwitcher();

  refreshArchivalState().then(() => {
    const activeCorpus = document.querySelector('.control-btn.active')?.dataset.corpus || 'nfi';
    renderCoverage(activeCorpus);
    renderArchive();
  }).catch(err => {
    console.error('Initial data fetch failed:', err);
    renderCoverage('nfi');
    renderArchive();
  });
});

async function refreshArchivalState() {
  await Promise.all([
    fetchCoverage(),
    fetchArchiveBundles()
  ]);
}

function setLanguage(lang) {
  currentLang = lang;
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[lang][key]) {
      el.innerHTML = translations[lang][key];
    }
  });
  const creditInput = document.getElementById('credit-input');
  if (creditInput) creditInput.placeholder = translations[lang].upload_credit_placeholder;
  document.documentElement.lang = lang;
}

function setupLanguageSwitcher() {
  const btns = document.querySelectorAll('.lang-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setLanguage(btn.dataset.lang);
      const activeCorpus = document.querySelector('.control-btn.active')?.dataset.corpus || 'nfi';
      renderCoverage(activeCorpus);
      renderArchive();
    });
  });
}

async function getSHA256(file) {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function parseLogMetadata(filename) {
  const parts = filename.split('.');
  if (parts.length >= 3) {
    const dateParts = parts[1].split('-');
    if (dateParts.length >= 2) {
      return { year: parseInt(dateParts[0]), month: parseInt(dateParts[1]) };
    }
  }
  return { year: null, month: null };
}

function scanTemporalCoverage(text) {
  const map = {};
  const lines = text.split('\n');
  let currentDay = null;
  lines.forEach(line => {
    const startMatch = line.match(/Logging started (\d{4}-\d{2}-\d{2})/);
    if (startMatch) {
      currentDay = startMatch[1];
      if (!map[currentDay]) map[currentDay] = new Set();
    }
    if (currentDay) {
      const timeMatch = line.match(/^\[(\d{2}):/);
      if (timeMatch) map[currentDay].add(parseInt(timeMatch[1]));
    }
  });
  const finalMap = {};
  Object.keys(map).forEach(day => { finalMap[day] = Array.from(map[day]).sort((a, b) => a - b); });
  return finalMap;
}

function renderCoverage(corpus) {
  const container = document.getElementById('coverage-timeline');
  if (!container) return;
  container.innerHTML = '';
  const corpusKey = corpus.toUpperCase();
  const data = ARCHIVE_DATA[corpusKey] || [];
  const totalDaysObserved = data.reduce((acc, year) => acc + Object.values(year.months).reduce((mAcc, month) => mAcc + Object.keys(month).length, 0), 0);
  const preservationMetric = document.getElementById('preservation-metric');
  if (preservationMetric) preservationMetric.innerHTML = `${totalDaysObserved} <span class="archival-meta">days recovered</span>`;
  if (data.length === 0) {
    container.innerHTML = `<div class="empty-archival-state"><p class="archival-text">${translations[currentLang].no_data}</p></div>`;
    return;
  }
  const sortedData = [...data].sort((a, b) => b.year - a.year);
  sortedData.forEach(yearData => {
    const yearRow = document.createElement('div');
    yearRow.className = 'year-row';
    yearRow.innerHTML = `<div class="year-label">Anno ${yearData.year}</div><div class="months-container">
        ${Array.from({ length: 12 }, (_, i) => {
          const mIdx = i + 1;
          const mData = yearData.months[mIdx] || {};
          const daysInMonth = new Date(yearData.year, mIdx, 0).getDate();
          return `<div class="month-block"><div class="month-label-small">${new Date(2000, i).toLocaleString(currentLang, { month: 'narrow' })}</div><div class="day-grid">
                ${Array.from({ length: 31 }, (_, d) => {
                  const dNum = d + 1;
                  const dKey = `${yearData.year}-${String(mIdx).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`;
                  const hrs = mData[dKey] || [];
                  const dens = hrs.length > 0 ? Math.min(100, 20 + (hrs.length * 15)) : 0;
                  if (dNum > daysInMonth) return '<div class="day-slot disabled"></div>';
                  return `<div class="day-slot ${dens > 0 ? 'active' : 'empty'}" style="opacity: ${dens > 0 ? dens / 100 : 1}" data-info="${dens > 0 ? `${dKey}: ${hrs.length} hours recovered` : `${dKey}: ${translations[currentLang].missing_call}`}"></div>`;
                }).join('')}
              </div></div>`;
        }).join('')}</div>`;
    container.appendChild(yearRow);
  });
}

async function fetchCoverage() {
  try {
    const { data, error } = await supabase.from('raw_logs').select('period_year, period_month, corpus, temporal_map');
    if (error) throw error;
    ARCHIVE_DATA = { NFI: [], SFI: [] };
    data.forEach(log => {
      if (!log.period_year || !log.period_month || !log.corpus) return;
      let corpusArr = ARCHIVE_DATA[log.corpus];
      if (!corpusArr) return;
      let yearEntry = corpusArr.find(y => y.year === log.period_year);
      if (!yearEntry) { yearEntry = { year: log.period_year, months: {} }; corpusArr.push(yearEntry); }
      if (!yearEntry.months[log.period_month]) yearEntry.months[log.period_month] = {};
      const map = log.temporal_map || {};
      Object.entries(map).forEach(([day, hours]) => {
        if (!yearEntry.months[log.period_month][day]) yearEntry.months[log.period_month][day] = [];
        yearEntry.months[log.period_month][day] = Array.from(new Set([...yearEntry.months[log.period_month][day], ...hours])).sort((a,b) => a-b);
      });
    });
  } catch (err) { console.error(err); }
}

function renderArchive() {
  const container = document.getElementById('archive-browser');
  if (!container) return;

  const corpus = document.querySelector('.control-btn.active').dataset.corpus;
  const corpusKey = corpus.toUpperCase();
  
  // Get unique years in bundles
  const years = Array.from(new Set(ARCHIVE_BUNDLES.filter(b => b.corpus === corpusKey).map(b => b.year))).sort((a, b) => b - a);

  container.innerHTML = `
    <div class="archive-header">
      <div class="header-main">
        <h3 class="serif">Temporal Selection</h3>
        <button id="bulk-restore-btn" class="download-btn" ${SELECTED_MONTHS.size === 0 ? 'disabled' : ''}>
          <span>${SELECTED_MONTHS.size === 0 ? translations[currentLang].restore_corpus : `Restore Selected (${SELECTED_MONTHS.size})`}</span>
        </button>
      </div>
      <p class="archival-text">Click on recovered months to build your restoration set, or use the year shortcuts.</p>
    </div>
    <div class="selection-grid">
      ${years.map(year => `
        <div class="selection-year-row">
          <div class="year-select-group">
            <div class="selection-year-label">${year}</div>
            <button class="year-select-btn" data-year="${year}">Select Year</button>
          </div>
          <div class="selection-months">
            ${Array.from({ length: 12 }, (_, i) => {
              const mIdx = i + 1;
              const bundle = ARCHIVE_BUNDLES.find(b => b.corpus === corpusKey && b.year === year && b.month === mIdx);
              const isSelected = SELECTED_MONTHS.has(`${year}-${mIdx}`);
              const hasData = !!bundle;
              
              return `
                <div class="month-pill ${hasData ? 'available' : 'unavailable'} ${isSelected ? 'selected' : ''}" 
                     data-year="${year}" data-month="${mIdx}"
                     ${!hasData ? 'title="No fragments recovered"' : `title="${bundle.coverage}% coverage"`}>
                  ${new Date(2000, i).toLocaleString(currentLang, { month: 'short' })}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // Setup Year Selection
  container.querySelectorAll('.year-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const year = parseInt(btn.dataset.year);
      const availableMonths = ARCHIVE_BUNDLES
        .filter(b => b.corpus === corpusKey && b.year === year)
        .map(b => `${year}-${b.month}`);
      
      const allSelected = availableMonths.every(k => SELECTED_MONTHS.has(k));
      
      if (allSelected) {
        availableMonths.forEach(k => SELECTED_MONTHS.delete(k));
      } else {
        availableMonths.forEach(k => SELECTED_MONTHS.add(k));
      }
      renderArchive();
    });
  });

  // Setup Month Selection
  container.querySelectorAll('.month-pill.available').forEach(pill => {
    pill.addEventListener('click', () => {
      const key = `${pill.dataset.year}-${pill.dataset.month}`;
      if (SELECTED_MONTHS.has(key)) SELECTED_MONTHS.delete(key);
      else SELECTED_MONTHS.add(key);
      renderArchive();
    });
  });

  // Setup Bulk Restore
  const bulkBtn = document.getElementById('bulk-restore-btn');
  if (bulkBtn) {
    bulkBtn.addEventListener('click', (e) => {
      handleBulkRestore(corpusKey, e);
    });
  }
}

async function handleBulkRestore(corpusKey, event) {
  const btn = event.currentTarget;
  const originalContent = btn.innerHTML;
  const t = translations[currentLang];
  
  try {
    btn.disabled = true;
    const selectedList = Array.from(SELECTED_MONTHS).map(k => {
      const [y, m] = k.split('-');
      return { year: parseInt(y), month: parseInt(m) };
    });

    const allLines = [];
    let processedMonths = 0;

    for (const item of selectedList) {
      btn.innerHTML = `<span>${t.downloading} ${++processedMonths}/${selectedList.length}</span>`;
      
      const { data: fragments, error } = await supabase
        .from('raw_logs')
        .select('storage_key')
        .eq('corpus', corpusKey)
        .eq('period_year', item.year)
        .eq('period_month', item.month);

      if (error) continue;

      for (const frag of fragments) {
        const { data, error: downloadError } = await supabase.storage.from('logs-archive').download(frag.storage_key);
        if (downloadError) continue;
        const text = await data.text();
        allLines.push(...text.split('\n'));
      }
    }

    btn.innerHTML = `<span>${t.merging}</span>`;
    const uniqueLines = Array.from(new Set(allLines)).sort();
    const restoredCorpus = uniqueLines.join('\n');
    const blob = new Blob([restoredCorpus], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    
    const filename = `WurmArchive_${corpusKey}_Restoration_${selectedList.length}m.txt`;
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);

    btn.innerHTML = `<span>${t.restored}</span>`;
    setTimeout(() => { 
      SELECTED_MONTHS.clear();
      renderArchive();
    }, 2000);

  } catch (err) {
    console.error(err);
    btn.innerHTML = originalContent;
    btn.disabled = false;
  }
}

async function fetchArchiveBundles() {
  try {
    const { data, error } = await supabase.from('raw_logs').select('period_year, period_month, corpus, byte_size, line_count, temporal_map');
    if (error) throw error;
    const bundlesMap = {};
    data.forEach(log => {
      if (!log.period_year || !log.period_month || !log.corpus) return;
      const key = `${log.corpus}-${log.period_year}-${log.period_month}`;
      if (!bundlesMap[key]) {
        bundlesMap[key] = { corpus: log.corpus, year: log.period_year, month: log.period_month, files: 0, lines: 0, bytes: 0, daysActive: new Set() };
      }
      bundlesMap[key].files++;
      bundlesMap[key].lines += (log.line_count || 0);
      bundlesMap[key].bytes += (log.byte_size || 0);
      if (log.temporal_map) Object.keys(log.temporal_map).forEach(day => bundlesMap[key].daysActive.add(day));
    });
    ARCHIVE_BUNDLES = Object.values(bundlesMap).map(b => {
      const daysInMonth = new Date(b.year, b.month, 0).getDate();
      const coverage = Math.min(100, Math.round((b.daysActive.size / daysInMonth) * 100));
      return { ...b, coverage, lines: formatNumber(b.lines), size: formatSize(b.bytes) };
    }).sort((a, b) => b.year - a.year || b.month - a.month);
  } catch (err) { console.error(err); }
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function setupControls() {
  const btns = document.querySelectorAll('.control-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      SELECTED_MONTHS.clear(); // Clear selection on corpus change
      renderCoverage(btn.dataset.corpus);
      renderArchive();
    });
  });
}

function setupUpload() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const status = document.getElementById('upload-status');
  const creditInput = document.getElementById('credit-input');
  const serverSelect = document.getElementById('server-select');
  if (!dropZone) return;
  dropZone.addEventListener('click', (e) => { if (!creditInput.contains(e.target) && !serverSelect.contains(e.target)) fileInput.click(); });
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('drag-over'); });
  dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); handleFiles(e.dataTransfer.files); });
  fileInput.addEventListener('change', (e) => { handleFiles(e.target.files); });
  async function handleFiles(files) {
    if (files.length === 0) return;
    const contributor = creditInput.value || 'Anonymous';
    const server = serverSelect.value;
    const corpusMap = { 'nfi': 'NFI', 'sfi': 'SFI', 'unknown': 'unknown' };
    status.innerHTML = `<p class="accent">Processing ${files.length} fragment(s)...</p>`;
    let successCount = 0;
    let daysRestored = new Set();
    for (const file of files) {
      try {
        const sha256 = await getSHA256(file);
        const { data: existing } = await supabase.from('raw_logs').select('id').eq('sha256', sha256).single();
        if (existing) continue;
        const { year, month } = parseLogMetadata(file.name);
        const text = await file.text();
        const temporalMap = scanTemporalCoverage(text);
        const lines = text.split('\n');
        const storageKey = `raw/${sha256}.txt`;
        await supabase.storage.from('logs-archive').upload(storageKey, file);
        await supabase.from('raw_logs').insert({
          sha256, filename: file.name, log_type: 'trade', corpus: corpusMap[server],
          contributor_alias: contributor, storage_key: storageKey,
          byte_size: file.size, line_count: lines.length,
          period_year: year, period_month: month, temporal_map: temporalMap,
          first_line_raw: lines[0]?.substring(0, 500), last_line_raw: lines[lines.length - 1]?.substring(0, 500)
        });
        Object.keys(temporalMap).forEach(day => daysRestored.add(day));
        successCount++;
      } catch (err) { console.error(err); }
    }
    if (successCount > 0) {
      status.innerHTML = `<p class="success">Recovered ${successCount} fragment(s).</p><p class="archival-meta small">${daysRestored.size} days restored.</p>`;
      setTimeout(async () => { status.innerHTML = ''; await refreshArchivalState(); renderCoverage(document.querySelector('.control-btn.active').dataset.corpus); renderArchive(); }, 5000);
    } else { status.innerHTML = `<p class="archival-meta">No new fragments identified.</p>`; }
  }
}
