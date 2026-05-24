const { SlashCommandBuilder } = require('discord.js');
const { parseDriveLink } = require('../utils/parseLink');
const { createDriveClient } = require('../services/driveClient');
const { getFileInfo, getFolderInfo } = require('../services/downloader');
const { fileInfoEmbed, folderInfoEmbed, errorEmbed } = require('../utils/embeds');
const { checkPermission } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('drive-info')
    .setDescription('Preview a Google Drive link before downloading')
    .addStringOption((option) =>
      option.setName('link').setDescription('Google Drive file or folder URL').setRequired(true)
    ),

  async execute(interaction) {
    const allowed = await checkPermission(interaction);
    if (!allowed) {
      return interaction.reply({
        embeds: [errorEmbed('You do not have permission to use this command.')],
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    const link = interaction.options.getString('link');
    const parsed = parseDriveLink(link);

    if (!parsed) {
      await interaction.editReply({ embeds: [errorEmbed('Invalid Google Drive link.')] });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 15000);
      return;
    }

    try {
      const drive = await createDriveClient();

      if (parsed.type === 'file') {
        const info = await getFileInfo(drive, parsed.id);
        const sizeKB = (info.size / 1024).toFixed(1);
        const canDownload = info.size <= 25 * 1024 * 1024;

        await interaction.editReply({
          embeds: [fileInfoEmbed(info.name, sizeKB, info.mimeType, canDownload)],
        });
      } else if (parsed.type === 'folder') {
        const info = await getFolderInfo(drive, parsed.id);
        const totalSizeMB = (info.totalSize / (1024 * 1024)).toFixed(2);

        await interaction.editReply({
          embeds: [folderInfoEmbed(info.name, info.directFiles, info.subfolders, totalSizeMB, info.files)],
        });
      }
    } catch (err) {
      console.error('Drive-info command error:', err);
      await interaction.editReply({ embeds: [errorEmbed('An unexpected error occurred. Make sure the file/folder is publicly shared.')] });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 15000);
    }
  },
};
