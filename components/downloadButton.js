const { createDriveClient } = require('../services/driveClient');
const { downloadFile, getFileInfo, getFolderInfo } = require('../services/downloader');
const { sendFiles, sendBatch, getMaxSize } = require('../services/uploader');
const { progressEmbed, loadingEmbed, errorEmbed } = require('../utils/embeds');
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
  await interaction.editReply({ embeds: [loadingEmbed('⏳ Starting download...')] }).catch(() => {});
  setCooldown(interaction.user.id, cooldownKey, type === 'folder' ? 30000 : 3000);

  try {
    const drive = await createDriveClient();
    const maxSize = getMaxSize(interaction);

    if (type === 'file') {
      const info = await getFileInfo(drive, id);
      const fileSize = info.size;

      if (fileSize > maxSize) {
        await interaction.message.delete().catch(() => {});
        await interaction.editReply({
          embeds: [errorEmbed(`**${info.name}** exceeds the server's ${(maxSize / (1024 * 1024)).toFixed(0)} MB upload limit.`)],
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 15000);
        return;
      }

      const result = await downloadFile(drive, id, info.name, info.mimeType, fileSize, maxSize);
      if (result.skipped) {
        await interaction.message.delete().catch(() => {});
        await interaction.editReply({ embeds: [errorEmbed(`**${info.name}** — ${result.reason}`)] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 15000);
        return;
      }
      await sendFiles(interaction, [result], []);
    } else if (type === 'folder') {
      const info = await getFolderInfo(drive, id);
      const name = info.name;
      const files = info.files;

      if (files.length === 0) {
        await interaction.message.delete().catch(() => {});
        await interaction.editReply({ embeds: [errorEmbed('No files found in this folder.')] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 15000);
        return;
      }

      await interaction.editReply({ embeds: [progressEmbed(0, files.length, name)] });

      let skipped = [];
      let batch = [];
      let batchIndex = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await interaction.editReply({ embeds: [progressEmbed(i + 1, files.length, name)] }).catch(() => {});

        const result = await downloadFile(drive, file.id, file.name, file.mimeType, parseInt(file.size || '0', 10), maxSize);
        if (result.skipped) {
          skipped.push(result);
        } else {
          batch.push(result);
        }

        if (batch.length === 10 || (i === files.length - 1 && batch.length > 0)) {
          try {
            await sendBatch(interaction, batch, batchIndex === 0);
            batchIndex++;
          } catch {
            for (const f of batch) {
              skipped.push({ name: f.name, size: f.size, reason: 'upload failed' });
            }
          }
          batch = [];
        }
      }

      if (batchIndex === 0 && skipped.length > 0) {
        await interaction.message.delete().catch(() => {});
        await interaction.editReply({ embeds: [errorEmbed('No files could be downloaded.')] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 15000);
      }
    }
    await interaction.message.delete().catch(() => {});
  } catch (err) {
    console.error('Download button error:', err);
    await interaction.editReply({ embeds: [errorEmbed('An unexpected error occurred. Make sure the file/folder is publicly shared.')] });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 15000);
  }
}

module.exports = { handleDownloadButton };
