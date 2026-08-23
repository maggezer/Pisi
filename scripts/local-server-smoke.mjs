import { createServer } from 'vite';

const server = await createServer({
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false }
});

try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Yerel sunucu portu alınamadı.');

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const [pageResponse, entryResponse, stylesResponse, viewportResponse] = await Promise.all([
    fetch(`${baseUrl}/`),
    fetch(`${baseUrl}/src/main.js`),
    fetch(`${baseUrl}/src/platform.css`),
    fetch(`${baseUrl}/src/mobile-viewport.js`)
  ]);
  if (![pageResponse, entryResponse, stylesResponse, viewportResponse].every(({ ok }) => ok)) {
    throw new Error(`Yerel sunucu yanıtı başarısız: HTML ${pageResponse.status}, JS ${entryResponse.status}, CSS ${stylesResponse.status}, viewport ${viewportResponse.status}`);
  }

  const [html, entry, styles, viewportModule] = await Promise.all([
    pageResponse.text(), entryResponse.text(), stylesResponse.text(), viewportResponse.text()
  ]);
  if (!html.includes('<title>Pisi</title>') || !html.includes('/src/main.js')) {
    throw new Error('Yerel sunucu beklenen Pisi giriş sayfasını döndürmedi.');
  }
  if (!entry.includes('platform.css') || !styles.includes('--app-height') || !viewportModule.includes('installMobileViewport')) {
    throw new Error('Mobil stil veya viewport modülü yerel giriş paketine bağlanmadı.');
  }

  console.log(`Yerel Pisi sunucusu sağlıklı · ${pageResponse.status} · ${baseUrl}`);
} finally {
  await server.close();
}
