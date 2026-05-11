import './style.css'
import { translations } from './translations'
import { supabase } from './lib/supabase'

// Data State
let currentLang = 'en';
let ARCHIVE_DATA = { NFI: [], SFI: [] };

// Mock Archive Data (Used only if DB is empty or for layout testing)
let ARCHIVE_BUNDLES = [];

// Initialize UI
document.addEventListener('DOMContentLoaded', async () => {
  setLanguage(currentLang);
  await Promise.all([
    fetchCoverage(),
    fetchArchiveBundles()
  ]);
  renderCoverage('nfi');
  renderArchive();
  setupUpload();
  setupControls();
  setupLanguageSwitcher();
});

function setLanguage(lang) {
  currentLang = lang;
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[lang][key]) {
      el.innerHTML = translations[lang][key];
    }
  });

  // Handle placeholders
  const creditInput = document.getElementById('credit-input');
  if (creditInput) {
    creditInput.placeholder = translations[lang].upload_credit_placeholder;
  }

  // Update document title and lang
  document.documentElement.lang = lang;
}

// Language Switcher
function setupLanguageSwitcher() {
  const btns = document.querySelectorAll('.lang-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setLanguage(btn.dataset.lang);
      renderCoverage(document.querySelector('.control-btn.active').dataset.corpus);
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
    return {
      year: parseInt(dateParts[0]),
      month: parseInt(dateParts[1])
    };
  }
  return { year: null, month: null };
}

// Utility: Capture Timezone
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
  
  const data = COVERAGE_DATA[corpus];
  
  data.forEach((yearData, yearIndex) => {
    const row = document.createElement('div');
    row.className = 'timeline-row';
  const container = document.getElementById('coverage-list');
  container.innerHTML = '';

  const corpusKey = corpus.toUpperCase();
  const data = ARCHIVE_DATA[corpusKey] || [];

  if (data.length === 0) {
    container.innerHTML = `<div class="empty-archival-state">
      <p class="archival-text">${translations[currentLang].no_data || 'No fragments recovered for this corpus yet.'}</p>
    </div>`;
    return;
  }

  // Sort years descending
  const sortedData = [...data].sort((a, b) => b.year - a.year);

  sortedData.forEach(yearData => {
    const yearRow = document.createElement('div');
    yearRow.className = 'year-row';
    
    yearRow.innerHTML = `
      <div class="year-label">Anno ${yearData.year}</div>
      <div class="coverage-bar">
        ${Array.from({ length: 12 }, (_, i) => `<div class="month-slot" data-month-index="${i + 1}"></div>`).join('')}
      </div>
    `;

    const bar = yearRow.querySelector('.coverage-bar');
    
    Object.entries(yearData.months).forEach(([m, coverage]) => {
      const slot = bar.querySelector(`[data-month-index="${m}"]`);
      if (slot) {
        const fragment = document.createElement('div');
        fragment.className = 'coverage-fragment';
        fragment.style.width = '0%';
        
        // Show month name and density on hover
        const monthName = new Date(2000, m - 1).toLocaleString(currentLang, { month: 'short' });
        let densityLabel = 'Faint Trace';
        if (coverage > 40) densityLabel = 'Fragmented Record';
        if (coverage > 80) densityLabel = 'Dense Ledger';
        
        fragment.setAttribute('data-info', `${monthName} — ${densityLabel}`);
        
        // Adjust intensity based on coverage
        fragment.style.opacity = Math.max(0.2, coverage / 100);
        if (coverage < 40) fragment.style.filter = 'grayscale(0.5) contrast(0.8)';
        
        slot.appendChild(fragment);
        
        // Animate restoration
        setTimeout(() => {
          fragment.style.width = '100%';
        }, 100 + (m * 50));
      }
    });

    container.appendChild(yearRow);
  });
}

async function fetchCoverage() {
  try {
    const { data, error } = await supabase
      .from('raw_logs')
      .select('period_year, period_month, corpus, sha256');

    if (error) throw error;

    // Reset data
    ARCHIVE_DATA = { NFI: [], SFI: [] };

    // Aggregate by Year and Month
    data.forEach(log => {
      if (!log.period_year || !log.period_month || !log.corpus) return;
      if (log.corpus === 'unknown') return;

      let corpusArr = ARCHIVE_DATA[log.corpus];
      let yearEntry = corpusArr.find(y => y.year === log.period_year);
      
      if (!yearEntry) {
        yearEntry = { year: log.period_year, months: {} };
        corpusArr.push(yearEntry);
      }

      // In Phase 0, we treat the existence of any file as coverage.
      // For now, we set it to 100% if present, or we could count lines.
      // Let's assume 100% per month if we have any file for simplicity in Phase 0.
      yearEntry.months[log.period_month] = 100; 
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
    // Avoid triggering if clicking inputs
    if (e.target !== creditInput && e.target !== serverSelect) {
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
        // 1. Browser-side SHA-256 Hashing (Deduplication Layer)
        const sha256 = await getSHA256(file);
        
        // 2. Check for duplicate records in Supabase
        const { data: existing } = await supabase
          .from('raw_logs')
          .select('id')
          .eq('sha256', sha256)
          .single();

        if (existing) {
          duplicateCount++;
          continue;
        }

        // 3. Metadata Extraction
        const { year, month } = parseLogMetadata(file.name);
        const { timezone } = getBrowserMetadata();
        const text = await file.text();
        const lines = text.split('\n');
        
        // 4. Immutable Storage (Indexed by Hash)
        const storageKey = `raw/${sha256}.txt`;
        const { error: storageError } = await supabase.storage
          .from('logs-archive')
          .upload(storageKey, file);

        // Ignore 'Duplicate' error from storage if the file already exists physically
        if (storageError && storageError.message !== 'The resource already exists') throw storageError;

        // 5. Minimal Metadata Registration (Preservation Layer)
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

    // Feedback Loop
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
    
    setTimeout(() => {
      status.innerHTML = '';
      if (successCount > 0) fetchArchiveData();
    }, 6000);
  }
}

// Data Fetching (Phase 0)
async function fetchArchiveData() {
  const corpus = document.querySelector('.control-btn.active').dataset.corpus;
  const corpusValue = corpus.toUpperCase(); // 'NFI' or 'SFI'
  
  try {
    const { data, error } = await supabase
      .from('raw_logs')
      .select('period_year, period_month, sha256')
      .eq('corpus', corpusValue);

    if (error) throw error;
    
    console.log(`Fetched ${data.length} records for ${corpusValue}`);
  } catch (err) {
    console.error('Failed to fetch archival data:', err);
  }
}
