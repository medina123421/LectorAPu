document.addEventListener('DOMContentLoaded', () => {
  const fetchBtn = document.getElementById('fetch-btn');
  const endpointInput = document.getElementById('api-endpoint');
  const container = document.getElementById('matches-container');
  const statusIndicator = document.querySelector('.status-indicator span:last-child');
  const dot = document.querySelector('.dot');

  // URL por defecto actualizada para usar el Proxy de Netlify si no han introducido nada diferente
  if (endpointInput.value === 'https://api-h2h.hudstats.com/' || endpointInput.value === 'https://api-h2h.hudstats.com/v1/live/nba') {
    // '/api-proxy/...' será interceptado por Netlify (o fallará en XAMPP si no hay proxy configurado allí)
    // Para que puedas seguir probando en local (XAMPP), si detectamos que estás en localhost, usaremos corsproxy.io temporalmente
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      endpointInput.value = 'https://corsproxy.io/?' + encodeURIComponent('https://api-h2h.hudstats.com/v1/live/nba');
    } else {
      endpointInput.value = '/api-proxy/v1/live/nba';
    }
  }

  const updateStatus = (msg, isError = false) => {
    statusIndicator.textContent = msg;
    if (isError) {
      dot.style.backgroundColor = 'var(--danger)';
      dot.classList.remove('pulse');
    } else {
      dot.style.backgroundColor = 'var(--success)';
      dot.classList.add('pulse');
    }
  };

  const renderMatches = (matches) => {
    container.innerHTML = '';
    
    if (!matches || matches.length === 0) {
      container.innerHTML = `<div class="error-msg">No se encontraron partidos en vivo en este momento.</div>`;
      return;
    }

    matches.forEach(match => {
      const league = match.streamName || 'H2H GG League';
      
      const team1Name = match.teamAName ? `${match.teamAName} (${match.participantAName})` : 'Equipo 1';
      const team2Name = match.teamBName ? `${match.teamBName} (${match.participantBName})` : 'Equipo 2';
      
      const score1 = match.teamAScore ?? '-';
      const score2 = match.teamBScore ?? '-';
      
      const isLive = match.status === 'live';
      const statusText = isLive ? 'LIVE' : 'SCHEDULED';
      
      const homeOdd = (Math.random() * (2.5 - 1.2) + 1.2).toFixed(2);
      const awayOdd = (Math.random() * (2.5 - 1.2) + 1.2).toFixed(2);

      const card = document.createElement('div');
      card.className = 'match-card';
      
      card.innerHTML = `
        <div class="league-info">
          <span>${league}</span>
          <span class="${isLive ? 'live-badge' : ''}" style="${!isLive ? 'color: var(--text-muted)' : ''}">
            ${statusText}
          </span>
        </div>
        
        <div class="teams">
          <div class="team">
            <span class="team-name">${team1Name}</span>
            <span class="score">${score1}</span>
          </div>
          <div class="team">
            <span class="team-name">${team2Name}</span>
            <span class="score">${score2}</span>
          </div>
        </div>

        <div class="odds-container">
          <div class="odd-box">
            <span class="odd-label">1 (Local)</span>
            <span class="odd-value">${homeOdd}</span>
          </div>
          <div class="odd-box">
            <span class="odd-label">2 (Visita)</span>
            <span class="odd-value">${awayOdd}</span>
          </div>
        </div>
      `;
      container.appendChild(card);
    });
  };

  const fetchMatches = async () => {
    const url = endpointInput.value.trim();
    if (!url) return;

    container.innerHTML = `
      <div class="loader-container">
        <div class="spinner"></div>
        <p>Conectando con la API real...</p>
      </div>
    `;
    updateStatus('Obteniendo datos...', false);

    try {
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error(`Error HTTP: ${response.status}`);
      }

      const data = await response.json();
      const matchesArray = Array.isArray(data) ? data : (data.matches || data.data || [data]);

      renderMatches(matchesArray);
      updateStatus('Conectado a H2H API', false);

    } catch (error) {
      console.error('Error fetching API:', error);
      updateStatus('Error de Conexión', true);
      
      container.innerHTML = `
        <div class="error-msg" style="grid-column: 1 / -1; margin-bottom: 1rem;">
          No se pudo conectar a la API (${error.message}).
        </div>
      `;
    }
  };

  fetchBtn.addEventListener('click', fetchMatches);
  fetchMatches();
});
