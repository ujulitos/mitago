import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = __dirname;
const librosDir = path.join(root, 'libros');
const host = '0.0.0.0';
const port = Number(process.env.PORT || 3000);
const shouldOpenBrowser = process.argv.includes('--open') || process.env.OPEN === '1';

// Ensure physical /libros directory exists
if (!fs.existsSync(librosDir)) {
  try {
    fs.mkdirSync(librosDir, { recursive: true });
  } catch (err) {
    console.error('No se pudo crear el directorio /libros:', err.message);
  }
}

// Complete MIME type mapping
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.epub': 'application/epub+zip',
  '.fb2': 'application/xml; charset=utf-8',
  '.cbz': 'application/zip',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
};

// Helper: send HTTP response
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    ...headers
  });
  res.end(body);
};

// Discover local IPv4 LAN addresses
function getLanIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if ((net.family === 'IPv4' || net.family === 4) && !net.internal) {
        ips.push({ interface: name, address: net.address });
      }
    }
  }
  return ips;
}

// Safe path resolver with fallback aliases
function resolvePath(reqUrl) {
  const reqUrlObj = new URL(reqUrl, 'http://localhost');
  let pathname = decodeURIComponent(reqUrlObj.pathname || '/');

  // Root & reader alias
  if (pathname === '/' || pathname === '/index.html' || pathname === '/reader.html' || pathname === '/src/reader/reader.html') {
    return path.join(root, 'index.html');
  }

  // Alias /books/ to /libros/ for backwards compatibility
  if (pathname.startsWith('/books/')) {
    pathname = pathname.replace(/^\/books\//, '/libros/');
  }

  // Clean pathname
  const relative = pathname.replace(/^\/+/, '');
  const directPath = path.normalize(path.join(root, relative));

  // Security check: stay within root
  const relFromRoot = path.relative(root, directPath);
  if (relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot)) {
    return null;
  }

  if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
    return directPath;
  }

  // Fallback aliases for relative requests (e.g. /reader.css -> /src/reader/reader.css)
  const candidateAliases = [
    path.join(root, 'src/reader', relative),
    path.join(root, 'src/lib', relative),
    path.join(root, 'src/core', relative),
    path.join(root, 'src', relative),
    path.join(librosDir, path.basename(relative))
  ];

  for (const cand of candidateAliases) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      return cand;
    }
  }

  return directPath;
}

