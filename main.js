// ============================================================
// EDGE DETECTOR — e-Basketball H2H GG League
// Módulos: 1-Importar | 2-Líneas | 3-Proyección | 4-Edge
// ============================================================

// --- CONFIG ---
const VALUE_THRESHOLD   = 5;
const AUTO_REFRESH_MS   = 120000;
const GAME_DURATION_MIN = 8;

const isLocal = ['localhost','127.0.0.1'].includes(window.location.hostname);
const proxyUrl = url => isLocal
  ? 'https://corsproxy.io/?' + encodeURIComponent(url)
  : '/api-proxy/' + url.replace('https://api-h2h.hudstats.com/', '');

const API = {
  live:     'https://api-h2h.hudstats.com/v1/live/nba',
  upcoming: 'https://api-h2h.hudstats.com/v1/schedule/upcoming/nba',
  h2h:      id => `https://api-h2h.hudstats.com/v1/h2h/nba?external_id=${id}`
};

// --- ESTADO ---
let currentTab  = 'upcoming';
let allMatches  = { live: [], upcoming: [] };
let statsCache  = {};
let alertedIds  = new Set(JSON.parse(localStorage.getItem('alerted_v3') || '[]'));
let countdown   = null;

// ============================================================
// MÓDULO 2 — ALMACÉN DE LÍNEAS (localStorage)
// Permite guardar líneas de múltiples casas por partido
// ============================================================
const Lines = {
  _key: 'lines_v3',
  _load: () => JSON.parse(localStorage.getItem('lines_v3') || '{}'),
  _save: data => localStorage.setItem('lines_v3', JSON.stringify(data)),

  // Devuelve la mejor línea guardada (la que genera mayor edge absoluto vs proyección)
  getBest(id, projection) {
    const d = this._load();
    const casas = d[id] || {};
    if (Object.keys(casas).length === 0) return null;

    let best = null;
    for (const [casa, linea] of Object.entries(casas)) {
      const edge = projection !== null ? Math.round((projection - linea) * 10) / 10 : null;
      const abs  = edge !== null ? Math.abs(edge) : -1;
      if (best === null || abs > best.abs) {
        best = { casa, linea, edge, abs };
      }
    }
    return best;
  },

  getAll(id) {
    const d = this._load();
    return d[id] || {};
  },

  set(id, casa, linea) {
    const d = this._load();
    if (!d[id]) d[id] = {};
    d[id][casa] = parseFloat(linea);
    this._save(d);
  },

  remove(id, casa) {
    const d = this._load();
    if (d[id]) { delete d[id][casa]; this._save(d); }
  }
};

// ============================================================
// MÓDULO 3 — PROYECCIÓN
// Exactamente la lógica de procesarEdgeEbasketball()
// ============================================================
function proyectarPrePartido(avgA, avgB) {
  if (!avgA || !avgB) return null;
  return Number((avgA + avgB).toFixed(1));
}

function proyectarEnVivo(match) {
  const { teamAScore: sA, teamBScore: sB, startDate, status } = match;
  if (status !== 'live') return null;
  const total = (sA ?? 0) + (sB ?? 0);
  if (total === 0) return null;
  const mins = Math.min(Math.max((Date.now() - new Date(startDate)) / 60000, 1), GAME_DURATION_MIN);
  return Number((total / mins * GAME_DURATION_MIN).toFixed(1));
}

// ============================================================
// MÓDULO 4 — PROCESADOR DE EDGE
// Implementación de procesarEdgeEbasketball() del usuario
// ============================================================
function procesarEdgeEbasketball(partidoAPI, lineaCasa, proyeccion) {
  const local     = `${partidoAPI.teamAName} (${partidoAPI.participantAName})`;
  const visitante = `${partidoAPI.teamBName} (${partidoAPI.participantBName})`;

  const linea = Number(lineaCasa);
  const edge  = Number((proyeccion - linea).toFixed(1));
  const pick  = edge > 0 ? 'Over' : 'Under';
  const estado = Math.abs(edge) >= VALUE_THRESHOLD ? '⚡ VALOR DETECTADO' : 'Normal';

  return {
    evento:      `${local} vs ${visitante}`,
    linea_api:   linea,
    proyeccion,
    edge:        edge > 0 ? `+${edge}` : `${edge}`,
    edge_num:    edge,
    pick,
    estado,
    es_valor:    Math.abs(edge) >= VALUE_THRESHOLD
  };
}

