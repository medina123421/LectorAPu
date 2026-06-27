// =============================================
// CONFIG
// =============================================
const VALUE_THRESHOLD   = 5;       // Edge mínimo en puntos para considerar "error de momio"
const AUTO_REFRESH_MS   = 120000;  // Re-chequear cada 2 minutos
const GAME_DURATION_MIN = 8;       // Duración estimada de un e-basketball en minutos

const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const proxy = url => isLocal
  ? 'https://corsproxy.io/?' + encodeURIComponent(url)
  : '/api-proxy/' + url.replace('https://api-h2h.hudstats.com/', '');

const API_LIVE     = 'https://api-h2h.hudstats.com/v1/live/nba';
const API_UPCOMING = 'https://api-h2h.hudstats.com/v1/schedule/upcoming/nba';
const API_H2H      = id => `https://api-h2h.hudstats.com/v1/h2h/nba?external_id=${id}`;

// =============================================
// ESTADO GLOBAL
// =============================================
let currentTab = 'upcoming';
let allMatches = { live: [], upcoming: [] };
let statsCache = {};         // externalId → { avgA, avgB, formA, formB }
let alertedMatches = new Set(JSON.parse(localStorage.getItem('alerted') || '[]'));
let refreshTimer = null;
let countdownInterval = null;
let secondsLeft = AUTO_REFRESH_MS / 1000;

// =============================================
// MÓDULO 2: ALMACÉN DE LÍNEAS (O/U)
// =============================================
const linesStore = {
  _key: 'edgedetector_lines_v2',
  get: id => { const d = JSON.parse(localStorage.getItem('edgedetector_lines_v2') || '{}'); return d[id] ?? null; },
  save: (id, val) => { const d = JSON.parse(localStorage.getItem('edgedetector_lines_v2') || '{}'); d[id] = parseFloat(val); localStorage.setItem('edgedetector_lines_v2', JSON.stringify(d)); }
};

// =============================================
// MÓDULO 3: PROYECCIÓN AUTOMÁTICA PRE-PARTIDO
// Usando promedios históricos de cada jugador
// =============================================
function calcAutoProjection(avgA, avgB) {
  if (!avgA || !avgB) return null;
  return Math.round((avgA + avgB) * 10) / 10;
}

// Proyección en vivo (por ritmo del partido)
function calcLiveProjection(match) {
  const { teamAScore, teamBScore, startDate, status } = match;
  if (status !== 'live') return null;
  const total = (teamAScore ?? 0) + (teamBScore ?? 0);
  if (total === 0) return null;
  const mins = Math.min(Math.max((new Date() - new Date(startDate)) / 60000, 1), GAME_DURATION_MIN);
  return Math.round((total / mins * GAME_DURATION_MIN) * 10) / 10;
}

// =============================================
// MÓDULO 4: EDGE
// =============================================
function calcEdge(projection, line) {
  if (projection === null || line === null) return null;
  return Math.round((projection - line) * 10) / 10;
}

// =============================================
// NOTIFICACIONES
// =============================================
function requestNotifications() {
  if (!('Notification' in window)) return;
  Notification.requestPermission().then(perm => {
    updateNotifBtn(perm === 'granted');
    hideBanner();
  });
}

function updateNotifBtn(granted) {
  const btn = document.getElementById('notif-btn');
  if (granted) { btn.classList.add('active'); btn.title = 'Alertas activadas'; }
  else { btn.classList.remove('active'); btn.title = 'Activar alertas'; }
}

function hideBanner() { document.getElementById('notif-banner').classList.add('hidden'); }

function fireNotification(match, edge, pick) {
  const id = match.externalId;
  if (alertedMatches.has(id)) return;
  alertedMatches.add(id);
  localStorage.setItem('alerted', JSON.stringify([...alertedMatches]));

  const title = '🚨 Error de Momio Detectado';
  const body = `${match.participantAName} vs ${match.participantBName}\n${pick} | Edge: ${edge > 0 ? '+' : ''}${edge} pts\n${match.streamName} — ${formatTime(match.startDate)}`;

  // Notificación del browser
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/favicon.ico', badge: '/favicon.ico', vibrate: [200, 100, 200] });
  }

  // Log de alertas en pantalla
  addAlertToLog(match, edge, pick);
}

