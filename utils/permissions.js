const { PermissionFlagsBits } = require('discord.js');
const { getRoleId } = require('../services/configStore');

function getRequiredRole() {
  return process.env.DRIVE_BOT_ROLE_ID || null;
}

async function checkPermission(interaction) {
  if (!interaction.inGuild()) return false;

  const roleId = getRoleId(interaction.guildId) || getRequiredRole();
  if (!roleId) return true;

  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (member.roles.cache.has(roleId)) return true;

  return false;
}

async function checkMessagePermission(message) {
  if (!message.guild) return false;

  const roleId = getRoleId(message.guild.id) || getRequiredRole();
  if (!roleId) return true;

  const member = await message.guild.members.fetch(message.author.id);
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (member.roles.cache.has(roleId)) return true;

  return false;
}

async function isAdmin(interaction) {
  if (!interaction.inGuild()) return false;
  const member = await interaction.guild.members.fetch(interaction.user.id);
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

module.exports = { checkPermission, checkMessagePermission, isAdmin, getRequiredRole };
