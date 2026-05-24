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

async function getFileInfo(fileId) {
  const url = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
  const res = await httpGet(url, 'HEAD');
  const cd = res.headers['content-disposition'] || '';
  const match = cd.match(/filename\*?=(?:UTF-8'')?["']?([^;"'\n]+)/i);
  const name = match ? decodeURIComponent(match[1].trim()) : 'Unknown';
  const size = parseInt(res.headers['content-length'] || '0', 10);
  return { id: fileId, name, size, mimeType: 'application/octet-stream', totalSize: size };
}

async function getFolderInfo(folderId) {
  const url = `https://drive.google.com/drive/folders/${folderId}`;
  const res = await httpGet(url);
  const html = await readBody(res);

  const nameMatch = html.match(/<title>([^<]+)<\/title>/);
  const name = nameMatch ? nameMatch[1].replace(/ - Google Drive$/, '').trim() : 'Unknown Folder';

  const dataIds = [...html.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
  const dataNames = [...html.matchAll(/data-tooltip="([^"]+)"/g)].map((m) => m[1]);

  const seen = new Set();
  const files = [];
  for (let i = 0; i < dataIds.length; i++) {
    if (!seen.has(dataIds[i])) {
      seen.add(dataIds[i]);
      files.push({ id: dataIds[i], name: dataNames[i] || `file_${dataIds[i]}`, mimeType: 'application/octet-stream', size: 0 });
    }
  }

  return { name, id: folderId, directFiles: files.length, subfolders: 0, files, totalSize: 0 };
}

async function downloadFileStream(fileId) {
  const url = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
  const res = await httpGet(url);
  const cd = res.headers['content-disposition'] || '';
  const match = cd.match(/filename\*?=(?:UTF-8'')?["']?([^;"'\n]+)/i);
  const filename = match ? decodeURIComponent(match[1].trim()) : `${fileId}`;
  return { stream: res, filename };
}

async function createDriveClient() {
  return { getFileInfo, getFolderInfo, downloadFileStream };
}

module.exports = { createDriveClient, getFileInfo, getFolderInfo, downloadFileStream };
