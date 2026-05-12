import './style.css'
import { translations } from './translations'
import { supabase } from './lib/supabase'

// Data State
let currentLang = 'en';
let ARCHIVE_DATA = { NFI: [], SFI: [] };
let ARCHIVE_BUNDLES = [];
let SELECTED_MONTHS = new Set(); 

const NFI_PREFIXES = new Set(['Har', 'Mel', 'Cad', 'Def']);
const SFI_PREFIXES = new Set(['Ind', 'Del', 'Exo', 'Cel', 'Xan', 'Pri', 'Rel', 'Cha', 'Aff', 'Des', 'Ele', 'Ser']);

// Initialize UI
document.addEventListener('DOMContentLoaded', () => {
  const browserLang = navigator.language.startsWith('pt') ? 'pt' : 'en';
  currentLang = browserLang;
  document.querySelectorAll('.lang-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.lang === currentLang));
  setLanguage(currentLang);
  setupUpload();
  setupControls();
  setupLanguageSwitcher();
  refreshArchivalState().then(() => {
    const activeCorpus = document.querySelector('.control-btn.active')?.dataset.corpus || 'nfi';
    renderCoverage(activeCorpus);
    renderArchive();
    renderRecentDiscoveries();
  });
});

async function refreshArchivalState() {
  await Promise.all([fetchCoverage(), fetchArchiveBundles(), fetchRecentDiscoveries()]);
}

let RECENT_DISCOVERIES = [];

async function fetchRecentDiscoveries() {
  try {
    const { data, error } = await supabase
      .from('raw_logs')
      .select('contributor_alias, cluster, period_year, period_month, temporal_map, created_at')
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) throw error;
    RECENT_DISCOVERIES = data || [];
  } catch (err) { console.error(err); }
}

function renderRecentDiscoveries() {
  const container = document.getElementById('discoveries-list');
  if (!container) return;
  const t = translations[currentLang];

  if (RECENT_DISCOVERIES.length === 0) {
    container.innerHTML = `<p class="archival-meta">${t.no_data}</p>`;
    return;
  }

  container.innerHTML = RECENT_DISCOVERIES.map(disc => {
    const days = Object.keys(disc.temporal_map || {}).length;
    const date = new Date(disc.created_at).toLocaleDateString(currentLang, { day: '2-digit', month: 'short', year: 'numeric' });
    const user = disc.contributor_alias === 'Anonymous' ? t.discovery_anonymous : disc.contributor_alias;
    
    return `
      <div class="discovery-card">
        <div class="discovery-icon">📜</div>
        <div class="discovery-info">
          <div class="discovery-user">${user}</div>
          <div class="discovery-meta">
            ${t.discovery_recovered} <span class="accent">${days} ${t.discovery_days}</span> 
            ${t.discovery_from} <span class="archival-meta">${disc.cluster}</span>
          </div>
        </div>
        <div class="discovery-date">${date}</div>
      </div>
    `;
  }).join('');
}

function setLanguage(lang) {
  currentLang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[lang][key]) el.innerHTML = translations[lang][key];
  });
  if (document.getElementById('credit-input')) document.getElementById('credit-input').placeholder = translations[lang].upload_credit_placeholder;
  document.documentElement.lang = lang;
}

function setupLanguageSwitcher() {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setLanguage(btn.dataset.lang);
      renderCoverage(document.querySelector('.control-btn.active')?.dataset.corpus || 'nfi');
      renderArchive();
    });
  });
}

