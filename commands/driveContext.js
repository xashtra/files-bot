const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const { parseDriveLink } = require('../utils/parseLink');
const { createDriveClient } = require('../services/driveClient');
const { downloadFile, downloadAll, getFileInfo, getFolderInfo } = require('../services/downloader');
const { sendFiles, getMaxSize } = require('../services/uploader');
const { progressEmbed, errorEmbed } = require('../utils/embeds');
const { setCooldown, checkCooldown } = require('../utils/cooldown');
const { checkPermission } = require('../utils/permissions');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Download from Drive')
    .setType(ApplicationCommandType.Message),

  async execute(interaction) {
    const allowed = await checkPermission(interaction);
    if (!allowed) {
      return interaction.reply({
        embeds: [errorEmbed('You do not have permission to use this command.')],
        ephemeral: true,
      });
    }

    const message = interaction.targetMessage;
    const content = message.content || '';
    const parsed = parseDriveLink(content);

    if (!parsed) {
      return interaction.reply({ embeds: [errorEmbed('No Google Drive link found in that message.')], ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: false });

    const cooldownKey = parsed.type === 'folder' ? 'drive_folder' : 'drive';
    const remaining = checkCooldown(interaction.user.id, cooldownKey);
    if (remaining > 0) {
      return interaction.editReply({ embeds: [errorEmbed(`Please wait ${remaining}s.`)] });
    }

    try {
      const drive = await createDriveClient();
      const maxSize = getMaxSize(interaction);

      if (parsed.type === 'file') {
        setCooldown(interaction.user.id, 'drive', 3000);
        await handleContextFile(interaction, drive, parsed.id, maxSize);
      } else {
        setCooldown(interaction.user.id, 'drive_folder', 30000);
        await handleContextFolder(interaction, drive, parsed.id, maxSize);
      }
    } catch (err) {
      console.error('Context drive error:', err);
      return interaction.editReply({ embeds: [errorEmbed('An unexpected error occurred. Make sure the file/folder is publicly shared.')] });
    }
  },
};

async function handleContextFile(interaction, drive, fileId, maxSize) {
  const info = await getFileInfo(drive, fileId);
  const { name, size: fileSize } = info;

  if (fileSize > maxSize) {
    return interaction.editReply({ embeds: [errorEmbed(`**${name}** exceeds the server's ${(maxSize / (1024 * 1024)).toFixed(0)} MB limit.`)] });
  }

  const result = await downloadFile(drive, fileId, name, info.mimeType, fileSize, maxSize);
  if (result.skipped) {
    return interaction.editReply({ embeds: [errorEmbed(`**${name}** — ${result.reason}`)] });
  }

  await sendFiles(interaction, [result], []);
}

async function handleContextFolder(interaction, drive, folderId, maxSize) {
  const info = await getFolderInfo(drive, folderId);
  const name = info.name;

  const progressMsg = await interaction.editReply({ embeds: [progressEmbed(0, 0, name)] });

  const results = await downloadAll(drive, folderId, maxSize, (current, total) => {
    progressMsg.edit({ embeds: [progressEmbed(current, total, name)] }).catch(() => {});
  });

  await sendFiles(interaction, results.downloaded, results.skipped);
}
