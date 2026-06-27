// =============================================
// CONFIG
// =============================================
const GAME_DURATION_MINUTES = 8; // duración estimada de un partido e-basketball en minutos reales
const VALUE_THRESHOLD = 5;       // Edge mínimo en puntos para declarar "Valor Detectado"
const AUTO_REFRESH_MS = 60000;   // Actualizar cada 60 segundos

// Detectar entorno: local (XAMPP) o producción (Netlify)
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE = isLocal
  ? 'https://corsproxy.io/?' + encodeURIComponent('https://api-h2h.hudstats.com/v1/live/nba')
  : '/api-proxy/v1/live/nba';

// =============================================
// MÓDULO 2: ALMACÉN DE LÍNEAS (Over/Under)
// Persiste en localStorage para no perder datos al refrescar
// =============================================
const linesStore = {
  _key: 'edgedetector_lines',
  get(matchId) {
    const data = JSON.parse(localStorage.getItem(this._key) || '{}');
    return data[matchId] ?? null;
  },
  save(matchId, line) {
    const data = JSON.parse(localStorage.getItem(this._key) || '{}');
    data[matchId] = parseFloat(line);
    localStorage.setItem(this._key, JSON.stringify(data));
  }
};

// =============================================
// MÓDULO 3: CÁLCULO DE PROYECCIÓN
// Usa el marcador actual y el tiempo transcurrido
// para proyectar los puntos totales al final del partido
// =============================================
function calcProjection(match) {
  const { teamAScore, teamBScore, startDate, status } = match;

  // Si es scheduled, no hay proyección
  if (status !== 'live') return null;

  const scoreA = teamAScore ?? 0;
  const scoreB = teamBScore ?? 0;
  const currentTotal = scoreA + scoreB;

  if (currentTotal === 0) return null;

  const now = new Date();
  const start = new Date(startDate);
  const minutesElapsed = Math.max((now - start) / 60000, 1); // al menos 1 min
  const minutesClamped = Math.min(minutesElapsed, GAME_DURATION_MINUTES);

  // Proyección lineal: ritmo actual × duración total
  const pace = currentTotal / minutesClamped;
  const projected = pace * GAME_DURATION_MINUTES;

  return Math.round(projected * 10) / 10;
}

// =============================================
// MÓDULO 4: CÁLCULO DE EDGE
// Edge = Proyección - Línea
// =============================================
function calcEdge(projection, line) {
  if (projection === null || line === null) return null;
  return Math.round((projection - line) * 10) / 10;
}

// =============================================
// UI: FORMATEAR HORA DE INICIO
// =============================================
function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

