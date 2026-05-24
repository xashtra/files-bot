const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { parseDriveLink } = require('../utils/parseLink');
const { createDriveClient } = require('../services/driveClient');
const { downloadFile, getFolderInfo, getFileInfo } = require('../services/downloader');
const { sendFiles, sendSingleFile, getMaxSize } = require('../services/uploader');
const { progressEmbed, errorEmbed, fileInfoEmbed, folderInfoEmbed } = require('../utils/embeds');
const { setCooldown, checkCooldown } = require('../utils/cooldown');
const { checkPermission } = require('../utils/permissions');

const CONFIRM_THRESHOLD = 5;
const COLLECTOR_TIMEOUT = 30000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('drive')
    .setDescription('Download files from a Google Drive link')
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
      return interaction.editReply({ embeds: [errorEmbed('Invalid Google Drive link. Provide a valid file or folder URL.')] });
    }

    const cooldownKey = parsed.type === 'folder' ? 'drive_folder' : 'drive';
    const remaining = checkCooldown(interaction.user.id, cooldownKey);
    if (remaining > 0) {
      return interaction.editReply({ embeds: [errorEmbed(`Please wait ${remaining}s before using this command again.`)] });
    }

    try {
      const drive = await createDriveClient();
      const maxSize = getMaxSize(interaction);

      if (parsed.type === 'file') {
        setCooldown(interaction.user.id, 'drive', 3000);
        await handleFile(interaction, drive, parsed.id, maxSize);
      } else if (parsed.type === 'folder') {
        const info = await getFolderInfo(drive, parsed.id);

        if (info.directFiles + info.subfolders === 0) {
          return interaction.editReply({ embeds: [errorEmbed('This folder is empty.')] });
        }

        const embed = folderInfoEmbed(info.name, info.directFiles, info.subfolders, (info.totalSize / (1024 * 1024)).toFixed(2), info.files);
        embed.setDescription(`**${info.name}** — ${info.directFiles} file(s) in ${info.subfolders + 1} folder(s)`);

        if (info.directFiles >= CONFIRM_THRESHOLD) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`confirm_folder:${parsed.id}`).setLabel(`Download ${info.directFiles} files`).setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('cancel_folder').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
          );

          await interaction.editReply({ embeds: [embed], components: [row] });

          const collected = await interaction.channel.awaitMessageComponent({
            filter: (i) => i.user.id === interaction.user.id && i.message.interaction?.id === interaction.id,
            time: COLLECTOR_TIMEOUT,
          }).catch(() => null);

          if (!collected || collected.customId === 'cancel_folder') {
            if (collected && !collected.deferred && !collected.replied) {
              await collected.deferUpdate();
            }
            return interaction.editReply({ embeds: [embed], components: [] });
          }

          if (!collected.deferred && !collected.replied) {
            await collected.deferUpdate();
          }
          setCooldown(interaction.user.id, 'drive_folder', 30000);
          await handleFolder(interaction, drive, parsed.id, maxSize);
        } else {
          setCooldown(interaction.user.id, 'drive_folder', 30000);
          await interaction.editReply({ embeds: [embed] });
          await handleFolder(interaction, drive, parsed.id, maxSize);
        }
      }
    } catch (err) {
      console.error('Drive command error:', err);
      return interaction.editReply({ embeds: [errorEmbed('An unexpected error occurred. Make sure the file/folder is publicly shared.')] });
    }
  },
};

async function handleFile(interaction, drive, fileId, maxSize) {
  const info = await getFileInfo(drive, fileId);
  const { name, mimeType, size: fileSize } = info;

  const sizeKB = (fileSize / 1024).toFixed(1);
  const canDownload = fileSize <= maxSize;

  await interaction.editReply({ embeds: [fileInfoEmbed(name, sizeKB, mimeType, canDownload)] });

  if (!canDownload) return;

  const result = await downloadFile(drive, fileId, name, mimeType, fileSize, maxSize);
  if (result.skipped) {
    return interaction.editReply({ embeds: [errorEmbed(`**${name}** — ${result.reason}`)] });
  }

  await sendFiles(interaction, [result], []);
}

async function handleFolder(interaction, drive, folderId, maxSize) {
  const info = await getFolderInfo(drive, folderId);
  const name = info.name;
  const files = info.files;

  if (files.length === 0) {
    return interaction.editReply({ embeds: [errorEmbed('No files found in this folder.')] });
  }

  await interaction.editReply({ embeds: [progressEmbed(0, files.length, name)] });

  let sent = 0;
  let skipped = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    await interaction.editReply({ embeds: [progressEmbed(i + 1, files.length, name)] }).catch(() => {});

    const result = await downloadFile(drive, file.id, file.name, file.mimeType, parseInt(file.size || '0', 10), maxSize);
    if (result.skipped) {
      skipped.push(result);
    } else {
      try {
        await sendSingleFile(interaction, result, sent === 0 && i === 0);
        sent++;
      } catch (err) {
        skipped.push({ name: file.name, size: file.size, reason: 'upload failed' });
      }
    }
  }

  if (sent === 0) {
    await interaction.editReply({ embeds: [errorEmbed('No files could be downloaded.')] });
  }
}