// ============================================================
// NOTIFICACIONES
// ============================================================
function solicitarNotif() {
  if (!('Notification' in window)) return;
  Notification.requestPermission().then(p => actualizarBtnNotif(p === 'granted'));
}

function actualizarBtnNotif(ok) {
  const btn = document.getElementById('notif-btn');
  btn.style.borderColor = ok ? 'var(--accent)' : '';
  btn.style.color       = ok ? 'var(--accent-light)' : '';
  btn.title = ok ? '🔔 Alertas activas' : 'Activar alertas';
}

function dispararAlerta(match, resultado) {
  const id = match.externalId + '_' + resultado.linea_api;
  if (alertedIds.has(id)) return;
  alertedIds.add(id);
  localStorage.setItem('alerted_v3', JSON.stringify([...alertedIds]));

  // Notificación push
  if (Notification.permission === 'granted') {
    new Notification('🚨 Hay un movimiento de línea — Error detectado', {
      body: `${match.participantAName} vs ${match.participantBName}\n${resultado.pick} ${resultado.linea_api} | Edge ${resultado.edge} pts\n${match.streamName}`,
      icon: '/favicon.ico'
    });
  }

  // Log en pantalla
  agregarAlLog(match, resultado);
}

function agregarAlLog(match, resultado) {
  const log  = document.getElementById('alert-log');
  const body = document.getElementById('alert-log-body');
  log.classList.remove('hidden');

  const item = document.createElement('div');
  item.className = 'alert-item';
  const now = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  item.innerHTML = `
    <div class="alert-content">
      <span class="alert-title">🚨 <strong>${match.participantAName} vs ${match.participantBName}</strong></span>
      <span class="alert-detail">${resultado.pick} ${resultado.linea_api} &nbsp;|&nbsp; Edge <strong style="color:${resultado.edge_num > 0 ? 'var(--over)' : 'var(--under)'}">${resultado.edge}</strong> &nbsp;|&nbsp; ${resultado.estado}</span>
    </div>
    <span class="alert-time">${now}</span>
  `;
  body.insertBefore(item, body.firstChild);
}

// ============================================================
// MÓDULO 1 — IMPORTAR PARTIDOS + STATS
// ============================================================
async function fetchTodo() {
  const [liveRaw, upcomingRaw] = await Promise.all([
    fetch(proxyUrl(API.live)).then(r => r.json()),
    fetch(proxyUrl(API.upcoming)).then(r => r.json())
  ]);

  const live     = Array.isArray(liveRaw)     ? liveRaw     : [];
  const upcoming = Array.isArray(upcomingRaw) ? upcomingRaw : [];

  // Fetch stats solo de los que no están en caché
  const sinCache = [...live, ...upcoming]
    .map(m => m.externalId)
    .filter(id => !statsCache[id]);

  // Chunks de 6 para no sobrecargar
  for (let i = 0; i < sinCache.length; i += 6) {
    await Promise.all(sinCache.slice(i, i + 6).map(async id => {
      try {
        const data = await fetch(proxyUrl(API.h2h(id))).then(r => r.json());
        const sA = data.participantAStats;
        const sB = data.participantBStats;
        statsCache[id] = {
          avgA:     sA?.avgPoints    ?? null,
          avgB:     sB?.avgPoints    ?? null,
          winPctA:  sA?.matchesWinPct ?? null,
          winPctB:  sB?.matchesWinPct ?? null,
          formA:    sA?.matchForm?.slice(0, 5) ?? [],
          formB:    sB?.matchForm?.slice(0, 5) ?? [],
        };
      } catch { statsCache[id] = null; }
    }));
  }

  return { live, upcoming };
}

