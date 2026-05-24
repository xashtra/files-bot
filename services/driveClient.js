const https = require('https');
const http = require('http');

function httpGet(urlStr, method = 'GET', maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    function doRequest(u, redirectsLeft) {
      const parsed = new URL(u);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request(u, { method }, (res) => {
        if (redirectsLeft > 0 && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const nextUrl = new URL(res.headers.location, u).href;
          return doRequest(nextUrl, redirectsLeft - 1);
        }
        resolve(res);
      });
      req.on('error', reject);
      req.end();
    }
    doRequest(urlStr, maxRedirects);
  });
}

function readBody(res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks).toString()));
    res.on('error', reject);
  });
}

function parseFileSize(text) {
  const match = text.match(/([\d.]+)\s*(KB|MB|GB)/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === 'KB') return Math.round(val * 1024);
  if (unit === 'MB') return Math.round(val * 1024 * 1024);
  if (unit === 'GB') return Math.round(val * 1024 * 1024 * 1024);
  return 0;
}

async function getFileInfo(fileId) {
  const url = `https://drive.google.com/file/d/${fileId}/view`;
  const res = await httpGet(url);

  if (res.statusCode !== 200) {
    return { id: fileId, name: `file_${fileId}`, size: 0, mimeType: 'application/octet-stream', totalSize: 0 };
  }

  const html = await readBody(res);

  const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
  const name = titleMatch ? titleMatch[1] : `file_${fileId}`;

  const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
  const size = descMatch ? parseFileSize(descMatch[1]) : 0;

  return { id: fileId, name, size, mimeType: 'application/octet-stream', totalSize: size };
}

async function getFolderInfo(folderId) {
  const url = `https://drive.google.com/drive/folders/${folderId}`;
  const res = await httpGet(url);
  const html = await readBody(res);

  const nameMatch = html.match(/<title>([^<]+)<\/title>/);
  const name = nameMatch ? nameMatch[1].replace(/ - Google Drive$/, '').trim() : 'Unknown Folder';

  const subfolderIds = [...new Set(
    (html.match(/\/drive\/folders\/([a-zA-Z0-9_-]+)/g) || [])
      .map((m) => m.split('/').pop())
      .filter((id) => id !== folderId)
  )];

  const validIds = [...new Set(
    (html.match(/data-id="([a-zA-Z0-9_-]{10,})"/g) || []).map((m) => m.match(/"([^"]+)"/)[1])
  )];

  const fileIds = validIds.filter((id) => !subfolderIds.includes(id));

  const files = [];
  for (const id of fileIds) {
    const snippet = html.match(new RegExp(`data-id="${id}"[^>]*>[\\s\\S]{0,1000}?(?=data-id="|</div>\\s*</div>)`));
    const tooltip = snippet?.[0]?.match(/data-tooltip="([^"]+)"/);
    const fileName = tooltip?.[1] || `file_${id}`;

    let fileSize = 0;
    const dataSize = snippet?.[0]?.match(/data-size="(\d+)"/);
    if (dataSize) {
      fileSize = parseInt(dataSize[1], 10);
    } else {
      const sizeText = snippet?.[0]?.match(/([\d.]+)\s*(KB|MB|GB)/i);
      if (sizeText) fileSize = parseFileSize(sizeText[0]);
    }

    files.push({ id, name: fileName, mimeType: 'application/octet-stream', size: fileSize });
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return {
    name, id: folderId,
    directFiles: files.length, subfolders: subfolderIds.length,
    files, subfolderIds,
    totalSize,
  };
}

async function downloadFileStream(fileId) {
  const url = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
  const res = await httpGet(url);
  if (res.statusCode !== 200) {
    throw new Error(`Google returned status ${res.statusCode}`);
  }
  const cd = res.headers['content-disposition'] || '';
  const match = cd.match(/filename\*?=(?:UTF-8'')?["']?([^;"'\n]+)/i);
  const filename = match ? decodeURIComponent(match[1].trim()) : `${fileId}`;
  return { stream: res, filename };
}

async function createDriveClient() {
  return { getFileInfo, getFolderInfo, downloadFileStream };
}

module.exports = { createDriveClient, getFileInfo, getFolderInfo, downloadFileStream };
