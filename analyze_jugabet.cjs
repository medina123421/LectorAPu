const fs = require('fs');

// Analizar webComponents
const wc = fs.readFileSync('jugabet_wc.js', 'utf-8');
const main = fs.readFileSync('jugabet_main.js', 'utf-8');
const combined = wc + '\n' + main;

// WebSockets
const wsMatches = combined.match(/wss?:\/\/[a-zA-Z0-9._\-\/:%?=&]+/g);
console.log('=== WebSocket URLs ===');
if (wsMatches) [...new Set(wsMatches)].forEach(u => console.log(u));
else console.log('(ninguno)');

// APIs con sports/events/odds
const sportsApis = combined.match(/["'`][a-zA-Z0-9._\-\/:%?=&]{5,120}["'`]/g);
const filtered = sportsApis ? [...new Set(sportsApis)]
  .map(s => s.replace(/["'`]/g, ''))
  .filter(s => 
    s.includes('sport') || s.includes('event') || s.includes('odds') || 
    s.includes('market') || s.includes('total') || s.includes('outcome') ||
    s.includes('live') || s.includes('prematch') || s.includes('feed') ||
    s.includes('line') || s.includes('grpc') || s.includes('proto')
  ) : [];
console.log('\n=== Endpoints de Apuestas ===');
filtered.slice(0, 40).forEach(u => console.log(u));

// Dominios externos
const extUrls = combined.match(/https?:\/\/[a-zA-Z0-9._-]+\.[a-z]{2,6}/g);
console.log('\n=== Dominios externos ===');
if (extUrls) [...new Set(extUrls)]
  .filter(u => !u.includes('google') && !u.includes('facebook') && !u.includes('jugabet'))
  .forEach(u => console.log(u));

// SSE (Server-Sent Events)
const sse = combined.match(/EventSource[^;]{0,100}/g);
console.log('\n=== SSE (EventSource) ===');
if (sse) [...new Set(sse)].slice(0, 5).forEach(u => console.log(u));

// gRPC
const grpc = combined.match(/grpc[A-Za-z.:/\-_]{2,60}/g);
console.log('\n=== gRPC refs ===');
if (grpc) [...new Set(grpc)].slice(0, 10).forEach(u => console.log(u));
