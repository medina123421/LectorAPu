const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: ['--no-sandbox', '--disable-web-security']
  });
  const page = await browser.newPage();
  
  const client = await page.target().createCDPSession();
  await client.send('Network.enable');

  const allUrls = new Set();
  const wsConnections = new Set();
  const fetchCalls = [];

  client.on('Network.requestWillBeSent', ({ request, type }) => {
    allUrls.add(`[${type}] ${request.method} ${request.url}`);
  });

  client.on('Network.webSocketCreated', ({ url }) => {
    wsConnections.add(url);
    console.log('🔌 WS:', url);
  });

  client.on('Network.webSocketFrameReceived', ({ response }) => {
    const p = response.payloadData || '';
    if (p.length > 10) {
      console.log('📦 WS MSG:', p.substring(0, 300));
    }
  });

  client.on('Network.webSocketFrameSent', ({ response }) => {
    console.log('📤 WS SENT:', (response.payloadData||'').substring(0, 200));
  });

  // Interceptar fetch/XHR desde la página
  await page.evaluateOnNewDocument(() => {
    const origFetch = window.fetch;
    window.fetch = function(url, opts) {
      console.log('[FETCH]', url, JSON.stringify(opts?.body||''));
      return origFetch.apply(this, arguments);
    };
    const origXHR = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function(method, url) {
      console.log('[XHR]', method, url);
      return origXHR.apply(this, arguments);
    };
  });

  page.on('console', msg => {
    const text = msg.text();
    if (text.startsWith('[FETCH]') || text.startsWith('[XHR]') || text.startsWith('[WS]')) {
      fetchCalls.push(text);
    }
  });

  console.log('Cargando...');
  await page.goto('https://jugabet.mx/es-MX/sports', { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 10000));

  console.log('\n=== FETCH/XHR CALLS ===');
  fetchCalls.forEach(c => console.log(c));

  console.log('\n=== WEBSOCKETS ===');
  wsConnections.forEach(u => console.log(u));

  console.log('\n=== TODAS LAS REQUESTS (no-static) ===');
  [...allUrls].filter(u => 
    !u.includes('static') && !u.includes('.js') && !u.includes('.css') &&
    !u.includes('.svg') && !u.includes('.png') && !u.includes('.woff') &&
    !u.includes('google') && !u.includes('facebook') && !u.includes('tiktok') &&
    !u.includes('pixel') && !u.includes('doubleclick')
  ).forEach(u => console.log(u));

  await browser.close();
})();