function addAlertToLog(match, edge, pick) {
  const log = document.getElementById('alert-log');
  const body = document.getElementById('alert-log-body');
  log.classList.remove('hidden');

  const item = document.createElement('div');
  item.className = 'alert-item';
  item.innerHTML = `
    <span>🚨 <strong>${match.participantAName} vs ${match.participantBName}</strong> — ${pick} | Edge <strong>${edge > 0 ? '+' : ''}${edge}</strong></span>
    <span class="alert-time">${formatTime(new Date().toISOString())}</span>
  `;
  body.insertBefore(item, body.firstChild);
}

// =============================================
// MÓDULO 1: FETCH DE PARTIDOS Y STATS
// =============================================
async function fetchAll() {
  const [liveData, upcomingData] = await Promise.all([
    fetch(proxy(API_LIVE)).then(r => r.json()),
    fetch(proxy(API_UPCOMING)).then(r => r.json())
  ]);

  const live     = Array.isArray(liveData)     ? liveData     : [];
  const upcoming = Array.isArray(upcomingData) ? upcomingData : [];

  // Combinar para stats fetch — priorizar partidos próximos + en vivo
  const allIds = [...live, ...upcoming].map(m => m.externalId);
  const toFetch = allIds.filter(id => !statsCache[id]);

  // Fetch stats en paralelo (máx 8 a la vez para no sobrecargar)
  const chunks = [];
  for (let i = 0; i < toFetch.length; i += 8) chunks.push(toFetch.slice(i, i + 8));

  for (const chunk of chunks) {
    await Promise.all(chunk.map(async id => {
      try {
        const data = await fetch(proxy(API_H2H(id))).then(r => r.json());
        const sA = data.participantAStats;
        const sB = data.participantBStats;
        statsCache[id] = {
          avgA: sA?.avgPoints ?? null,
          avgB: sB?.avgPoints ?? null,
          formA: sA?.matchForm?.slice(0, 5) ?? [],
          formB: sB?.matchForm?.slice(0, 5) ?? [],
          matchesA: sA?.matchesPlayed ?? 0,
          matchesB: sB?.matchesPlayed ?? 0,
          winPctA: sA?.matchesWinPct ?? null,
          winPctB: sB?.matchesWinPct ?? null,
        };
      } catch { statsCache[id] = null; }
    }));
  }

  return { live, upcoming };
}

