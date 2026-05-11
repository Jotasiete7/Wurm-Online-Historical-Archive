import './style.css'
import { translations } from './translations'
import { supabase } from './lib/supabase'

// State
let currentLang = 'en';

// Mock Data for Coverage
const COVERAGE_DATA = {
  nfi: [
    { year: 2020, months: { 3: 100, 4: 100, 5: 100 } },
    { year: 2021, months: { 1: 100, 2: 100, 3: 100, 8: 100, 9: 100, 10: 100 } },
    { year: 2022, months: { 1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100, 7: 100, 8: 100, 9: 100 } },
    { year: 2023, months: { 10: 100, 11: 100, 12: 100 } },
    { year: 2024, months: { 1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100, 7: 100, 8: 100, 9: 100, 10: 80 } },
  ],
  sfi: [
    { year: 2020, months: { 12: 100 } },
    { year: 2021, months: { 6: 100, 7: 100 } },
    { year: 2022, months: { 1: 100, 2: 100, 3: 100, 4: 100 } },
    { year: 2023, months: { 1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100 } },
    { year: 2024, months: { 1: 100, 2: 100, 3: 100, 8: 100, 9: 100 } },
  ]
};

// Mock Archive Data
const ARCHIVE_BUNDLES = [
  { corpus: 'NFI', year: 2024, month: 10, files: 124, lines: '1.2M', size: '45MB' },
  { corpus: 'NFI', year: 2024, month: 9, files: 98, lines: '850K', size: '32MB' },
  { corpus: 'SFI', year: 2018, month: 3, files: 45, lines: '320K', size: '12MB' },
];

// Initialize UI
document.addEventListener('DOMContentLoaded', () => {
  setLanguage(currentLang);
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

function setupLanguageSwitcher() {
  const btns = document.querySelectorAll('.lang-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setLanguage(btn.dataset.lang);
    });
  });
}

function renderCoverage(corpus) {
  const container = document.getElementById('coverage-timeline');
  if (!container) return;

  container.innerHTML = '';
  
  const data = COVERAGE_DATA[corpus];
  
  data.forEach((yearData, yearIndex) => {
    const row = document.createElement('div');
    row.className = 'timeline-row';
    
    // Anno Label
    const label = document.createElement('div');
    label.className = 'year-label serif italic';
    label.style.fontSize = '1.2rem';
    label.style.opacity = '0.8';
    label.innerHTML = `Anno ${yearData.year}`;
    row.appendChild(label);

    // Month Grid (The 12-slot container)
    const bar = document.createElement('div');
    bar.className = 'coverage-bar month-grid';
    
    // Create 12 slots
    for (let m = 1; m <= 12; m++) {
      const slot = document.createElement('div');
      slot.className = 'month-slot';
      
      const coverage = yearData.months[m] || 0;
      if (coverage > 0) {
        const fragment = document.createElement('div');
        fragment.className = 'coverage-fragment';
        fragment.style.width = '0%';
        
        // Show month name on hover
        const monthName = new Date(2000, m - 1).toLocaleString(currentLang, { month: 'short' });
        fragment.setAttribute('data-month', monthName);
        
        slot.appendChild(fragment);
        
        // Animate fragment appearance
        setTimeout(() => {
          fragment.style.width = `${coverage}%`;
        }, 500 + (yearIndex * 150) + (m * 50));
      }
      
      bar.appendChild(slot);
    }
    
    row.appendChild(bar);
    container.appendChild(row);
  });
}

function renderArchive() {
  const container = document.getElementById('archive-browser');
  if (!container) return;

  const intro = container.querySelector('p');
  container.innerHTML = '';
  if (intro) container.appendChild(intro);

  const list = document.createElement('div');
  list.className = 'bundle-list';
  list.style.marginTop = '2rem';
  list.style.display = 'grid';
  list.style.gap = '1rem';

  ARCHIVE_BUNDLES.forEach(bundle => {
    const item = document.createElement('div');
    item.className = 'bundle-item';
    item.style.padding = '1.5rem';
    item.style.border = '1px solid var(--border-color)';
    item.style.background = 'var(--surface-color)';
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';
    item.style.borderRadius = '4px';

    const monthName = new Date(bundle.year, bundle.month - 1).toLocaleString(currentLang, { month: 'long' });
    const capitalizedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);

    item.innerHTML = `
      <div>
        <span class="accent serif" style="font-size: 0.7rem; letter-spacing: 0.2em; text-transform: uppercase;">Historical Corpus: ${bundle.corpus}</span>
        <h4 style="margin: 0.35rem 0; font-family: var(--font-serif); font-size: 1.4rem;">${capitalizedMonth} ${bundle.year}</h4>
        <p style="font-size: 0.8rem; color: var(--text-secondary); opacity: 0.8;">${bundle.files} fragments preserved — ${bundle.lines} entries — ${bundle.size}</p>
      </div>
      <button class="download-btn" style="color: var(--accent-color); font-size: 1.2rem; opacity: 0.6; transition: opacity 0.3s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">↓</button>
    `;

    list.appendChild(item);
  });

  container.appendChild(list);
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
    
    const processingMsg = translations[currentLang].upload_processing.replace('{count}', files.length);
    status.innerHTML = `<p class="accent">${processingMsg}</p>`;
    
    let successCount = 0;
    let errorCount = 0;

    for (const file of files) {
      try {
        const filePath = `${server}/${Date.now()}_${file.name}`;
        
        const { error } = await supabase.storage
          .from('logs-archive')
          .upload(filePath, file);

        if (error) throw error;

        // Record in database
        await supabase.from('logs').insert({
          filename: file.name,
          storage_path: filePath,
          contributor: contributor,
          server: server,
          size_bytes: file.size
        });

        successCount++;
      } catch (err) {
        console.error('Upload failed:', err);
        errorCount++;
      }
    }

    if (successCount > 0) {
      status.innerHTML = `<p style="color: var(--success-color)">${translations[currentLang].upload_success} (${successCount} files)</p>`;
    } else {
      status.innerHTML = `<p style="color: var(--error-color)">Upload failed. Please check if the 'logs-archive' bucket exists.</p>`;
    }
    
    setTimeout(() => {
      status.innerHTML = '';
    }, 5000);
  }
}
