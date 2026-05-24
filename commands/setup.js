const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
} = require('discord.js');
const { setGuildConfig, isSetupComplete, getGuildConfig } = require('../services/configStore');
const { errorEmbed } = require('../utils/embeds');

const COLORS = { success: 0x34A853, info: 0x4285F4 };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure the bot for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ embeds: [errorEmbed('This command can only be used in a server.')], ephemeral: true });
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ embeds: [errorEmbed('Only administrators can run setup.')], ephemeral: true });
    }

    const existing = getGuildConfig(interaction.guildId);

    const modal = new ModalBuilder()
      .setCustomId('setup_modal')
      .setTitle('Bot Setup — Google Drive Downloader');

    const roleInput = new TextInputBuilder()
      .setCustomId('setup_role_id')
      .setLabel('Allowed Role ID (leave blank for anyone)')
      .setPlaceholder('Paste the role ID or leave empty')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(existing?.roleId || '');

    const notificationInput = new TextInputBuilder()
      .setCustomId('setup_channel_id')
      .setLabel('Notification Channel ID (optional)')
      .setPlaceholder('Channel ID for startup alerts')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(existing?.channelId || '');

    const welcomeInput = new TextInputBuilder()
      .setCustomId('setup_welcome')
      .setLabel('Welcome message on join?')
      .setPlaceholder('yes or no')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(existing?.welcomeMessage !== false ? 'yes' : 'no');

    modal.addComponents(
      new ActionRowBuilder().addComponents(roleInput),
      new ActionRowBuilder().addComponents(notificationInput),
      new ActionRowBuilder().addComponents(welcomeInput)
    );

    await interaction.showModal(modal);
  },

  async handleModal(interaction) {
    if (interaction.customId !== 'setup_modal') return;

    const roleId = interaction.fields.getTextInputValue('setup_role_id')?.trim() || '';
    const channelId = interaction.fields.getTextInputValue('setup_channel_id')?.trim() || '';
    const welcomeRaw = interaction.fields.getTextInputValue('setup_welcome')?.trim().toLowerCase() || 'yes';
    const welcomeMessage = welcomeRaw === 'yes' || welcomeRaw === 'true';

    if (roleId && !/^\d{17,20}$/.test(roleId)) {
      return interaction.reply({ embeds: [errorEmbed('Invalid role ID. It must be a 17-20 digit number.')], ephemeral: true });
    }

    if (channelId && !/^\d{17,20}$/.test(channelId)) {
      return interaction.reply({ embeds: [errorEmbed('Invalid channel ID. It must be a 17-20 digit number.')], ephemeral: true });
    }

    setGuildConfig(interaction.guildId, {
      roleId: roleId || null,
      channelId: channelId || null,
      welcomeMessage,
      setupComplete: true,
      setupBy: interaction.user.id,
      guildName: interaction.guild.name,
    });

    const embed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle('✅ Setup Complete')
      .addFields(
        { name: 'Role Restriction', value: roleId ? `<@&${roleId}>` : 'None (public)', inline: true },
        { name: 'Notification Channel', value: channelId ? `<#${channelId}>` : 'None', inline: true },
        { name: 'Welcome Message', value: welcomeMessage ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Server', value: interaction.guild.name, inline: true }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