async function getSHA256(text) {
  const msgUint8 = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function parseLogMetadata(filename) {
  const parts = filename.split('.');
  if (parts.length >= 3) {
    const dateParts = parts[1].split('-');
    if (dateParts.length >= 2) return { year: parseInt(dateParts[0]), month: parseInt(dateParts[1]) };
  }
  return { year: null, month: null };
}

function scanTemporalCoverage(lines) {
  const map = {};
  let currentDay = null;
  lines.forEach(line => {
    const startMatch = line.match(/Logging started (\d{4}-\d{2}-\d{2})/);
    if (startMatch) { currentDay = startMatch[1]; if (!map[currentDay]) map[currentDay] = new Set(); }
    if (currentDay) {
      const timeMatch = line.match(/^\[(\d{2}):/);
      if (timeMatch) map[currentDay].add(parseInt(timeMatch[1]));
    }
  });
  const finalMap = {};
  Object.keys(map).forEach(day => { finalMap[day] = Array.from(map[day]).sort((a, b) => a - b); });
  return finalMap;
}

async function processLogSplitting(text) {
  const lines = text.split('\n');
  const fragments = { NFI: [], SFI: [] };
  const stats = { NFI: {}, SFI: {} };
  
  let currentDay = null;
  // More robust regex to handle various spacing and characters
  const prefixRegex = /<[^>]+>\s*\(([^)]+)\)/;
  const systemMsgRegex = /^\[\d{2}:\d{2}:\d{2}\] <System>/;

  lines.forEach(line => {
    const dayMatch = line.match(/Logging started (\d{4}-\d{2}-\d{2})/);
    if (dayMatch) { currentDay = dayMatch[1]; return; }
    if (!currentDay || !line.trim()) return;

    const match = line.match(prefixRegex);
    const isSystem = line.match(systemMsgRegex);

    if (match) {
      const prefix = match[1].substring(0, 3); // Take first 3 chars just in case (e.g. "Har")
      const cluster = NFI_PREFIXES.has(prefix) ? 'NFI' : (SFI_PREFIXES.has(prefix) ? 'SFI' : null);
      if (cluster) {
        const header = `Logging started ${currentDay}`;
        if (!fragments[cluster].includes(header)) fragments[cluster].push(header);
        fragments[cluster].push(line.trim());
        stats[cluster][prefix] = (stats[cluster][prefix] || 0) + 1;
      }
    } else if (isSystem) {
      ['NFI', 'SFI'].forEach(c => {
        const header = `Logging started ${currentDay}`;
        if (fragments[c].includes(header)) fragments[c].push(line.trim());
      });
    }
  });

  return Object.keys(fragments)
    .filter(c => fragments[c].length > 0)
    .map(c => ({ cluster: c, lines: fragments[c], stats: stats[c] }));
}

function renderCoverage(corpus) {
  const container = document.getElementById('coverage-timeline');
  if (!container) return;
  container.innerHTML = '';
  const corpusKey = corpus.toUpperCase();
  const data = ARCHIVE_DATA[corpusKey] || [];
  const totalDays = data.reduce((acc, y) => acc + Object.values(y.months).reduce((mAcc, m) => mAcc + Object.keys(m).length, 0), 0);
  if (document.getElementById('preservation-metric')) document.getElementById('preservation-metric').innerHTML = `${totalDays} <span class="archival-meta">days recovered</span>`;
  
  if (data.length === 0) {
    container.innerHTML = `<div class="empty-archival-state"><p class="archival-text">${translations[currentLang].no_data}</p></div>`;
    return;
  }

  [...data].sort((a, b) => b.year - a.year).forEach(yearData => {
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
    const { data, error } = await supabase.from('raw_logs').select('period_year, period_month, cluster, temporal_map');
    if (error) throw error;
    ARCHIVE_DATA = { NFI: [], SFI: [] };
    data.forEach(log => {
      if (!log.period_year || !log.period_month || !log.cluster) return;
      let corpusArr = ARCHIVE_DATA[log.cluster];
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
  const corpus = document.querySelector('.control-btn.active').dataset.corpus.toUpperCase();
  const years = Array.from(new Set(ARCHIVE_BUNDLES.filter(b => b.corpus === corpus).map(b => b.year))).sort((a, b) => b - a);

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
            <button class="year-select-btn" data-year="${year}">Select All</button>
          </div>
          <div class="selection-months">
            ${Array.from({ length: 12 }, (_, i) => {
              const mIdx = i + 1;
              const bundle = ARCHIVE_BUNDLES.find(b => b.corpus === corpus && b.year === year && b.month === mIdx);
              const isSelected = SELECTED_MONTHS.has(`${year}-${mIdx}`);
              return `<div class="month-pill ${bundle ? 'available' : 'unavailable'} ${isSelected ? 'selected' : ''}" 
                     data-year="${year}" data-month="${mIdx}" ${!bundle ? 'title="Missing"' : `title="${bundle.coverage}% coverage"`}>
                ${new Date(2000, i).toLocaleString(currentLang, { month: 'short' })}
              </div>`;
            }).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  container.querySelectorAll('.year-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const year = parseInt(btn.dataset.year);
      const available = ARCHIVE_BUNDLES.filter(b => b.corpus === corpus && b.year === year).map(b => `${year}-${b.month}`);
      if (available.every(k => SELECTED_MONTHS.has(k))) available.forEach(k => SELECTED_MONTHS.delete(k));
      else available.forEach(k => SELECTED_MONTHS.add(k));
      renderArchive();
    });
  });

  container.querySelectorAll('.month-pill.available').forEach(pill => {
    pill.addEventListener('click', () => {
      const key = `${pill.dataset.year}-${pill.dataset.month}`;
      if (SELECTED_MONTHS.has(key)) SELECTED_MONTHS.delete(key);
      else SELECTED_MONTHS.add(key);
      renderArchive();
    });
  });

  if (document.getElementById('bulk-restore-btn')) document.getElementById('bulk-restore-btn').addEventListener('click', (e) => handleBulkRestore(corpus, e));
}

async function handleBulkRestore(corpusKey, event) {
  const btn = event.currentTarget;
  const original = btn.innerHTML;
  const t = translations[currentLang];
  try {
    btn.disabled = true;
    const list = Array.from(SELECTED_MONTHS).map(k => { const [y, m] = k.split('-'); return { year: parseInt(y), month: parseInt(m) }; });
    const allLines = [];
    let count = 0;
    for (const item of list) {
      btn.innerHTML = `<span>${t.downloading} ${++count}/${list.length}</span>`;
      const { data: fragments } = await supabase.from('raw_logs').select('storage_key').eq('cluster', corpusKey).eq('period_year', item.year).eq('period_month', item.month);
      for (const frag of fragments || []) {
        const { data } = await supabase.storage.from('logs-archive').download(frag.storage_key);
        if (data) allLines.push(...(await data.text()).split('\n'));
      }
    }
    btn.innerHTML = `<span>${t.merging}</span>`;
    
    const dayGroups = {}; // { "2026-01-01": Set([lines...]) }
    let currentDay = null;

    allLines.forEach(line => {
      const dayMatch = line.match(/Logging started (\d{4}-\d{2}-\d{2})/);
      if (dayMatch) {
        currentDay = dayMatch[1];
        if (!dayGroups[currentDay]) dayGroups[currentDay] = new Set();
      } else if (currentDay && line.trim()) {
        dayGroups[currentDay].add(line.trim());
      }
    });

    const finalOutput = [];
    Object.keys(dayGroups).sort().forEach(day => {
      finalOutput.push(`Logging started ${day}`);
      const sortedLines = Array.from(dayGroups[day]).sort();
      finalOutput.push(...sortedLines);
      finalOutput.push(""); // Spacer between days
    });

    const blob = new Blob([finalOutput.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `WurmArchive_${corpusKey}_Restored_${list.length}m.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    btn.innerHTML = `<span>${t.restored}</span>`;
    setTimeout(() => { SELECTED_MONTHS.clear(); renderArchive(); }, 2000);
  } catch (err) { console.error(err); btn.innerHTML = original; btn.disabled = false; }
}

async function fetchArchiveBundles() {
  try {
    const { data, error } = await supabase.from('raw_logs').select('period_year, period_month, cluster, byte_size, line_count, temporal_map');
    if (error) throw error;
    const map = {};
    data.forEach(log => {
      if (!log.period_year || !log.period_month || !log.cluster) return;
      const key = `${log.cluster}-${log.period_year}-${log.period_month}`;
      if (!map[key]) map[key] = { corpus: log.cluster, year: log.period_year, month: log.period_month, files: 0, lines: 0, bytes: 0, daysActive: new Set() };
      map[key].files++; map[key].lines += (log.line_count || 0); map[key].bytes += (log.byte_size || 0);
      if (log.temporal_map) Object.keys(log.temporal_map).forEach(day => map[key].daysActive.add(day));
    });
    ARCHIVE_BUNDLES = Object.values(map).map(b => {
      const days = new Date(b.year, b.month, 0).getDate();
      return { ...b, coverage: Math.min(100, Math.round((b.daysActive.size / days) * 100)), size: formatSize(b.bytes) };
    }).sort((a, b) => b.year - a.year || b.month - a.month);
  } catch (err) { console.error(err); }
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function setupControls() {
  document.querySelectorAll('.control-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.control-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      SELECTED_MONTHS.clear();
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
  if (!dropZone) return;
  dropZone.addEventListener('click', (e) => { if (e.target.id !== 'credit-input') fileInput.click(); });
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); handleFiles(e.dataTransfer.files); });
  fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

  async function handleFiles(files) {
    if (files.length === 0) return;
    const contributor = creditInput.value || 'Anonymous';
    status.innerHTML = `<p class="accent">Archaeological Scanning...</p>`;
    let totalSuccess = 0;

    for (const file of files) {
      try {
        const originalText = await file.text();
        const sourceHash = await getSHA256(originalText);
        const { year, month } = parseLogMetadata(file.name);
        
        // 1. Process Split
        const fragments = await processLogSplitting(originalText);
        if (fragments.length === 0) continue;

        // 2. Upload Original (as source artifact)
        const originalKey = `source/${sourceHash}.txt`;
        const { error: storageError } = await supabase.storage.from('logs-archive').upload(originalKey, file);
        // Ignore error if original already exists

        // 3. Process Fragments
        for (const frag of fragments) {
          const fragText = frag.lines.join('\n');
          const fragHash = await getSHA256(fragText);
          
          // Check for duplicate fragment
          const { data: existing } = await supabase.from('raw_logs').select('id').eq('sha256', fragHash).single();
          if (existing) continue;

          const fragKey = `fragments/${fragHash}.txt`;
          await supabase.storage.from('logs-archive').upload(fragKey, new Blob([fragText], { type: 'text/plain' }));

          const temporalMap = scanTemporalCoverage(frag.lines);
          
          await supabase.from('raw_logs').insert({
            sha256: fragHash,
            filename: file.name,
            cluster: frag.cluster,
            contributor_alias: contributor,
            storage_key: fragKey,
            byte_size: fragText.length,
            line_count: frag.lines.length,
            period_year: year,
            period_month: month,
            temporal_map: temporalMap,
            detected_servers: frag.stats,
            source_sha256: sourceHash,
            first_line_raw: frag.lines[0]?.substring(0, 500),
            last_line_raw: frag.lines[frag.lines.length - 1]?.substring(0, 500)
          });
          totalSuccess++;
        }
      } catch (err) { console.error(err); }
    }

    if (totalSuccess > 0) {
      status.innerHTML = `<p class="success">✓ ${totalSuccess} fragments archived successfully.</p>`;
      setTimeout(async () => { 
        status.innerHTML = ''; 
        await refreshArchivalState(); 
        renderCoverage(document.querySelector('.control-btn.active').dataset.corpus); 
        renderArchive(); 
        renderRecentDiscoveries();
      }, 3000);
    } else {
      status.innerHTML = `<p class="archival-meta">No new fragments identified.</p>`;
    }
  }
}
