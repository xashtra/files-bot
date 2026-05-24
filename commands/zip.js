const { SlashCommandBuilder } = require('discord.js');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const { parseDriveLink } = require('../utils/parseLink');
const { createDriveClient } = require('../services/driveClient');
const { downloadFile, enumerateAllFiles } = require('../services/downloader');
const { sendZipFile, getMaxSize } = require('../services/uploader');
const { cleanupFiles } = require('../services/uploader');
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
      return interaction.editReply({ embeds: [errorEmbed('Invalid Google Drive link. Provide a valid folder URL.')] });
    }

    const remaining = checkCooldown(interaction.user.id, 'zip');
    if (remaining > 0) {
      return interaction.editReply({ embeds: [errorEmbed(`Please wait ${remaining}s before using this command again.`)] });
    }

    try {
      const drive = await createDriveClient();
      const maxSize = getMaxSize(interaction);

      if (parsed.type === 'file') {
        const info = await drive.files.get({
          fileId: parsed.id,
          fields: 'id, name, mimeType, size',
        });
        const { name, mimeType, size } = info.data;
        const fileSize = parseInt(size || '0', 10);

        if (fileSize > maxSize) {
          return interaction.editReply({
            embeds: [errorEmbed(`**${name}** exceeds the server's ${(maxSize / (1024 * 1024)).toFixed(0)} MB upload limit.`)],
          });
        }

        const result = await downloadFile(drive, parsed.id, name, mimeType, fileSize, maxSize);
        if (result.skipped) {
          return interaction.editReply({ embeds: [errorEmbed(`**${name}** — ${result.reason}`)] });
        }

        const zipPath = path.join(TEMP_DIR, `${sanitizeFileName(name)}.zip`);
        await createZip(zipPath, [result], (current, total) => {
          interaction.editReply({ embeds: [zipProgressEmbed(current, total)] }).catch(() => {});
        });

        await sendZipFile(interaction, zipPath, 1, 0);
        cleanupFiles([result.path]);
        return;
      }

      const folderInfo = await drive.files.get({ fileId: parsed.id, fields: 'name' });
      const folderName = folderInfo.data.name;

      await interaction.editReply({ embeds: [progressEmbed(0, 0, folderName)] });

      const allFiles = await enumerateAllFiles(drive, parsed.id);
      if (allFiles.length === 0) {
        return interaction.editReply({ embeds: [errorEmbed('No files found in this folder.')] });
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
        return interaction.editReply({ embeds: [errorEmbed('No files could be downloaded to zip.')] });
      }

      const zipPath = path.join(TEMP_DIR, `${sanitizeFileName(folderName)}.zip`);
      await createZip(zipPath, downloaded, (current, total) => {
        interaction.editReply({ embeds: [zipProgressEmbed(current, total)] }).catch(() => {});
      });

      await sendZipFile(interaction, zipPath, downloaded.length, skipped.length);
      cleanupFiles(downloaded.map((f) => f.path));
    } catch (err) {
      const status = err?.response?.status;
      if (status === 403 || status === 404) {
        return interaction.editReply({
          embeds: [errorEmbed('Cannot access the folder. Make sure the service account email has been granted access.')],
        });
      }
      console.error('Zip command error:', err);
      return interaction.editReply({ embeds: [errorEmbed('An unexpected error occurred.')] });
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
