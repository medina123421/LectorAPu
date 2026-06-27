// background.js

let statsCache = {};

// Escuchar peticiones desde content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchStats") {
    const p1 = request.player1;
    const p2 = request.player2;

    fetchAllStats().then(stats => {
      // Buscar promedios por nombre
      let avg1 = null;
      let avg2 = null;
      
      for (const [id, s] of Object.entries(stats)) {
        if (s.name === p1) avg1 = s.avg;
        if (s.name === p2) avg2 = s.avg;
      }
      
      sendResponse({ avg1, avg2 });
    });
    
    return true; // Mantener puerto abierto para sendResponse asíncrono
  }
});

// Función para obtener stats de la API de HUDStats (Próximos y En Vivo)
async function fetchAllStats() {
  if (Object.keys(statsCache).length > 0) return statsCache; // Usar caché básica
  
  try {
    const urls = [
      'https://api-h2h.hudstats.com/v1/live/nba',
      'https://api-h2h.hudstats.com/v1/schedule/upcoming/nba'
    ];
    
    const [liveData, upcomingData] = await Promise.all(urls.map(u => fetch(u).then(r => r.json())));
    const matches = [...(Array.isArray(liveData) ? liveData : []), ...(Array.isArray(upcomingData) ? upcomingData : [])];
    
    // Obtener H2H de todos los partidos encontrados
    const allIds = matches.map(m => m.externalId);
    
    for (const id of allIds.slice(0, 10)) { // Limitar para no saturar
      try {
        const data = await fetch(`https://api-h2h.hudstats.com/v1/h2h/nba?external_id=${id}`).then(r => r.json());
        if (data.participantAStats) {
          statsCache[data.participantAStats.participantId] = {
            name: data.participantAStats.participantName,
            avg: data.participantAStats.avgPoints
          };
        }
        if (data.participantBStats) {
          statsCache[data.participantBStats.participantId] = {
            name: data.participantBStats.participantName,
            avg: data.participantBStats.avgPoints
          };
        }
      } catch(e) {}
    }
    
    // Limpiar caché cada 5 minutos
    setTimeout(() => { statsCache = {}; }, 300000);
    
    return statsCache;
  } catch (e) {
    console.error("Error en fetchAllStats:", e);
    return {};
  }
}