// ============================================================
// UI — RENDERIZAR TARJETA
// ============================================================
function renderCard(match, isLive = false) {
  const {
    externalId, streamName, startDate,
    teamAName, teamBName, participantAName, participantBName,
    teamAScore, teamBScore
  } = match;

  const stats = statsCache[externalId];
  const avgA  = stats?.avgA ?? null;
  const avgB  = stats?.avgB ?? null;

  // MÓDULO 3: proyección
  const proyeccion = isLive
    ? proyectarEnVivo(match)
    : proyectarPrePartido(avgA, avgB);

  // MÓDULO 2: líneas guardadas
  const todasLineas = Lines.getAll(externalId);
  const mejorLinea  = Lines.getBest(externalId, proyeccion);

  // MÓDULO 4: resultado del procesador
  let resultado = null;
  if (mejorLinea && proyeccion !== null) {
    resultado = procesarEdgeEbasketball(match, mejorLinea.linea, proyeccion);
    if (resultado.es_valor) dispararAlerta(match, resultado);
  }

  // Minutos al partido
  const minsUntil = Math.round((new Date(startDate) - Date.now()) / 60000);
  const badgeText  = isLive ? '🔴 LIVE'
    : minsUntil >= 0 && minsUntil <= 20 ? `⏰ ${minsUntil}m`
    : fmt.time(startDate);
  const badgeClass = isLive ? 'live' : minsUntil >= 0 && minsUntil <= 20 ? 'soon' : 'sched';

  // Card border
  let cardBorder = '';
  if (resultado?.es_valor) {
    cardBorder = resultado.edge_num > 0 ? 'border-over' : 'border-under';
  }

  const card = document.createElement('div');
  card.className = `match-card ${cardBorder}`;
  card.dataset.id = externalId;

  card.innerHTML = `
    <div class="card-top-bar ${resultado?.es_valor ? (resultado.edge_num > 0 ? 'bar-over' : 'bar-under') : ''}"></div>

    <!-- CABECERA -->
    <div class="card-header">
      <span class="stream-label">${streamName}</span>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="time-label">${isLive ? '' : fmt.date(startDate)}</span>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
    </div>

    <div class="card-body">

      <!-- EQUIPOS -->
      <div class="matchup">
        <div class="team-col">
          <span class="gamer">${participantAName}</span>
          <span class="team-sm">${teamAName}</span>
          ${avgA ? `<span class="avg">~${avgA} pts/p</span>` : ''}
          ${renderForm(stats?.formA ?? [])}
        </div>
        <div class="center-col">
          ${isLive && teamAScore !== null
            ? `<span class="score-live">${teamAScore}<span class="score-sep"> - </span>${teamBScore}</span>
               <span class="score-total">Total: ${(teamAScore??0)+(teamBScore??0)}</span>`
            : `<span class="vs">VS</span>`
          }
        </div>
        <div class="team-col right">
          <span class="gamer">${participantBName}</span>
          <span class="team-sm">${teamBName}</span>
          ${avgB ? `<span class="avg">~${avgB} pts/p</span>` : ''}
          ${renderForm(stats?.formB ?? [])}
        </div>
      </div>

      <!-- MÓDULO 3 + 4: Proyección y Edge -->
      <div class="mod-grid">
        <div class="mod-box">
          <span class="mod-label">📊 Proyección (Mód.3)</span>
          <span class="mod-val proj">${proyeccion !== null ? `${proyeccion} pts` : '—'}</span>
          <span class="mod-hint">${avgA && avgB ? `${avgA} + ${avgB}` : 'Sin datos'}</span>
        </div>
        <div class="mod-box">
          <span class="mod-label">🎯 Mejor Edge (Mód.4)</span>
          <span class="mod-val ${resultado ? (resultado.edge_num > 0 ? 'edge-pos' : 'edge-neg') : 'edge-nil'}">
            ${resultado ? resultado.edge + ' pts' : '—'}
          </span>
          <span class="mod-hint">${resultado ? resultado.pick : 'Sin línea'}</span>
        </div>
      </div>

      <!-- MÓDULO 2: INGRESAR LÍNEA(S) -->
      <div class="lines-section">
        <div class="lines-header">
          <span class="mod-label">💰 Líneas O/U por Casa (Mód.2)</span>
        </div>

        <!-- Líneas guardadas -->
        <div class="saved-lines" id="saved-${externalId}">
          ${renderSavedLines(externalId, todasLineas, proyeccion)}
        </div>

        <!-- Agregar nueva línea -->
        <div class="add-line-row">
          <input
            type="text"
            class="casa-input"
            id="casa-${externalId}"
            placeholder="Casa (ej. Betway)"
          />
          <input
            type="number"
            class="line-input"
            id="linea-${externalId}"
            placeholder="O/U (ej. 168.5)"
            step="0.5" min="50"
          />
          <button class="add-btn" data-id="${externalId}">+</button>
        </div>
      </div>

      <!-- PICK FINAL -->
      <div class="pick-final ${resultado ? (resultado.es_valor ? (resultado.edge_num > 0 ? 'pf-over-value' : 'pf-under-value') : (resultado.edge_num > 0 ? 'pf-over' : 'pf-under')) : 'pf-empty'}">
        <div class="pf-left">
          <span class="pf-pick ${resultado ? (resultado.edge_num > 0 ? 'over' : 'under') : 'nil'}">
            ${resultado
              ? `${resultado.edge_num > 0 ? '▲' : '▼'} ${resultado.pick} ${resultado.linea_api}`
              : '— Ingresa línea para calcular'}
          </span>
          <span class="pf-detail">
            ${resultado ? resultado.evento.split(' vs ')[0] + ' vs ' + resultado.evento.split(' vs ')[1] : ''}
          </span>
        </div>
        <span class="estado-pill ${resultado?.es_valor ? 'ep-valor' : resultado ? 'ep-ok' : 'ep-wait'}">
          ${resultado?.es_valor ? '⚡ VALOR DETECTADO' : resultado ? '✓ Normal' : 'Sin línea'}
        </span>
      </div>

    </div>
  `;

  // Evento: agregar línea
  card.querySelector('.add-btn').addEventListener('click', () => {
    const casaEl  = card.querySelector(`#casa-${externalId}`);
    const lineaEl = card.querySelector(`#linea-${externalId}`);
    const casa    = casaEl.value.trim() || 'Sin nombre';
    const linea   = parseFloat(lineaEl.value);

    if (isNaN(linea) || linea <= 0) {
      lineaEl.style.borderColor = 'var(--danger)';
      setTimeout(() => lineaEl.style.borderColor = '', 1200);
      return;
    }

    Lines.set(externalId, casa, linea);
    alertedIds.delete(externalId + '_' + linea);
    localStorage.setItem('alerted_v3', JSON.stringify([...alertedIds]));

    casaEl.value = '';
    lineaEl.value = '';
    card.replaceWith(renderCard(match, isLive));
    updateStatsBar();
  });

  // Enter en linea-input
  card.querySelector(`#linea-${externalId}`).addEventListener('keydown', e => {
    if (e.key === 'Enter') card.querySelector('.add-btn').click();
  });

  return card;
}