// =============================================
// UI: RENDER TARJETA
// =============================================
function renderCard(match, isLive = false) {
  const { externalId, streamName, status, teamAName, teamBName,
          participantAName, participantBName, startDate,
          teamAScore, teamBScore } = match;

  const stats = statsCache[externalId];
  const avgA = stats?.avgA ?? null;
  const avgB = stats?.avgB ?? null;
  const formA = stats?.formA ?? [];
  const formB = stats?.formB ?? [];

  // Proyección: en vivo usa ritmo actual, pre-partido usa histórico
  const projection = isLive
    ? calcLiveProjection(match)
    : calcAutoProjection(avgA, avgB);

  const savedLine = linesStore.get(externalId);
  const edge = calcEdge(projection, savedLine);
  const hasValue = edge !== null && Math.abs(edge) >= VALUE_THRESHOLD;
  const isOver = edge !== null && edge > 0;

  // Auto-notificar si hay valor y el partido es próximo o en vivo
  if (hasValue && savedLine !== null) {
    fireNotification(match, edge, isOver ? `▲ OVER ${savedLine}` : `▼ UNDER ${savedLine}`);
  }

  // Clases de la tarjeta
  let cardClass = 'match-card';
  if (hasValue && savedLine !== null) cardClass += isOver ? ' has-over-value' : ' has-under-value';

  // Minutos para el partido
  const minsUntil = Math.round((new Date(startDate) - new Date()) / 60000);
  const badgeText = isLive
    ? '🔴 LIVE'
    : minsUntil <= 15 && minsUntil >= 0
      ? `⏰ ${minsUntil}m`
      : formatTime(startDate);
  const badgeClass = isLive ? 'live' : minsUntil <= 15 && minsUntil >= 0 ? 'soon' : 'scheduled';

  // Edge visuals
  const edgeClass = edge === null ? 'muted' : edge > 0 ? 'edge-pos' : 'edge-neg';
  const edgeText = edge === null ? '—' : `${edge > 0 ? '+' : ''}${edge}`;

  // Pick
  let pickMainText = '—', pickMainClass = 'neutral', pickSubText = 'Ingresa la línea de tu casa de apuestas';
  if (savedLine !== null && projection !== null) {
    pickMainText = isOver ? `▲ OVER ${savedLine}` : `▼ UNDER ${savedLine}`;
    pickMainClass = isOver ? 'over' : 'under';
    pickSubText = `Proyección ${projection} | Edge ${edgeText} pts`;
  } else if (projection !== null) {
    pickSubText = `Proyección auto: ${projection} pts — Ingresa la línea`;
  }

  // Pick box class
  let pickBoxClass = 'pick-box';
  if (savedLine !== null && projection !== null) {
    if (hasValue) pickBoxClass += isOver ? ' pick-value-over' : ' pick-value-under';
    else pickBoxClass += isOver ? ' pick-over' : ' pick-under';
  }

  // Value pill
  let pillHtml = '';
  if (savedLine === null) {
    pillHtml = `<span class="value-pill waiting">Sin línea</span>`;
  } else if (!hasValue) {
    pillHtml = `<span class="value-pill ok">✓ Línea OK</span>`;
  } else {
    const emoji = isOver ? '📈' : '📉';
    pillHtml = `<span class="value-pill ${isOver ? 'detected-over' : 'detected-under'}">${emoji} Error detectado</span>`;
  }

  // Forma
  const renderForm = (form, label) => form.length === 0 ? '' : `
    <div class="form-bar">
      <span class="form-label">${label}</span>
      ${form.map(r => `<span class="form-dot ${r}">${r}</span>`).join('')}
    </div>
  `;

  const card = document.createElement('div');
  card.className = cardClass;
  card.dataset.id = externalId;

  card.innerHTML = `
    <div class="card-stripe"></div>
    <div class="card-header">
      <span class="stream-name">${streamName}</span>
      <div class="card-header-right">
        <span class="start-time">${isLive ? '' : formatDate(startDate)}</span>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
    </div>

    <div class="card-body">
      <!-- EQUIPOS -->
      <div class="teams-section">
        <div class="team-block left">
          <span class="player-name">${participantAName}</span>
          <span class="team-name-sm">${teamAName}</span>
          ${avgA !== null ? `<span class="avg-pts">~${avgA} pts/partido</span>` : ''}
          ${renderForm(formA, 'Forma')}
        </div>

        <div class="vs-center">
          ${isLive && teamAScore !== null
            ? `<span class="score-live">${teamAScore} - ${teamBScore}</span>`
            : `<span class="vs-text">VS</span><span class="vs-time">${formatTime(startDate)}</span>`
          }
        </div>

        <div class="team-block right">
          <span class="player-name">${participantBName}</span>
          <span class="team-name-sm">${teamBName}</span>
          ${avgB !== null ? `<span class="avg-pts">~${avgB} pts/partido</span>` : ''}
          ${renderForm(formB, '')}
        </div>
      </div>

      <!-- ANÁLISIS -->
      <div class="analysis-grid">
        <div class="analysis-box">
          <div class="abox-label"><span class="abox-num">3</span> Proyección Auto</div>
          <div class="abox-value proj">${projection !== null ? `${projection} pts` : '—'}</div>
        </div>
        <div class="analysis-box">
          <div class="abox-label"><span class="abox-num">4</span> Edge</div>
          <div class="abox-value ${edgeClass}">${edgeText}${edge !== null ? ' pts' : ''}</div>
        </div>
      </div>

      <!-- LÍNEA O/U -->
      <div class="line-row">
        <input
          type="number"
          class="line-input"
          id="line-${externalId}"
          placeholder="Línea O/U (ej. 168.5)"
          value="${savedLine !== null ? savedLine : ''}"
          step="0.5" min="50"
        />
        <button class="calc-btn" data-id="${externalId}">Analizar</button>
      </div>

      <!-- PICK & ESTADO -->
      <div class="${pickBoxClass}">
        <div class="pick-left">
          <span class="pick-main ${pickMainClass}">${pickMainText}</span>
          <span class="pick-sub">${pickSubText}</span>
        </div>
        ${pillHtml}
      </div>

    </div>
  `;

  // Evento Analizar
  const btn = card.querySelector('.calc-btn');
  const input = card.querySelector(`#line-${externalId}`);

  const doCalc = () => {
    const val = parseFloat(input.value);
    if (isNaN(val) || val <= 0) {
      input.style.borderColor = 'var(--danger)';
      setTimeout(() => input.style.borderColor = '', 1200);
      return;
    }
    linesStore.save(externalId, val);
    // Resetear el alerted para que pueda re-notificar si hay valor
    alertedMatches.delete(externalId);
    localStorage.setItem('alerted', JSON.stringify([...alertedMatches]));
    const newCard = renderCard(match, isLive);
    card.replaceWith(newCard);
    updateStats();
  };

  btn.addEventListener('click', doCalc);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doCalc(); });

  return card;
}

