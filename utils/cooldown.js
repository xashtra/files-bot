const cooldowns = new Map();

function setCooldown(userId, command, durationMs) {
  const key = `${userId}:${command}`;
  cooldowns.set(key, Date.now() + durationMs);
}

function checkCooldown(userId, command) {
  const key = `${userId}:${command}`;
  const expiry = cooldowns.get(key);
  if (!expiry) return 0;
  if (Date.now() > expiry) {
    cooldowns.delete(key);
    return 0;
  }
  return Math.ceil((expiry - Date.now()) / 1000);
}

module.exports = { setCooldown, checkCooldown };
