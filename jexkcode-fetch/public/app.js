const API = '';
const els = {
  urlInput: document.getElementById('urlInput'),
  pasteBtn: document.getElementById('pasteBtn'),
  clearBtn: document.getElementById('clearBtn'),
  fetchBtn: document.getElementById('fetchBtn'),
  errorBox: document.getElementById('errorBox'),
  resultSection: document.getElementById('resultSection'),
  downloadSection: document.getElementById('downloadSection'),
  thumbImg: document.getElementById('thumbImg'),
  durationBadge: document.getElementById('durationBadge'),
  videoTitle: document.getElementById('videoTitle'),
  platformBadge: document.getElementById('platformBadge'),
  durationText: document.getElementById('durationText'),
  formatsGrid: document.getElementById('formatsGrid'),
  downloadsList: document.getElementById('downloadsList')
};

let currentAnalysis = null;
const activePolls = new Map();

function fmtDur(sec) {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}
function fmtBytes(b) {
  if (!b || b <= 0) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return b.toFixed(2) + ' ' + u[i];
}
function fmtSpeed(bps) {
  if (!bps || bps <= 0) return '0 B/s';
  return fmtBytes(bps) + '/s';
}

function showError(msg) {
  els.errorBox.textContent = msg;
  els.errorBox.classList.remove('hidden');
}
function hideError() {
  els.errorBox.classList.add('hidden');
  els.errorBox.textContent = '';
}

els.pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    els.urlInput.value = text;
  } catch (e) { els.urlInput.focus(); }
});
els.clearBtn.addEventListener('click', () => {
  els.urlInput.value = '';
  hideError();
  els.resultSection.classList.add('hidden');
});
els.fetchBtn.addEventListener('click', analyze);
els.urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') analyze(); });

async function analyze() {
  const url = els.urlInput.value.trim();
  if (!url) { showError('Please enter a video URL.'); return; }
  hideError();
  els.fetchBtn.disabled = true;
  els.fetchBtn.textContent = 'Analyzing...';
  els.resultSection.classList.add('hidden');

  try {
    const res = await fetch(API + '/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!data.supported) {
      showError(data.error || 'Unsupported URL or no formats found.');
      els.fetchBtn.disabled = false;
      els.fetchBtn.textContent = 'FETCH';
      return;
    }
    currentAnalysis = data;
    renderResult(data);
    els.resultSection.classList.remove('hidden');
  } catch (err) {
    showError('Network error. Is the server running?');
  } finally {
    els.fetchBtn.disabled = false;
    els.fetchBtn.textContent = 'FETCH';
  }
}

function renderResult(data) {
  els.videoTitle.textContent = data.title || 'Unknown Title';
  els.platformBadge.textContent = data.platform || 'unknown';
  els.durationText.textContent = data.duration ? fmtDur(data.duration) : '';
  els.thumbImg.src = data.thumbnail || '';
  els.thumbImg.style.display = data.thumbnail ? 'block' : 'none';
  els.durationBadge.textContent = data.duration ? fmtDur(data.duration) : '';
  els.durationBadge.style.display = data.duration ? 'inline-block' : 'none';

  els.formatsGrid.innerHTML = '';
  if (!data.formats || data.formats.length === 0) {
    els.formatsGrid.innerHTML = '<div style="color:var(--text-3);font-size:13px;">No formats available.</div>';
    return;
  }
  data.formats.forEach(fmt => {
    const card = document.createElement('div');
    card.className = 'format-card';
    card.innerHTML = `
      <div class="res">${resLabel}</div>
      <div class="ext">${label || ext.toUpperCase()}</div>
      <button class="dl-btn" data-fid="${formatId || ''}">Download</button>
    `;
    card.querySelector('.dl-btn').addEventListener('click', () => startDownload(fmt));
    els.formatsGrid.appendChild(card);
  });
}