// Renderiza las filas de líneas guardadas con su edge individual
function renderSavedLines(id, casas, proyeccion) {
  if (Object.keys(casas).length === 0) return '<span class="no-lines">Ninguna línea guardada aún</span>';

  return Object.entries(casas).map(([casa, linea]) => {
    const edge = proyeccion !== null ? Number((proyeccion - linea).toFixed(1)) : null;
    const edgeStr = edge !== null ? (edge > 0 ? `+${edge}` : `${edge}`) : '—';
    const esValor = edge !== null && Math.abs(edge) >= VALUE_THRESHOLD;
    const color   = edge === null ? 'var(--text-muted)' : edge > 0 ? 'var(--over)' : 'var(--under)';

    return `
      <div class="saved-line-row">
        <span class="sl-casa">${casa}</span>
        <span class="sl-linea">${linea}</span>
        <span class="sl-edge" style="color:${color}">${edgeStr}</span>
        ${esValor ? '<span class="sl-valor">⚡</span>' : '<span></span>'}
        <button class="sl-del" data-id="${id}" data-casa="${casa}">✕</button>
      </div>
    `;
  }).join('');
}

function renderForm(form) {
  if (!form || form.length === 0) return '';
  return `<div class="form-row">${form.map(r => `<span class="fd ${r}">${r.toUpperCase()}</span>`).join('')}</div>`;
}

