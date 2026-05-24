const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getGuildConfig } = require('../services/configStore');
const { getRequiredRole } = require('../utils/permissions');
const { errorEmbed } = require('../utils/embeds');

const COLORS = { info: 0x4285F4 };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show bot configuration status')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ embeds: [errorEmbed('This command can only be used in a server.')], ephemeral: true });
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ embeds: [errorEmbed('Only administrators can view status.')], ephemeral: true });
    }

    const cfg = getGuildConfig(interaction.guildId);
    const envRoleId = process.env.DRIVE_BOT_ROLE_ID || null;
    const googleCredsSet = !!(process.env.GOOGLE_CREDENTIALS_PATH || process.env.GOOGLE_CREDENTIALS_JSON);
    const discordTokenSet = !!process.env.DISCORD_TOKEN;

    const embed = new EmbedBuilder()
      .setColor(COLORS.info)
      .setTitle('📊 Bot Status')
      .setDescription(`**${interaction.guild.name}**`)
      .addFields(
        {
          name: 'Setup Complete',
          value: cfg?.setupComplete ? '✅ Yes' : '❌ No — run `/setup`',
          inline: true,
        },
        {
          name: 'Discord Token',
          value: discordTokenSet ? '✅ Set' : '❌ Missing',
          inline: true,
        },
        {
          name: 'Google Credentials',
          value: googleCredsSet ? '✅ Set' : '❌ Missing — check .env or Railway vars',
          inline: true,
        },
        {
          name: 'Role Restriction',
          value: cfg?.roleId ? `<@&${cfg.roleId}>` : envRoleId ? `<@&${envRoleId}> (env)` : 'None (public)',
          inline: true,
        },
        {
          name: 'Notification Channel',
          value: cfg?.channelId ? `<#${cfg.channelId}>` : 'None',
          inline: true,
        },
        {
          name: 'Welcome Message',
          value: cfg?.welcomeMessage !== false ? 'Enabled' : 'Disabled',
          inline: true,
        },
        {
          name: 'Google Drive API',
          value: googleCredsSet ? '✅ Ready' : '❌ Not configured',
          inline: false,
        }
      )
      .setFooter({ text: `Bot ID: ${interaction.client.user.id}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