async function startDownload(fmt) {
  if (!currentAnalysis) return;
  els.downloadSection.classList.remove('hidden');

  const payload = {
    url: fmt.url,
    formatId: fmt.formatId,
    title: currentAnalysis.title || 'video',
    ext: fmt.ext || 'mp4'
  };

  try {
    const res = await fetch(API + '/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.error) { showError(data.error); return; }
    createDownloadItem(data.id, payload.title, payload.ext, fmt.label, fmt.resolution, fmt.formatId);
    pollDownload(data.id);
  } catch (err) {
    showError('Failed to start download.');
  }
}

function createDownloadItem(id, title, ext, label, resolution, formatId) {
  const safe = title.replace(/[<>:"/\|?*\x00-\x1f]/g, '_').substring(0, 80);
  const name = safe + '.' + ext;
  const resLabel = resolution || (label || '').split(' ')[0] || 'Download';
  const div = document.createElement('div');
  div.className = 'dl-item';
  div.id = 'dl-' + id;
  div.innerHTML = `
    <div class="dl-header">
      <span class="dl-name">${name}</span>
      <span class="dl-status processing" id="st-${id}">Processing</span>
    </div>
    <div class="progress-track"><div class="progress-fill" id="bar-${id}"></div></div>
    <div class="dl-stats" id="stats-${id}">
      <span>Preparing download...</span>
    </div>
    <div class="dl-actions hidden" id="acts-${id}"></div>
  `;
  els.downloadsList.prepend(div);
}

function updateDownloadItem(id, info) {
  const st = document.getElementById('st-' + id);
  const bar = document.getElementById('bar-' + id);
  const stats = document.getElementById('stats-' + id);
  const acts = document.getElementById('acts-' + id);
  if (!st) return;

  st.textContent = info.status;
  st.className = 'dl-status ' + info.status;

  if (info.status === 'downloading') {
    if (info.total > 0) {
      const pct = Math.min(100, Math.round((info.downloaded / info.total) * 100));
      bar.style.width = pct + '%';
      bar.classList.remove('indeterminate');
      const eta = info.eta ? ' • ETA ' + info.eta + 's' : '';
      stats.innerHTML = `
        <span class="pct">${pct}%</span>
        <span>${fmtBytes(info.downloaded)} / ${fmtBytes(info.total)} • ${fmtSpeed(info.speed)}${eta}</span>
      `;
    } else {
      bar.classList.add('indeterminate');
      stats.innerHTML = `<span>${fmtBytes(info.downloaded)} downloaded • ${fmtSpeed(info.speed)}</span>`;
    }
  } else if (info.status === 'completed') {
    bar.style.width = '100%';
    bar.classList.remove('indeterminate');
    stats.innerHTML = `<span>${fmtBytes(info.downloaded)} • Completed</span>`;
    acts.classList.remove('hidden');
    acts.innerHTML = `<button class="file-btn" onclick="downloadFile('${id}')">Download File</button>`;
  } else if (info.status === 'failed') {
    bar.style.width = '0%';
    bar.classList.remove('indeterminate');
    stats.innerHTML = `<span style="color:var(--danger)">Failed: ${info.error || 'Unknown error'}</span>`;
    acts.classList.remove('hidden');
    acts.innerHTML = `<button class="retry-btn" onclick="retryDownload('${id}')">Retry</button>`;
  }
}

async function pollDownload(id) {
  if (activePolls.has(id)) clearInterval(activePolls.get(id));
  const iv = setInterval(async () => {
    try {
      const res = await fetch(API + '/api/download/' + id);
      const info = await res.json();
      if (info.error) {
        updateDownloadItem(id, { status: 'failed', error: info.error });
        clearInterval(iv);
        activePolls.delete(id);
        return;
      }
      updateDownloadItem(id, info);
      if (info.status === 'completed' || info.status === 'failed') {
        clearInterval(iv);
        activePolls.delete(id);
      }
    } catch (e) {}
  }, 800);
  activePolls.set(id, iv);
}

function downloadFile(id) {
  window.location.href = API + '/api/file/' + id;
}

function retryDownload(id) {
  const item = document.getElementById('dl-' + id);
  if (item) item.remove();
  // user must re-select format; no stored mapping kept client-side
  showError('Please re-select the format and try again.');
}