// ============================================================
// UI — STATS BAR
// ============================================================
function updateStatsBar() {
  const all = [...allMatches.live, ...allMatches.upcoming];
  let errores = 0, analizados = 0;

  all.forEach(m => {
    const s  = statsCache[m.externalId];
    const pj = m.status === 'live' ? proyectarEnVivo(m) : proyectarPrePartido(s?.avgA, s?.avgB);
    const lm = Lines.getBest(m.externalId, pj);
    if (lm) {
      analizados++;
      if (lm.abs >= VALUE_THRESHOLD) errores++;
    }
  });

  document.getElementById('stat-upcoming').textContent  = allMatches.upcoming.length;
  document.getElementById('stat-live').textContent      = allMatches.live.length;
  document.getElementById('stat-errors').textContent    = errores;
  document.getElementById('stat-analyzed').textContent  = analizados;
}

// ============================================================
// UI — RENDER TAB
// ============================================================
function renderTab() {
  const container = document.getElementById('matches-container');
  const matches   = currentTab === 'live' ? allMatches.live : allMatches.upcoming;
  const isLive    = currentTab === 'live';

  container.innerHTML = '';
  if (matches.length === 0) {
    container.innerHTML = `<div class="empty-state">No hay partidos ${isLive ? 'en vivo' : 'próximos'} ahora.</div>`;
    return;
  }

  matches.forEach(m => {
    const card = renderCard(m, isLive);
    // Delegación: borrar línea guardada
    card.querySelectorAll('.sl-del').forEach(btn => {
      btn.addEventListener('click', () => {
        Lines.remove(btn.dataset.id, btn.dataset.casa);
        card.replaceWith(renderCard(m, isLive));
        updateStatsBar();
      });
    });
    container.appendChild(card);
  });

  updateStatsBar();
}

// ============================================================
// MAIN REFRESH
// ============================================================
async function refresh() {
  const statusText = document.getElementById('status-text');
  const dot        = document.getElementById('status-dot');
  const btn        = document.getElementById('refresh-btn');

  btn.classList.add('spinning');
  statusText.textContent = 'Actualizando...';

  try {
    const { live, upcoming } = await fetchTodo();
    allMatches = { live, upcoming };
    renderTab();
    dot.className = 'dot pulse';
    statusText.textContent = `Actualizado ${fmt.time(new Date())}`;
    iniciarCountdown();
  } catch (err) {
    dot.className = 'dot error';
    statusText.textContent = 'Error de conexión';
    document.getElementById('matches-container').innerHTML = `
      <div class="error-card">
        <strong>No se pudo conectar</strong><br><br>${err.message}<br><br>
        ${isLocal ? 'Activa CORS Unblocker o sube la app a Netlify.' : 'Intenta de nuevo.'}
      </div>`;
  } finally {
    btn.classList.remove('spinning');
  }
}

function iniciarCountdown() {
  clearInterval(countdown);
  let seg = AUTO_REFRESH_MS / 1000;
  const el = document.getElementById('next-refresh');
  countdown = setInterval(() => {
    seg--;
    if (seg <= 0) { clearInterval(countdown); el.textContent = ''; refresh(); }
    else el.textContent = `· refresca en ${seg}s`;
  }, 1000);
}

// ============================================================
// HELPERS FORMATO
// ============================================================
const fmt = {
  time: d  => new Date(d).toLocaleTimeString('es-MX',  { hour: '2-digit', minute: '2-digit' }),
  date: d  => new Date(d).toLocaleDateString('es-MX',  { weekday: 'short', day: 'numeric', month: 'short' })
};

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  if ('Notification' in window) {
    actualizarBtnNotif(Notification.permission === 'granted');
  }

  document.getElementById('notif-btn').addEventListener('click', solicitarNotif);
  document.getElementById('refresh-btn').addEventListener('click', () => { clearInterval(countdown); refresh(); });
  document.getElementById('clear-alerts').addEventListener('click', () => {
    document.getElementById('alert-log-body').innerHTML = '';
    document.getElementById('alert-log').classList.add('hidden');
  });

  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      currentTab = t.dataset.tab;
      renderTab();
    });
  });

  refresh();
});
