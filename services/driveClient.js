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

  if (res.statusCode !== 200) {
    return { id: fileId, name: `file_${fileId}`, size: 0, mimeType: 'application/octet-stream', totalSize: 0 };
  }

  const cd = res.headers['content-disposition'] || '';
  const match = cd.match(/filename\*?=(?:UTF-8'')?["']?([^;"'\n]+)/i);
  const name = match ? decodeURIComponent(match[1].trim()) : `file_${fileId}`;
  const size = parseInt(res.headers['content-length'] || '0', 10);
  return { id: fileId, name, size, mimeType: 'application/octet-stream', totalSize: size };
}

async function getFolderInfo(folderId) {
  const url = `https://drive.google.com/drive/folders/${folderId}`;
  const res = await httpGet(url);
  const html = await readBody(res);

  const nameMatch = html.match(/<title>([^<]+)<\/title>/);
  const name = nameMatch ? nameMatch[1].replace(/ - Google Drive$/, '').trim() : 'Unknown Folder';

  const validIds = (html.match(/data-id="([A-Za-z0-9_-]{28,})"/g) || []).map((m) => m.match(/"([^"]+)"/)[1]);
  const uniqueIds = [...new Set(validIds)];

  const files = [];
  for (const id of uniqueIds) {
    const nameRegex = new RegExp(`data-id="${id}"[^>]*>[\\s\\S]{0,500}?<div[^>]*data-tooltip="([^"]+)"`, 'i');
    const nameMatch = html.match(nameRegex);
    const fileName = nameMatch ? nameMatch[1] : `file_${id}`;
    files.push({ id, name: fileName, mimeType: 'application/octet-stream', size: 0 });
  }

  return { name, id: folderId, directFiles: files.length, subfolders: 0, files, totalSize: 0 };
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
