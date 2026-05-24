const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '..', 'config.json');

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch {
  }
  return { guilds: {} };
}

function writeConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function getGuildConfig(guildId) {
  const config = readConfig();
  return config.guilds[guildId] || null;
}

function setGuildConfig(guildId, data) {
  const config = readConfig();
  config.guilds[guildId] = {
    ...data,
    setupAt: new Date().toISOString(),
  };
  writeConfig(config);
}

function isSetupComplete(guildId) {
  const cfg = getGuildConfig(guildId);
  return cfg && cfg.setupComplete === true;
}

function getRoleId(guildId) {
  const cfg = getGuildConfig(guildId);
  if (cfg && cfg.roleId) return cfg.roleId;
  return process.env.DRIVE_BOT_ROLE_ID || null;
}

function listConfiguredGuilds() {
  const config = readConfig();
  return Object.entries(config.guilds).map(([id, data]) => ({ id, ...data }));
}

module.exports = {
  getGuildConfig,
  setGuildConfig,
  isSetupComplete,
  getRoleId,
  listConfiguredGuilds,
};
