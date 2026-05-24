const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

function getAuth() {
  const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH;
  const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;

  let credentials;
  if (credentialsJson) {
    credentials = JSON.parse(credentialsJson);
  } else if (credentialsPath) {
    const fullPath = path.resolve(credentialsPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Credentials file not found at: ${fullPath}`);
    }
    credentials = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } else {
    throw new Error('Missing Google credentials. Set GOOGLE_CREDENTIALS_PATH or GOOGLE_CREDENTIALS_JSON.');
  }

  const auth = new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    ['https://www.googleapis.com/auth/drive.readonly']
  );

  return auth;
}

async function createDriveClient() {
  const auth = await getAuth();
  return google.drive({ version: 'v3', auth });
}

module.exports = { createDriveClient, getAuth };