// Minimal QR Code SVG generator (fallback-safe)
function generateQrSvg(text) {
  const encoded = encodeURIComponent(text);
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encoded}`;
}

const server = http.createServer((req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    });
    res.end();
    return;
  }

  const reqUrlObj = new URL(req.url, 'http://localhost');
  const pathname = reqUrlObj.pathname || '/';

  // API 1: /api/info
  if (pathname === '/api/info') {
    const lanIps = getLanIps();
    const primaryIp = lanIps[0]?.address || 'localhost';
    const info = {
      status: 'ok',
      port,
      localUrl: `http://localhost:${port}`,
      lanUrl: `http://${primaryIp}:${port}`,
      ips: lanIps
    };
    send(res, 200, JSON.stringify(info, null, 2), { 'Content-Type': 'application/json; charset=utf-8' });
    return;
  }

  // API 2: POST /api/upload o POST /api/libros (Guarda físicamente el libro en la subcarpeta /libros)
  if (req.method === 'POST' && (pathname === '/api/upload' || pathname === '/api/libros')) {
    try {
      const rawName = reqUrlObj.searchParams.get('name') || req.headers['x-filename'] || 'libro.epub';
      let safeName = path.basename(decodeURIComponent(rawName)).replace(/[/\\?%*:|"<>]/g, '_');
      if (!safeName) safeName = `libro_${Date.now()}.epub`;

      if (!fs.existsSync(librosDir)) {
        fs.mkdirSync(librosDir, { recursive: true });
      }

      const targetPath = path.join(librosDir, safeName);
      const writeStream = fs.createWriteStream(targetPath);
      let bytesWritten = 0;

      req.on('data', (chunk) => {
        bytesWritten += chunk.length;
      });

      req.pipe(writeStream);

      writeStream.on('finish', () => {
        console.log(`[Upload] Libro guardado físicamente: /libros/${safeName} (${bytesWritten} bytes)`);
        send(res, 200, JSON.stringify({
          ok: true,
          message: 'Libro guardado físicamente en /libros',
          name: safeName,
          size: bytesWritten,
          url: `/libros/${encodeURIComponent(safeName)}`
        }), { 'Content-Type': 'application/json; charset=utf-8' });
      });

      writeStream.on('error', (err) => {
        console.error('[Upload Error]', err);
        send(res, 500, JSON.stringify({ error: err.message }), { 'Content-Type': 'application/json; charset=utf-8' });
      });
    } catch (err) {
      send(res, 500, JSON.stringify({ error: err.message }), { 'Content-Type': 'application/json; charset=utf-8' });
    }
    return;
  }

  // API 2b: DELETE /api/libros?name=... (Elimina físicamente un libro de /libros)
  if (req.method === 'DELETE' && (pathname === '/api/libros' || pathname === '/api/upload')) {
    try {
      const rawName = reqUrlObj.searchParams.get('name') || '';
      const safeName = path.basename(decodeURIComponent(rawName));
      if (!safeName) {
        send(res, 400, JSON.stringify({ error: 'Nombre de archivo requerido' }), { 'Content-Type': 'application/json; charset=utf-8' });
        return;
      }
      const targetPath = path.join(librosDir, safeName);
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
        send(res, 200, JSON.stringify({ ok: true, deleted: safeName }), { 'Content-Type': 'application/json; charset=utf-8' });
      } else {
        send(res, 404, JSON.stringify({ error: 'Archivo no encontrado' }), { 'Content-Type': 'application/json; charset=utf-8' });
      }
    } catch (err) {
      send(res, 500, JSON.stringify({ error: err.message }), { 'Content-Type': 'application/json; charset=utf-8' });
    }
    return;
  }

  // API 3: GET /api/libros (o /api/books) - Listar libros físicos disponibles en /libros
  if (pathname === '/api/libros' || pathname === '/api/books') {
    try {
      if (!fs.existsSync(librosDir)) {
        send(res, 200, JSON.stringify([]), { 'Content-Type': 'application/json; charset=utf-8' });
        return;
      }
      const files = fs.readdirSync(librosDir);
      const supportedExts = ['.epub', '.fb2', '.cbz', '.fbz', '.zip'];
      const books = files
        .filter((file) => supportedExts.includes(path.extname(file).toLowerCase()))
        .map((file) => {
          const filePath = path.join(librosDir, file);
          const stat = fs.statSync(filePath);
          return {
            name: file,
            size: stat.size,
            mtime: stat.mtimeMs,
            url: `/libros/${encodeURIComponent(file)}`
          };
        });
      send(res, 200, JSON.stringify(books, null, 2), { 'Content-Type': 'application/json; charset=utf-8' });
    } catch (err) {
      send(res, 500, JSON.stringify({ error: err.message }), { 'Content-Type': 'application/json; charset=utf-8' });
    }
    return;
  }

  // API 4: /api/qr (redirect or deliver QR code)
  if (pathname === '/api/qr') {
    const data = reqUrlObj.searchParams.get('data') || `http://localhost:${port}`;
    const qrUrl = generateQrSvg(data);
    res.writeHead(302, { Location: qrUrl });
    res.end();
    return;
  }

  // Static files & Range requests
  const filePath = resolvePath(req.url);
  if (!filePath) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      send(res, 404, 'Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mime[ext] || 'application/octet-stream';
    const totalSize = stats.size;

    // Additional Service Worker header
    const extraHeaders = {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes'
    };
    if (path.basename(filePath) === 'sw.js') {
      extraHeaders['Service-Worker-Allowed'] = '/';
    }

    // Support HTTP Range requests
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

      if (start >= totalSize || end >= totalSize || start > end) {
        res.writeHead(416, {
          'Content-Range': `bytes */${totalSize}`,
          'Access-Control-Allow-Origin': '*'
        });
        res.end();
        return;
      }

      const chunkSize = (end - start) + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        ...extraHeaders,
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Content-Length': chunkSize
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        ...extraHeaders,
        'Content-Length': totalSize
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });
});

server.listen(port, host, () => {
  const lanIps = getLanIps();
  console.log('\n' + '='.repeat(60));
  console.log('  📖 LÉETELO WEBAPP — LECTOR DE LIBROS EPUB / FB2 / CBZ');
  console.log('='.repeat(60));
  console.log('  Servidor activo y listo:');
  console.log(`\n  👉 En esta computadora (Localhost): http://localhost:${port}`);
  if (lanIps.length > 0) {
    console.log('  📱 En tu red local (móvil/tablet):');
    for (const item of lanIps) {
      console.log(`     http://${item.address}:${port}  (${item.interface})`);
    }
  } else {
    console.log('  📱 En red local: Conecta tu PC a Wi-Fi para ver la IP de tu red.');
  }
  console.log(`\n  📁 Carpeta física de libros:        ./libros/`);
  console.log('  (Los libros importados se guardan físicamente en esta carpeta)');
  console.log('='.repeat(60) + '\n');

  if (shouldOpenBrowser) {
    const localUrl = `http://localhost:${port}`;
    const startCmd = process.platform === 'win32' ? `start "" "${localUrl}"` :
                     process.platform === 'darwin' ? `open "${localUrl}"` :
                     `xdg-open "${localUrl}"`;
    exec(startCmd, () => {});
  }
});

export default server;
