const fs = require('fs');
const path = require('path');

const TEMP_DIR = path.resolve(__dirname, '..', 'temp');
const MAX_DEPTH = 3;
const CONCURRENCY = 3;
const EXPORT_MAP = {
  'application/vnd.google-apps.document': {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: '.docx',
  },
  'application/vnd.google-apps.spreadsheet': {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: '.xlsx',
  },
  'application/vnd.google-apps.presentation': {
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extension: '.pptx',
  },
  'application/vnd.google-apps.script': {
    mimeType: 'application/vnd.google-apps.script+json',
    extension: '.json',
  },
  'application/vnd.google-apps.form': {
    mimeType: 'application/json',
    extension: '.json',
  },
  'text/plain': {
    mimeType: 'text/plain',
    extension: '.txt',
  },
};

function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 200);
}

async function downloadFile(drive, fileId, fileName, mimeType, size, maxSize) {
  if (size > maxSize) {
    return { skipped: true, name: fileName, size, reason: `exceeds ${(maxSize / (1024 * 1024)).toFixed(0)} MB limit` };
  }

  const exportConfig = EXPORT_MAP[mimeType];
  const isGoogleDoc = mimeType && mimeType.startsWith('application/vnd.google-apps.');

  let destPath;
  let response;

  try {
    if (isGoogleDoc && exportConfig) {
      response = await drive.files.export(
        { fileId, mimeType: exportConfig.mimeType },
        { responseType: 'stream' }
      );
      destPath = path.join(TEMP_DIR, `${sanitizeFileName(fileName)}${exportConfig.extension}`);
    } else if (isGoogleDoc && !exportConfig) {
      return { skipped: true, name: fileName, size, reason: `unsupported Google Workspace type: ${mimeType}` };
    } else {
      response = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' }
      );
      const ext = path.extname(fileName) || '';
      destPath = path.join(TEMP_DIR, sanitizeFileName(fileName) || `download${ext}`);
    }

    await new Promise((resolve, reject) => {
      const dest = fs.createWriteStream(destPath);
      response.data.pipe(dest);
      response.data.on('end', resolve);
      response.data.on('error', reject);
      dest.on('error', reject);
    });

    return { skipped: false, path: destPath, name: path.basename(destPath), size };
  } catch (err) {
    const status = err?.response?.status;
    if (status === 403 || status === 404) {
      return { skipped: true, name: fileName, size, reason: `access denied (${status}). Share with the service account email.` };
    }
    throw err;
  }
}

async function listFolderContents(drive, folderId) {
  const files = [];
  const folders = [];
  let pageToken;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size)',
      pageSize: 100,
      pageToken,
    });

    for (const item of res.data.files) {
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        folders.push(item);
      } else {
        files.push(item);
      }
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return { files, folders };
}

async function enumerateAllFiles(drive, folderId, depth = 0) {
  if (depth > MAX_DEPTH) return [];

  const { files, folders } = await listFolderContents(drive, folderId);
  const all = [...files];

  for (const folder of folders) {
    const nested = await enumerateAllFiles(drive, folder.id, depth + 1);
    all.push(...nested);
  }

  return all;
}

async function downloadAll(drive, folderId, maxSize, onProgress, depth = 0) {
  if (depth > MAX_DEPTH) return { downloaded: [], skipped: [], totalFiles: 0 };

  const { files, folders } = await listFolderContents(drive, folderId);
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

  for (const folder of folders) {
    const subResults = await downloadAll(drive, folder.id, maxSize, onProgress, depth + 1);
    downloaded.push(...subResults.downloaded);
    skipped.push(...subResults.skipped);
    totalFiles += subResults.totalFiles;
  }

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
    return result;
  });

  await withConcurrency(tasks, CONCURRENCY);
  return { downloaded, skipped, totalFiles: total };
}

async function withConcurrency(tasks, concurrency) {
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      await tasks[i]();
    }
  }

  const workers = Array(Math.min(concurrency, tasks.length))
    .fill()
    .map(() => worker());

  await Promise.all(workers);
}

async function getFileInfo(drive, fileId) {
  const res = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size, webViewLink',
  });
  return res.data;
}

async function getFolderInfo(drive, folderId) {
  const folder = await drive.files.get({
    fileId: folderId,
    fields: 'id, name, webViewLink',
  });

  const contents = await listFolderContents(drive, folderId);

  let totalSize = 0;
  const filesInfo = [];
  for (const f of contents.files) {
    const size = parseInt(f.size || '0', 10);
    totalSize += size;
    filesInfo.push({ name: f.name, mimeType: f.mimeType, size });
  }

  return {
    name: folder.data.name,
    id: folder.data.id,
    directFiles: contents.files.length,
    subfolders: contents.folders.length,
    files: filesInfo,
    totalSize,
  };
}

module.exports = { downloadFile, downloadAll, downloadAllFlat, enumerateAllFiles, getFileInfo, getFolderInfo };
