import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishPortfolio } from './publish-github.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(root, 'index.html');
const editedDir = path.join(root, 'images', 'edited');
const port = Number(process.env.PORT || 8787);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function cleanFilePart(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80) || 'image';
}

function extensionFromMime(mime, fallbackName) {
  const fromName = path.extname(fallbackName || '').toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.mov'].includes(fromName)) return fromName;
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'video/mp4') return '.mp4';
  if (mime === 'video/webm') return '.webm';
  if (mime === 'video/quicktime') return '.mov';
  return '.jpg';
}

function replaceNthGalleryUrl(source, projectId, imageIndex, nextPath) {
  const projectStart = source.indexOf(`{id:'${projectId}'`);
  if (projectStart === -1) throw new Error(`Projet introuvable: ${projectId}`);
  const nextProjectStart = source.indexOf("\n  {id:'", projectStart + 1);
  const projectEnd = nextProjectStart === -1 ? source.indexOf('];', projectStart) : nextProjectStart;
  const before = source.slice(0, projectStart);
  const project = source.slice(projectStart, projectEnd);
  const after = source.slice(projectEnd);

  let count = -1;
  const updated = project.replace(/u:('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g, (match) => {
    count += 1;
    return count === imageIndex ? `u:'${nextPath}'` : match;
  });

  if (count < imageIndex) throw new Error(`Image de galerie introuvable: ${projectId} #${imageIndex + 1}`);
  return before + updated + after;
}

function replaceThumbUrl(source, projectId, nextPath) {
  const projectStart = source.indexOf(`{id:'${projectId}'`);
  if (projectStart === -1) throw new Error(`Projet introuvable: ${projectId}`);
  const nextProjectStart = source.indexOf("\n  {id:'", projectStart + 1);
  const projectEnd = nextProjectStart === -1 ? source.indexOf('];', projectStart) : nextProjectStart;
  const before = source.slice(0, projectStart);
  const project = source.slice(projectStart, projectEnd);
  const after = source.slice(projectEnd);
  const updated = project.replace(/thumb:'[^']*'/, `thumb:'${nextPath}'`);
  if (updated === project) throw new Error(`Vignette introuvable: ${projectId}`);
  return before + updated + after;
}

function getProjectBlock(source, projectId) {
  const projectStart = source.indexOf(`{id:'${projectId}'`);
  if (projectStart === -1) throw new Error(`Projet introuvable: ${projectId}`);
  const nextProjectStart = source.indexOf("\n  {id:'", projectStart + 1);
  const projectEnd = nextProjectStart === -1 ? source.indexOf('];', projectStart) : nextProjectStart;
  return source.slice(projectStart, projectEnd);
}

function isVideoPath(assetPath) {
  return /\.(mp4|webm|mov|m4v)(?:$|\?)/i.test(assetPath || '');
}

function getThumbUrl(projectBlock) {
  const match = projectBlock.match(/thumb:'([^']*)'/);
  return match ? match[1] : '';
}

function syncThumbAfterGalleryUpload(source, projectId, imageIndex, nextPath) {
  if (imageIndex !== 0 || isVideoPath(nextPath)) return source;
  const project = getProjectBlock(source, projectId);
  const currentThumb = getThumbUrl(project);
  if (currentThumb && !isVideoPath(currentThumb) && currentThumb === nextPath) return source;
  return replaceThumbUrl(source, projectId, nextPath);
}

function replaceProjectTextField(source, projectId, field, value) {
  const allowed = new Set(['title', 'cat', 'year', 'client', 'role', 'bio']);
  if (!allowed.has(field)) throw new Error(`Champ non modifiable: ${field}`);

  const projectStart = source.indexOf(`{id:'${projectId}'`);
  if (projectStart === -1) throw new Error(`Projet introuvable: ${projectId}`);
  const nextProjectStart = source.indexOf("\n  {id:'", projectStart + 1);
  const projectEnd = nextProjectStart === -1 ? source.indexOf('];', projectStart) : nextProjectStart;
  const before = source.slice(0, projectStart);
  const project = source.slice(projectStart, projectEnd);
  const after = source.slice(projectEnd);
  const fieldPattern = new RegExp(`${field}:('(?:\\\\.|[^'\\\\])*'|"(?:\\\\.|[^"\\\\])*")`);
  const updated = project.replace(fieldPattern, `${field}:${JSON.stringify(String(value))}`);

  if (updated === project) throw new Error(`Texte introuvable: ${projectId} ${field}`);
  return before + updated + after;
}

