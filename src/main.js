import './style.css'
import { translations } from './translations'
import { supabase } from './lib/supabase'

// Data State
let currentLang = 'en';
let ARCHIVE_DATA = { NFI: [], SFI: [] };
let ARCHIVE_BUNDLES = [];

// Initialize UI
document.addEventListener('DOMContentLoaded', () => {
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
  if (creditInput) {
    creditInput.placeholder = translations[lang].upload_credit_placeholder;
  }

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

// Utility: Browser SHA-256
async function getSHA256(file) {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Utility: Parse Filename (Trade.YYYY-MM.txt)
function parseLogMetadata(filename) {
  const parts = filename.split('.');
  if (parts.length >= 3) {
    const dateParts = parts[1].split('-');
    if (dateParts.length >= 2) {
      return {
        year: parseInt(dateParts[0]),
        month: parseInt(dateParts[1])
      };
    }
  }
  return { year: null, month: null };
}

// Phase 1: Structural Temporal Scanner
function scanTemporalCoverage(text) {
  const map = {};
  const lines = text.split('\n');
  let currentDay = null;

  lines.forEach(line => {
    // Detect Temporal Anchor: Logging started YYYY-MM-DD
    const startMatch = line.match(/Logging started (\d{4}-\d{2}-\d{2})/);
    if (startMatch) {
      currentDay = startMatch[1];
      if (!map[currentDay]) map[currentDay] = new Set();
    }

    // Detect Timestamp: [HH:mm:ss]
    if (currentDay) {
      const timeMatch = line.match(/^\[(\d{2}):/);
      if (timeMatch) {
        map[currentDay].add(parseInt(timeMatch[1]));
      }
    }
  });

  // Convert Sets to Arrays for JSON storage
  const finalMap = {};
  Object.keys(map).forEach(day => {
    finalMap[day] = Array.from(map[day]).sort((a, b) => a - b);
  });

  return finalMap;
}

function getBrowserMetadata() {
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offset: new Date().getTimezoneOffset()
  };
}

function renderCoverage(corpus) {
  const container = document.getElementById('coverage-timeline');
  if (!container) return;
  container.innerHTML = '';

  const corpusKey = corpus.toUpperCase();
  const data = ARCHIVE_DATA[corpusKey] || [];

  if (data.length === 0) {
    container.innerHTML = `<div class="empty-archival-state">
      <p class="archival-text">${translations[currentLang].no_data || 'No fragments recovered for this corpus yet.'}</p>
    </div>`;
    return;
  }

  const sortedData = [...data].sort((a, b) => b.year - a.year);

  sortedData.forEach(yearData => {
    const yearRow = document.createElement('div');
    yearRow.className = 'year-row';
    
    yearRow.innerHTML = `
      <div class="year-label">Anno ${yearData.year}</div>
      <div class="months-container">
        ${Array.from({ length: 12 }, (_, i) => {
          const monthIndex = i + 1;
          const monthData = yearData.months[monthIndex] || {};
          return `
            <div class="month-block">
              <div class="month-label-small">${new Date(2000, i).toLocaleString(currentLang, { month: 'narrow' })}</div>
              <div class="day-grid">
                ${Array.from({ length: 31 }, (_, d) => {
                  const dayNum = d + 1;
                  const dayKey = `${yearData.year}-${String(monthIndex).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                  const hours = monthData[dayKey] || [];
                  const density = hours.length > 0 ? Math.min(100, hours.length * 20) : 0;
                  return `
                    <div class="day-slot ${density > 0 ? 'active' : ''}" 
                         style="opacity: ${density / 100}"
                         data-info="${dayKey}: ${hours.length} hours preserved">
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    container.appendChild(yearRow);
  });
}

async function fetchCoverage() {
  try {
    const { data, error } = await supabase
      .from('raw_logs')
      .select('period_year, period_month, corpus, temporal_map');

    if (error) throw error;

    ARCHIVE_DATA = { NFI: [], SFI: [] };

    data.forEach(log => {
      if (!log.period_year || !log.period_month || !log.corpus) return;
      if (log.corpus === 'unknown') return;

      let corpusArr = ARCHIVE_DATA[log.corpus];
      if (!corpusArr) return;

      let yearEntry = corpusArr.find(y => y.year === log.period_year);
      if (!yearEntry) {
        yearEntry = { year: log.period_year, months: {} };
        corpusArr.push(yearEntry);
      }

      if (!yearEntry.months[log.period_month]) {
        yearEntry.months[log.period_month] = {};
      }

      // Merge temporal maps
      const map = log.temporal_map || {};
      Object.entries(map).forEach(([day, hours]) => {
        if (!yearEntry.months[log.period_month][day]) {
          yearEntry.months[log.period_month][day] = [];
        }
        // Union of hours
        yearEntry.months[log.period_month][day] = Array.from(new Set([...yearEntry.months[log.period_month][day], ...hours])).sort((a,b) => a-b);
      });
    });

  } catch (err) {
    console.error('Archival fetch error:', err);
  }
}

function renderArchive() {
  const container = document.getElementById('archive-browser');
  if (!container) return;

  const corpus = document.querySelector('.control-btn.active').dataset.corpus;
  const corpusKey = corpus.toUpperCase();
  
  const filtered = ARCHIVE_BUNDLES.filter(b => b.corpus === corpusKey);

  container.innerHTML = `
    <p class="archival-text" data-i18n="archive_desc">Access the recovered monthly corpora from the institutional vault.</p>
    <div class="archive-grid" id="archive-grid"></div>
  `;

  const grid = container.querySelector('#archive-grid');
  
  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-archival-state">
      <p class="archival-text">The vault is currently empty for this corpus. Every contribution helps restore a piece of history.</p>
    </div>`;
    return;
  }

  filtered.forEach(bundle => {
    const card = document.createElement('div');
    card.className = 'archive-card';
    
    const monthName = new Date(2000, bundle.month - 1).toLocaleString(currentLang, { month: 'long' });
    
    card.innerHTML = `
      <div class="archive-info">
        <h3 class="serif">${monthName} ${bundle.year}</h3>
        <p class="archival-meta">${bundle.files} files · ${bundle.lines} lines · ${bundle.size}</p>
      </div>
      <button class="download-btn">
        <span data-i18n="download">Download</span>
      </button>
    `;
    
    card.querySelector('.download-btn').addEventListener('click', () => {
      handleDownload(bundle);
    });
    
    grid.appendChild(card);
  });
}

async function handleDownload(bundle) {
  console.log(`Accessing vault for: ${bundle.month}/${bundle.year} (${bundle.corpus})`);
  alert('In Phase 0, downloads are processed through the archival mirror. Direct download logic is being initialized.');
}

async function fetchArchiveBundles() {
  try {
    const { data, error } = await supabase
      .from('raw_logs')
      .select('period_year, period_month, corpus, byte_size, line_count');

    if (error) throw error;

    const bundlesMap = {};

    data.forEach(log => {
      if (!log.period_year || !log.period_month || !log.corpus) return;
      
      const key = `${log.corpus}-${log.period_year}-${log.period_month}`;
      if (!bundlesMap[key]) {
        bundlesMap[key] = {
          corpus: log.corpus,
          year: log.period_year,
          month: log.period_month,
          files: 0,
          lines: 0,
          bytes: 0
        };
      }
      
      bundlesMap[key].files++;
      bundlesMap[key].lines += (log.line_count || 0);
      bundlesMap[key].bytes += (log.byte_size || 0);
    });

    ARCHIVE_BUNDLES = Object.values(bundlesMap).map(b => ({
      ...b,
      lines: formatNumber(b.lines),
      size: formatSize(b.bytes)
    })).sort((a, b) => b.year - a.year || b.month - a.month);

  } catch (err) {
    console.error('Failed to fetch archive bundles:', err);
  }
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

  dropZone.addEventListener('click', (e) => {
    if (!creditInput.contains(e.target) && !serverSelect.contains(e.target)) {
      fileInput.click();
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
  });

  async function handleFiles(files) {
    if (files.length === 0) return;
    
    const contributor = creditInput.value || 'Anonymous';
    const server = serverSelect.value;
    const corpusMap = {
      'nfi': 'NFI',
      'sfi': 'SFI',
      'unknown': 'unknown'
    };

    const processingMsg = translations[currentLang].upload_processing.replace('{count}', files.length);
    status.innerHTML = `<p class="accent">${processingMsg}</p>`;
    
    let successCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;

    for (const file of files) {
      try {
        const sha256 = await getSHA256(file);
        
        const { data: existing } = await supabase
          .from('raw_logs')
          .select('id')
          .eq('sha256', sha256)
          .single();

        if (existing) {
          duplicateCount++;
          continue;
        }

        const { year, month } = parseLogMetadata(file.name);
        const { timezone } = getBrowserMetadata();
        const text = await file.text();
        
        // Phase 1: Structural Scan
        const temporalMap = scanTemporalCoverage(text);
        const lines = text.split('\n');
        
        const storageKey = `raw/${sha256}.txt`;
        const { error: storageError } = await supabase.storage
          .from('logs-archive')
          .upload(storageKey, file);

        if (storageError && storageError.message !== 'The resource already exists') throw storageError;

        const { error: dbError } = await supabase.from('raw_logs').insert({
          sha256: sha256,
          filename: file.name,
          log_type: 'trade',
          corpus: corpusMap[server],
          contributor_alias: contributor,
          browser_timezone: timezone,
          storage_key: storageKey,
          byte_size: file.size,
          line_count: lines.length,
          period_year: year,
          period_month: month,
          temporal_map: temporalMap,
          first_line_raw: lines[0]?.substring(0, 500),
          last_line_raw: lines[lines.length - 1]?.substring(0, 500)
        });

        if (dbError) throw dbError;
        successCount++;
      } catch (err) {
        console.error('Archival failed:', err);
        errorCount++;
      }
    }

    let resultMsg = '';
    if (successCount > 0) {
      resultMsg += `<p style="color: var(--success-color)">${translations[currentLang].upload_success} (${successCount} fragments preserved)</p>`;
    }
    if (duplicateCount > 0) {
      resultMsg += `<p style="color: var(--accent-color); font-size: 0.8rem; opacity: 0.7;">${duplicateCount} fragments were already in the vault.</p>`;
    }
    if (errorCount > 0) {
      resultMsg += `<p style="color: var(--error-color)">${errorCount} fragments encountered an issue during preservation.</p>`;
    }
    
    status.innerHTML = resultMsg;
    
    setTimeout(async () => {
      status.innerHTML = '';
      if (successCount > 0) {
        await refreshArchivalState();
        const activeCorpus = document.querySelector('.control-btn.active')?.dataset.corpus || 'nfi';
        renderCoverage(activeCorpus);
        renderArchive();
      }
    }, 4000);
  }
}
