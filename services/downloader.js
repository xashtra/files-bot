const fs = require('fs');
const path = require('path');
const { downloadFileStream, getFileInfo: getDriveFileInfo, getFolderInfo: getDriveFolderInfo } = require('./driveClient');

const TEMP_DIR = path.resolve(__dirname, '..', 'temp');
const CONCURRENCY = 3;

function sanitizeFileName(name) {
  if (!name || name.trim() === '') return `download_${Date.now()}`;
  return name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 200);
}

async function downloadFile(drive, fileId, fileName, mimeType, size, maxSize) {
  try {
    const { stream, filename } = await downloadFileStream(fileId);
    const safeName = sanitizeFileName(filename || fileName || fileId);
    const destPath = path.join(TEMP_DIR, safeName);

    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    await new Promise((resolve, reject) => {
      const dest = fs.createWriteStream(destPath);
      stream.pipe(dest);
      stream.on('end', resolve);
      stream.on('error', reject);
      dest.on('error', reject);
    });

    const stats = fs.statSync(destPath);
    if (stats.size === 0) {
      fs.unlinkSync(destPath);
      return { skipped: true, name: filename || fileName, size, reason: 'downloaded file is empty' };
    }

    if (stats.size > maxSize) {
      fs.unlinkSync(destPath);
      return { skipped: true, name: filename || fileName, size: stats.size, reason: `exceeds ${(maxSize / (1024 * 1024)).toFixed(0)} MB limit` };
    }

    return { skipped: false, path: destPath, name: filename || fileName, size: stats.size };
  } catch (err) {
    return { skipped: true, name: fileName || fileId, size, reason: `download failed: ${err.message}` };
  }
}

async function enumerateAllFiles(drive, folderId, depth = 0) {
  if (depth > 3) return [];
  const info = await getDriveFolderInfo(folderId);
  let allFiles = [...info.files];
  for (const subId of info.subfolderIds || []) {
    const subFiles = await enumerateAllFiles(drive, subId, depth + 1);
    allFiles = allFiles.concat(subFiles);
  }
  return allFiles;
}

async function downloadAll(drive, folderId, maxSize, onProgress, depth = 0) {
  if (depth > 3) return { downloaded: [], skipped: [], totalFiles: 0 };
  const info = await getDriveFolderInfo(folderId);
  const files = info.files;
  let downloaded = [];
  let skipped = [];
  let totalFiles = files.length;

  const fileTasks = files.map((file) => async () => {
    const size = parseInt(file.size || '0', 10);
    const result = await downloadFile(drive, file.id, file.name, file.mimeType, size, maxSize);
    if (result.skipped) skipped.push(result);
    else downloaded.push(result);
    if (onProgress) onProgress(downloaded.length + skipped.length, totalFiles);
  });

  await withConcurrency(fileTasks, CONCURRENCY);
  return { downloaded, skipped, totalFiles };
}

async function downloadAllFlat(drive, files, maxSize, onProgress) {
  let downloaded = [];
  let skipped = [];
  const total = files.length;

  const tasks = files.map((file) => async () => {
    const size = parseInt(file.size || '0', 10);
    const result = await downloadFile(drive, file.id, file.name, file.mimeType, size, maxSize);
    if (result.skipped) skipped.push(result);
    else downloaded.push(result);
    if (onProgress) onProgress(downloaded.length + skipped.length, total);
  });

  await withConcurrency(tasks, CONCURRENCY);
  return { downloaded, skipped, totalFiles: total };
}

function withConcurrency(tasks, concurrency) {
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      await tasks[i]();
    }
  }
  const workers = Array(Math.min(concurrency, tasks.length)).fill().map(() => worker());
  return Promise.all(workers);
}

async function getFileInfo(drive, fileId) {
  return getDriveFileInfo(fileId);
}

async function getFolderInfo(drive, folderId) {
  return getDriveFolderInfo(folderId);
}

module.exports = { downloadFile, downloadAll, downloadAllFlat, enumerateAllFiles, getFileInfo, getFolderInfo };
