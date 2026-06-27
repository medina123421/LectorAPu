// content_dashboard.js

console.log("[JUGABET BRIDGE] Conectado al Dashboard. Esperando datos...");

// Escuchar cambios en el storage local
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.jugabetLines) {
    const lines = changes.jugabetLines.newValue;
    
    // Enviar mensaje al Dashboard a través de window.postMessage
    window.postMessage({
      type: "JUGABET_SYNC",
      payload: lines
    }, "*");
  }
});

// Enviar el estado actual al cargar
chrome.storage.local.get(['jugabetLines'], (result) => {
  if (result.jugabetLines) {
    window.postMessage({
      type: "JUGABET_SYNC",
      payload: result.jugabetLines
    }, "*");
  }
});
