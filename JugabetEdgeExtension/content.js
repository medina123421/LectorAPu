// content.js

const VALUE_THRESHOLD = 5.0;

// Observador para detectar cuando Jugabet carga los partidos en el DOM
const observer = new MutationObserver(procesarDOM);
observer.observe(document.body, { childList: true, subtree: true });

function procesarDOM() {
  // Buscamos las tarjetas de eventos o filas de mercado en Jugabet
  // Nota: Jugabet (Iolite) suele usar tags como <app-event-card> o <app-market-items>
  const eventCards = document.querySelectorAll('app-event-card, div[data-event-id], .event-card, .market-row');
  
  eventCards.forEach(card => {
    // Evitar procesar dos veces
    if (card.dataset.edgeProcessed) return;

    // Buscar nombres de los jugadores
    // Jugabet suele mostrar "Los Angeles Lakers (HUNCHO) - New York Knicks (BULLSEYE)"
    const titleEl = card.querySelector('.title, .event-name, [data-qa="event-name"], app-event-card-competitors');
    if (!titleEl) return;

    const titleText = titleEl.innerText;
    
    // Extraer nombres en mayúsculas entre paréntesis (ej. HUNCHO)
    const matchPlayers = titleText.match(/\(([A-Z0-9\s]+)\)/g);
    if (!matchPlayers || matchPlayers.length < 2) return;

    const p1 = matchPlayers[0].replace(/[\(\)]/g, '').trim();
    const p2 = matchPlayers[1].replace(/[\(\)]/g, '').trim();

    // Buscar la línea de Over/Under (Totales)
    // Buscamos botones de momios que tengan un texto como "O 168.5" o "Más 168.5" o simplemente el número
    const lineElements = card.querySelectorAll('app-outcome, .outcome, button[data-outcome]');
    let currentLine = null;
    let targetElementToInject = null;

    for (const el of lineElements) {
      const text = el.innerText.toUpperCase();
      // Buscar si el texto tiene "O ", "U ", "MÁS", "MENOS", o un decimal tipo "168.5" en mercado de Totales
      const numMatch = text.match(/(\d{3}\.5)/);
      if (numMatch) {
        currentLine = parseFloat(numMatch[1]);
        targetElementToInject = el;
        break; // Tomamos la primera línea de totales encontrada
      }
    }

    if (currentLine && targetElementToInject) {
      // Marcar como procesado para no repetir llamadas
      card.dataset.edgeProcessed = "true";

      // Pedir al background.js las stats de estos dos jugadores
      chrome.runtime.sendMessage({ action: "fetchStats", player1: p1, player2: p2 }, response => {
        if (!response || !response.avg1 || !response.avg2) return;

        const proyeccion = Number((response.avg1 + response.avg2).toFixed(1));
        const edge = Number((proyeccion - currentLine).toFixed(1));
        const isValue = Math.abs(edge) >= VALUE_THRESHOLD;

        // Inyectar visualmente en Jugabet
        inyectarBadge(targetElementToInject, currentLine, proyeccion, edge, isValue);
      });
    }
  });
}

function inyectarBadge(targetEl, linea, proj, edge, isValue) {
  // Evitar dobles badges
  if (targetEl.parentElement.querySelector('.edge-badge')) return;

  targetEl.parentElement.classList.add('edge-container-mod');

  const badge = document.createElement('div');
  badge.className = 'edge-badge';
  
  if (isValue) {
    badge.classList.add('edge-value-detected');
    if (edge > 0) {
      badge.classList.add('edge-over');
      badge.innerHTML = `⚡ OVER | EDGE +${edge}`;
    } else {
      badge.classList.add('edge-under');
      badge.innerHTML = `⚡ UNDER | EDGE ${edge}`;
    }
  } else {
    badge.classList.add('edge-normal');
    badge.innerHTML = `PROJ: ${proj} (EDGE ${edge > 0 ? '+' : ''}${edge})`;
  }

  // Insertar al lado del botón de cuota
  targetEl.parentElement.appendChild(badge);
}

// Ejecutar una vez al cargar
setTimeout(procesarDOM, 2000);