// =============================================
// UI: RENDERIZAR UNA TARJETA
// =============================================
function renderCard(match) {
  const {
    externalId, streamName, status,
    teamAName, teamBName,
    participantAName, participantBName,
    teamAScore, teamBScore,
    startDate
  } = match;

  const isLive = status === 'live';
  const scoreA = teamAScore ?? 0;
  const scoreB = teamBScore ?? 0;
  const currentTotal = scoreA + scoreB;

  // Módulo 3
  const projection = calcProjection(match);

  // Módulo 2: recuperar línea guardada
  const savedLine = linesStore.get(externalId);

  // Módulo 4
  const edge = calcEdge(projection, savedLine);
  const hasValue = edge !== null && Math.abs(edge) >= VALUE_THRESHOLD;
  const isOver = edge !== null && edge > 0;

  // Card classes
  let cardClass = 'match-card';
  if (hasValue) cardClass += isOver ? ' over-value' : ' under-value';

  // Edge box class
  const edgeClass = edge === null ? '' : edge > 0 ? 'edge-pos' : 'edge-neg';

  // Pick text
  let pickMain = '—';
  let pickMainClass = 'neutral';
  let pickSub = 'Ingresa la línea O/U para calcular';

  if (savedLine !== null && projection !== null) {
    pickMain = isOver ? `▲ OVER ${savedLine}` : `▼ UNDER ${savedLine}`;
    pickMainClass = isOver ? 'over' : 'under';
    pickSub = `Proyección ${projection} pts | Edge ${edge > 0 ? '+' : ''}${edge}`;
  } else if (!isLive) {
    pickSub = 'Partido no iniciado — sin proyección disponible';
  } else if (projection === null) {
    pickSub = 'Marcador 0-0, esperando puntos iniciales...';
  }

  // Pick box class
  let pickBoxClass = 'pick-box';
  if (savedLine !== null && projection !== null) {
    pickBoxClass += hasValue
      ? (isOver ? ' pick-over pick-value' : ' pick-under pick-value')
      : (isOver ? ' pick-over' : ' pick-under');
  }

  // Value badge
  let valueBadge = '';
  if (savedLine === null) {
    valueBadge = `<span class="value-badge-big waiting">Sin línea</span>`;
  } else if (!isLive) {
    valueBadge = `<span class="value-badge-big waiting">Pendiente</span>`;
  } else if (hasValue) {
    valueBadge = `<span class="value-badge-big detected">⚡ Valor Detectado</span>`;
  } else {
    valueBadge = `<span class="value-badge-big ok">Línea Correcta</span>`;
  }

  const card = document.createElement('div');
  card.className = cardClass;
  card.dataset.id = externalId;

  card.innerHTML = `
    <!-- CARD HEADER -->
    <div class="card-header">
      <span class="stream-name">${streamName}</span>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="start-time">${formatTime(startDate)}</span>
        <span class="badge ${isLive ? 'live' : 'scheduled'}">${isLive ? '🔴 LIVE' : 'PRÓXIMO'}</span>
      </div>
    </div>

    <!-- CARD BODY -->
    <div class="card-body">

      <!-- EQUIPOS Y MARCADOR -->
      <div class="teams-section">
        <div class="team-block left">
          <span class="player-name">${participantAName}</span>
          <span class="team-name">${teamAName}</span>
        </div>

        <div class="score-center">
          ${isLive
            ? `<span class="score-display live-score">${scoreA}<span class="score-sep"> - </span>${scoreB}</span>`
            : `<span class="score-display">VS</span>`
          }
          ${isLive ? `<span class="total-score">Total: ${currentTotal} pts</span>` : ''}
        </div>

        <div class="team-block right">
          <span class="player-name">${participantBName}</span>
          <span class="team-name">${teamBName}</span>
        </div>
      </div>

      <!-- MÓDULO 2: LÍNEA O/U -->
      <div class="module-line">
        <div class="module-label">
          <span class="module-num">2</span>
          Línea Over/Under
        </div>
        <div class="line-input-row">
          <input
            type="number"
            class="line-input"
            id="line-${externalId}"
            placeholder="ej. 168.5"
            value="${savedLine !== null ? savedLine : ''}"
            step="0.5"
            min="50"
          />
          <button class="calc-btn" data-id="${externalId}">Calcular</button>
        </div>
      </div>

      <!-- MÓDULOS 3 & 4: RESULTADOS -->
      <div class="result-grid">
        <div class="result-box">
          <div class="result-box-label">📊 Módulo 3 · Proyección</div>
          <div class="result-box-value" id="proj-${externalId}">
            ${projection !== null ? `${projection} pts` : '—'}
          </div>
        </div>

        <div class="result-box ${edgeClass}">
          <div class="result-box-label">🎯 Módulo 4 · Edge</div>
          <div class="result-box-value" id="edge-${externalId}">
            ${edge !== null ? `${edge > 0 ? '+' : ''}${edge}` : '—'}
          </div>
        </div>

        <!-- PICK & ESTADO -->
        <div class="${pickBoxClass}" id="pick-${externalId}">
          <div class="pick-left">
            <span class="pick-main ${pickMainClass}">${pickMain}</span>
            <span class="pick-sub">${pickSub}</span>
          </div>
          ${valueBadge}
        </div>
      </div>

    </div>
  `;

  // Evento: botón Calcular
  card.querySelector('.calc-btn').addEventListener('click', () => {
    const input = card.querySelector(`#line-${externalId}`);
    const lineVal = parseFloat(input.value);
    if (isNaN(lineVal) || lineVal <= 0) {
      input.style.borderColor = 'var(--danger)';
      setTimeout(() => input.style.borderColor = '', 1200);
      return;
    }
    linesStore.save(externalId, lineVal);
    // Re-renderizar solo esta tarjeta
    const newCard = renderCard(match);
    card.replaceWith(newCard);
  });

  // Evento: Enter en el input
  card.querySelector(`#line-${externalId}`).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') card.querySelector('.calc-btn').click();
  });

  return card;
}

