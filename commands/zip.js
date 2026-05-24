const { SlashCommandBuilder } = require('discord.js');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const { parseDriveLink } = require('../utils/parseLink');
const { createDriveClient } = require('../services/driveClient');
const { downloadFile, enumerateAllFiles, getFileInfo, getFolderInfo } = require('../services/downloader');
const { sendZipFile, getMaxSize, cleanupFiles } = require('../services/uploader');
const { progressEmbed, zipProgressEmbed, errorEmbed } = require('../utils/embeds');
const { setCooldown, checkCooldown } = require('../utils/cooldown');
const { checkPermission } = require('../utils/permissions');

const TEMP_DIR = path.resolve(__dirname, '..', 'temp');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('zip')
    .setDescription('Download files from a Drive folder and send as a single ZIP')
    .addStringOption((option) =>
      option.setName('link').setDescription('Google Drive folder URL').setRequired(true)
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
      await interaction.editReply({ embeds: [errorEmbed('Invalid Google Drive link. Provide a valid folder URL.')] });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 15000);
      return;
    }

    const remaining = checkCooldown(interaction.user.id, 'zip');
    if (remaining > 0) {
      await interaction.editReply({ embeds: [errorEmbed(`Please wait ${remaining}s before using this command again.`)] });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 15000);
      return;
    }

    try {
      const drive = await createDriveClient();
      const maxSize = getMaxSize(interaction);

      if (parsed.type === 'file') {
        const info = await getFileInfo(drive, parsed.id);
        const fileSize = info.size;

        if (fileSize > maxSize) {
          await interaction.editReply({
            embeds: [errorEmbed(`**${info.name}** exceeds the server's ${(maxSize / (1024 * 1024)).toFixed(0)} MB upload limit.`)],
          });
          setTimeout(() => interaction.deleteReply().catch(() => {}), 15000);
          return;
        }

        const result = await downloadFile(drive, parsed.id, info.name, info.mimeType, fileSize, maxSize);
        if (result.skipped) {
          await interaction.editReply({ embeds: [errorEmbed(`**${info.name}** — ${result.reason}`)] });
          setTimeout(() => interaction.deleteReply().catch(() => {}), 15000);
          return;
        }

        const zipPath = path.join(TEMP_DIR, `${sanitizeFileName(info.name)}.zip`);
        await createZip(zipPath, [result], (current, total) => {
          interaction.editReply({ embeds: [zipProgressEmbed(current, total)] }).catch(() => {});
        });

        await sendZipFile(interaction, zipPath, 1, 0);
        cleanupFiles([result.path]);
        return;
      }

      const folderInfo = await getFolderInfo(drive, parsed.id);
      const folderName = folderInfo.name;

      await interaction.editReply({ embeds: [progressEmbed(0, 0, folderName)] });

      const allFiles = await enumerateAllFiles(drive, parsed.id);
      if (allFiles.length === 0) {
        await interaction.editReply({ embeds: [errorEmbed('No files found in this folder.')] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 15000);
        return;
      }

      setCooldown(interaction.user.id, 'zip', 60000);

      let downloaded = [];
      let skipped = [];
      let count = 0;

      for (const file of allFiles) {
        const size = parseInt(file.size || '0', 10);
        const result = await downloadFile(drive, file.id, file.name, file.mimeType, size, maxSize);
        if (result.skipped) {
          skipped.push(result);
        } else {
          downloaded.push(result);
        }
        count++;
        await interaction.editReply({ embeds: [progressEmbed(count, allFiles.length, folderName)] }).catch(() => {});
      }

      if (downloaded.length === 0) {
        await interaction.editReply({ embeds: [errorEmbed('No files could be downloaded to zip.')] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 15000);
        return;
      }

      const zipPath = path.join(TEMP_DIR, `${sanitizeFileName(folderName)}.zip`);
      await createZip(zipPath, downloaded, (current, total) => {
        interaction.editReply({ embeds: [zipProgressEmbed(current, total)] }).catch(() => {});
      });

      await sendZipFile(interaction, zipPath, downloaded.length, skipped.length);
      cleanupFiles(downloaded.map((f) => f.path));
    } catch (err) {
      console.error('Zip command error:', err);
      await interaction.editReply({ embeds: [errorEmbed('An unexpected error occurred. Make sure the file/folder is publicly shared.')] });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 15000);
    }
  },
};

function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 200);
}

function createZip(zipPath, files, onProgress) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(output);

    let added = 0;
    const total = files.length;

    for (const file of files) {
      archive.file(file.path, { name: file.name });
      added++;
      if (onProgress) onProgress(added, total);
    }

    archive.finalize();
  });
}
