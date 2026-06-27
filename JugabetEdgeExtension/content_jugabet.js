// content_jugabet.js

console.log("[JUGABET BRIDGE] Iniciando lectura de cuotas...");

setInterval(scanJugabet, 2000);

function scanJugabet() {
  const eventCards = document.querySelectorAll('app-event-card, div[data-event-id], .event-card, .market-row, .app-competitors, app-market-items');
  const linesExtracted = {};

  eventCards.forEach(card => {
    // Buscar el nombre del evento (ej: Los Angeles Lakers (HUNCHO) - New York Knicks (BULLSEYE))
    const titleEl = card.querySelector('.title, .event-name, [data-qa="event-name"], app-event-card-competitors, .name');
    if (!titleEl) return;
    
    const titleText = titleEl.innerText;
    
    // Extraer nombres entre paréntesis (nombres de los gamers)
    const matchPlayers = titleText.match(/\(([A-Z0-9\sa-z]+)\)/g);
    if (!matchPlayers || matchPlayers.length < 2) return;

    const p1 = matchPlayers[0].replace(/[\(\)]/g, '').trim().toUpperCase();
    const p2 = matchPlayers[1].replace(/[\(\)]/g, '').trim().toUpperCase();
    const matchKey = `${p1}_${p2}`;

    // Buscar línea (Over/Under)
    const lineElements = card.querySelectorAll('app-outcome, .outcome, button[data-outcome], .odds, span');
    let currentLine = null;

    for (const el of lineElements) {
      const text = el.innerText.toUpperCase();
      // Detectar formato "O 168.5", "Más 168.5", "168.5"
      const numMatch = text.match(/(\d{3}\.5)/);
      if (numMatch) {
        currentLine = parseFloat(numMatch[1]);
        break; 
      }
    }

    if (currentLine) {
      linesExtracted[matchKey] = currentLine;
    }
  });

  if (Object.keys(linesExtracted).length > 0) {
    chrome.storage.local.set({ jugabetLines: linesExtracted }, () => {
      // Guardado silenciosamente en chrome storage
    });
  }
}