// =============================================
// MÓDULO 1: IMPORTAR PARTIDOS DESDE LA API
// =============================================
async function fetchMatches() {
  const container = document.getElementById('matches-container');
  const statusText = document.getElementById('status-text');
  const dot = document.querySelector('.dot');
  const refreshBtn = document.getElementById('refresh-btn');

  refreshBtn.classList.add('spinning');
  statusText.textContent = 'Actualizando...';

  try {
    const res = await fetch(API_BASE, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const matches = Array.isArray(data) ? data : (data.data || data.matches || []);

    // Separar en vivo vs próximos
    const live = matches.filter(m => m.status === 'live');
    const scheduled = matches.filter(m => m.status !== 'live');

    // Actualizar stats bar
    const withValue = matches.filter(m => {
      const proj = calcProjection(m);
      const line = linesStore.get(m.externalId);
      const edge = calcEdge(proj, line);
      return edge !== null && Math.abs(edge) >= VALUE_THRESHOLD;
    });

    document.getElementById('stat-total').textContent = matches.length;
    document.getElementById('stat-live').textContent = live.length;
    document.getElementById('stat-value').textContent = withValue.length;
    document.getElementById('stat-scheduled').textContent = scheduled.length;

    // Renderizar
    container.innerHTML = '';

    if (live.length > 0) {
      const liveHeader = document.createElement('div');
      liveHeader.className = 'section-header';
      liveHeader.innerHTML = `🔴 En Vivo <div class="section-line"></div> ${live.length} partido${live.length > 1 ? 's' : ''}`;
      container.appendChild(liveHeader);
      live.forEach(m => container.appendChild(renderCard(m)));
    }

    if (scheduled.length > 0) {
      const schedHeader = document.createElement('div');
      schedHeader.className = 'section-header';
      schedHeader.innerHTML = `🕐 Próximos <div class="section-line"></div> ${scheduled.length} partido${scheduled.length > 1 ? 's' : ''}`;
      container.appendChild(schedHeader);
      scheduled.forEach(m => container.appendChild(renderCard(m)));
    }

    if (matches.length === 0) {
      container.innerHTML = `<div class="loader-wrap"><p>No hay partidos disponibles ahora.</p></div>`;
    }

    // Status OK
    dot.className = 'dot pulse';
    statusText.textContent = `Actualizado ${new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;

  } catch (err) {
    console.error('API Error:', err);
    dot.className = 'dot error';
    statusText.textContent = 'Error de conexión';

    container.innerHTML = `
      <div class="error-card">
        <strong>No se pudo conectar con la API</strong><br><br>
        ${err.message}<br><br>
        Si estás en local (XAMPP), asegúrate de que la extensión CORS Unblocker está activa en tu navegador, o sube la app a Netlify para que funcione sin restricciones.
      </div>
    `;
  } finally {
    refreshBtn.classList.remove('spinning');
  }
}

// =============================================
// INICIAR
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  fetchMatches();

  // Botón refresh manual
  document.getElementById('refresh-btn').addEventListener('click', fetchMatches);

  // Auto-refresh cada 60 segundos
  setInterval(fetchMatches, AUTO_REFRESH_MS);
});
