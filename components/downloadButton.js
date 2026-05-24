const { createDriveClient } = require('../services/driveClient');
const { downloadFile, downloadAll } = require('../services/downloader');
const { sendFiles, getMaxSize } = require('../services/uploader');
const { progressEmbed, errorEmbed } = require('../utils/embeds');
const { setCooldown, checkCooldown } = require('../utils/cooldown');
const { checkPermission } = require('../utils/permissions');

async function handleDownloadButton(interaction) {
  const [action, type, id] = interaction.customId.split(':');
  if (action !== 'drive_download') return;

  const allowed = await checkPermission(interaction);
  if (!allowed) {
    return interaction.reply({
      embeds: [errorEmbed('You do not have permission to download files.')],
      ephemeral: true,
    });
  }

  const cooldownKey = type === 'folder' ? 'drive_folder' : 'drive';
  const cooldown = checkCooldown(interaction.user.id, cooldownKey);
  if (cooldown > 0) {
    return interaction.reply({ embeds: [errorEmbed(`Please wait ${cooldown}s before using this again.`)], ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: false });
  setCooldown(interaction.user.id, cooldownKey, type === 'folder' ? 30000 : 3000);

  try {
    const drive = await createDriveClient();
    const maxSize = getMaxSize(interaction);

    if (type === 'file') {
      const info = await drive.files.get({
        fileId: id,
        fields: 'id, name, mimeType, size',
      });
      const { name, mimeType, size } = info.data;
      const fileSize = parseInt(size || '0', 10);

      if (fileSize > maxSize) {
        return interaction.editReply({
          embeds: [errorEmbed(`**${name}** exceeds the server's ${(maxSize / (1024 * 1024)).toFixed(0)} MB upload limit.`)],
        });
      }

      const result = await downloadFile(drive, id, name, mimeType, fileSize, maxSize);
      if (result.skipped) {
        return interaction.editReply({ embeds: [errorEmbed(`**${name}** — ${result.reason}`)] });
      }
      await sendFiles(interaction, [result], []);
    } else if (type === 'folder') {
      const folderInfo = await drive.files.get({ fileId: id, fields: 'name' });
      const name = folderInfo.data.name;

      const progressMsg = await interaction.editReply({ embeds: [progressEmbed(0, 0, name)] });

      const results = await downloadAll(drive, id, maxSize, (current, total) => {
        progressMsg.edit({ embeds: [progressEmbed(current, total, name)] }).catch(() => {});
      });

      await sendFiles(interaction, results.downloaded, results.skipped);
    }
  } catch (err) {
    const status = err?.response?.status;
    if (status === 403 || status === 404) {
      return interaction.editReply({
        embeds: [errorEmbed('Cannot access the file/folder. Make sure the service account email has been granted access.')],
      });
    }
    console.error('Download button error:', err);
    return interaction.editReply({ embeds: [errorEmbed('An unexpected error occurred.')] });
  }
}

module.exports = { handleDownloadButton };