async function savePermanentImage(req, res) {
  let raw = '';
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > 135_000_000) req.destroy();
  });

  req.on('end', async () => {
    try {
      const { key, name, type, dataUrl } = JSON.parse(raw);
      const isImage = dataUrl.startsWith('data:image/');
      const isVideo = dataUrl.startsWith('data:video/');
      if (!key || !dataUrl || (!isImage && !isVideo)) {
        send(res, 400, JSON.stringify({ error: 'Média invalide.' }), { 'content-type': 'application/json' });
        return;
      }

      const [, payload = ''] = dataUrl.split(',');
      const buffer = Buffer.from(payload, 'base64');
      const ext = extensionFromMime(type, name);
      const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
      const fileBase = `${cleanFilePart(key)}-${stamp}${ext}`;
      const sitePath = `images/edited/${fileBase}`;

      await mkdir(editedDir, { recursive: true });
      await writeFile(path.join(editedDir, fileBase), buffer);

      const [kind, projectId, indexValue] = String(key).split(':');
      let html = await readFile(indexPath, 'utf8');
      if (kind === 'thumb') {
        if (isVideo) throw new Error('La couverture doit être une image, pas une vidéo.');
        html = replaceThumbUrl(html, projectId, sitePath);
      } else if (kind === 'gallery') {
        html = replaceNthGalleryUrl(html, projectId, Number(indexValue), sitePath);
        if (isImage) html = syncThumbAfterGalleryUpload(html, projectId, Number(indexValue), sitePath);
      } else {
        throw new Error(`Clé inconnue: ${key}`);
      }
      await writeFile(indexPath, html);

      send(res, 200, JSON.stringify({ path: sitePath, type: isVideo ? 'video' : 'image' }), { 'content-type': 'application/json' });
    } catch (error) {
      send(res, 500, JSON.stringify({ error: error.message }), { 'content-type': 'application/json' });
    }
  });
}

async function savePermanentText(req, res) {
  let raw = '';
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > 1_000_000) req.destroy();
  });

  req.on('end', async () => {
    try {
      const { key, value } = JSON.parse(raw);
      const [kind, projectId, field] = String(key || '').split(':');
      const cleanValue = String(value || '').trim();

      if (kind !== 'project' || !projectId || !field || !cleanValue) {
        send(res, 400, JSON.stringify({ error: 'Texte invalide.' }), { 'content-type': 'application/json' });
        return;
      }

      const html = await readFile(indexPath, 'utf8');
      const updated = replaceProjectTextField(html, projectId, field, cleanValue);
      await writeFile(indexPath, updated);

      send(res, 200, JSON.stringify({ ok: true }), { 'content-type': 'application/json' });
    } catch (error) {
      send(res, 500, JSON.stringify({ error: error.message }), { 'content-type': 'application/json' });
    }
  });
}

async function serveFile(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);
  const pathname = decodeURIComponent(url.pathname);
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.resolve(root, requested);

  if (!filePath.startsWith(root)) {
    send(res, 403, 'Forbidden');
    return;
  }

  try {
    const file = await readFile(filePath);
    const type = mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    send(res, 200, file, { 'content-type': type, 'cache-control': 'no-store' });
  } catch {
    send(res, 404, 'Not found');
  }
}

async function publishToGithub(res) {
  try {
    const result = await publishPortfolio();
    send(res, 200, JSON.stringify(result), { 'content-type': 'application/json' });
  } catch (error) {
    send(res, 500, JSON.stringify({
      error: error.message,
      hint: 'Si la publication échoue à cause de la connexion GitHub, utilise PUBLIER_GITHUB.command depuis le Finder.'
    }), { 'content-type': 'application/json' });
  }
}

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/save-image') {
    savePermanentImage(req, res);
    return;
  }
  if (req.method === 'POST' && req.url === '/api/save-text') {
    savePermanentText(req, res);
    return;
  }
  if (req.method === 'POST' && req.url === '/api/publish-github') {
    publishToGithub(res);
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    serveFile(req, res);
    return;
  }
  send(res, 405, 'Method not allowed');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Portfolio editor: http://127.0.0.1:${port}/`);
});
