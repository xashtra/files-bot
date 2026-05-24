function parseDriveLink(url) {
  if (!url || typeof url !== 'string') return null;

  let match;

  match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match) {
    return { type: 'file', id: match[1] };
  }

  match = url.match(/\/drive\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) {
    return { type: 'folder', id: match[1] };
  }

  match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match) {
    return { type: 'file', id: match[1] };
  }

  match = url.match(/^([a-zA-Z0-9_-]{25,})$/);
  if (match) {
    return { type: 'file', id: match[1] };
  }

  return null;
}

module.exports = { parseDriveLink };