// =============================================
// UI: STATS BAR
// =============================================
function updateStats() {
  const live = allMatches.live;
  const upcoming = allMatches.upcoming;
  const all = [...live, ...upcoming];

  const withValue = all.filter(m => {
    const s = statsCache[m.externalId];
    const proj = m.status === 'live'
      ? calcLiveProjection(m)
      : calcAutoProjection(s?.avgA, s?.avgB);
    const line = linesStore.get(m.externalId);
    const edge = calcEdge(proj, line);
    return edge !== null && Math.abs(edge) >= VALUE_THRESHOLD;
  });

  document.getElementById('stat-total').textContent = upcoming.length;
  document.getElementById('stat-live').textContent   = live.length;
  document.getElementById('stat-value').textContent  = withValue.length;
  document.getElementById('stat-checked').textContent = all.filter(m => linesStore.get(m.externalId) !== null).length;
}

// =============================================
// UI: RENDERIZAR TAB ACTUAL
// =============================================
function renderCurrentTab() {
  const container = document.getElementById('matches-container');
  const matches = currentTab === 'live' ? allMatches.live : allMatches.upcoming;
  const isLive = currentTab === 'live';

  container.innerHTML = '';

  if (matches.length === 0) {
    container.innerHTML = `<div class="empty-state">No hay partidos ${isLive ? 'en vivo' : 'próximos'} en este momento.</div>`;
    return;
  }

  matches.forEach(m => container.appendChild(renderCard(m, isLive)));
  updateStats();
}

// =============================================
// MAIN FETCH LOOP
// =============================================
async function refresh() {
  const statusText = document.getElementById('status-text');
  const dot        = document.getElementById('status-dot');
  const refreshBtn = document.getElementById('refresh-btn');

  refreshBtn.classList.add('spinning');
  statusText.textContent = 'Actualizando...';

  try {
    const { live, upcoming } = await fetchAll();
    allMatches.live     = live;
    allMatches.upcoming = upcoming;

    renderCurrentTab();

    dot.className = 'dot pulse';
    statusText.textContent = `Actualizado ${formatTime(new Date().toISOString())}`;
    startCountdown();

  } catch (err) {
    console.error(err);
    dot.className = 'dot error';
    statusText.textContent = 'Error de conexión';
    document.getElementById('matches-container').innerHTML = `
      <div class="error-card">
        No se pudo conectar con la API.<br><br>
        ${err.message}<br><br>
        ${isLocal ? 'Activa la extensión CORS Unblocker en tu navegador o sube la app a Netlify.' : 'Intenta de nuevo en un momento.'}
      </div>
    `;
  } finally {
    refreshBtn.classList.remove('spinning');
  }
}

// =============================================
// COUNTDOWN
// =============================================
function startCountdown() {
  clearInterval(countdownInterval);
  secondsLeft = AUTO_REFRESH_MS / 1000;
  const el = document.getElementById('next-refresh');
  countdownInterval = setInterval(() => {
    secondsLeft--;
    if (secondsLeft <= 0) {
      clearInterval(countdownInterval);
      el.textContent = '';
      refresh();
    } else {
      el.textContent = `· próximo en ${secondsLeft}s`;
    }
  }, 1000);
}

// =============================================
// HELPERS
// =============================================
function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-MX', { weekday: 'short', month: 'short', day: 'numeric' });
}

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  // Notificaciones
  const notifBtn = document.getElementById('notif-btn');
  if ('Notification' in window) {
    updateNotifBtn(Notification.permission === 'granted');
    if (Notification.permission === 'default') {
      document.getElementById('notif-banner').classList.remove('hidden');
    }
  }
  notifBtn.addEventListener('click', requestNotifications);
  document.getElementById('notif-allow-btn').addEventListener('click', requestNotifications);
  document.getElementById('notif-dismiss-btn').addEventListener('click', hideBanner);

  // Clear alerts log
  document.getElementById('clear-alerts').addEventListener('click', () => {
    document.getElementById('alert-log-body').innerHTML = '';
    document.getElementById('alert-log').classList.add('hidden');
  });

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      renderCurrentTab();
    });
  });

  // Refresh manual
  document.getElementById('refresh-btn').addEventListener('click', () => {
    clearInterval(countdownInterval);
    refresh();
  });

  // Primer fetch
  refresh();
});
