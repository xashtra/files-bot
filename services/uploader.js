const { AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { resultEmbed, errorEmbed } = require('../utils/embeds');

const MAX_ATTACHMENTS_PER_MESSAGE = 10;

function getMaxSize(interaction) {
  const tier = interaction.guild?.premiumTier ?? 0;
  if (tier === 2) return 100 * 1024 * 1024;
  if (tier === 1) return 50 * 1024 * 1024;
  return 25 * 1024 * 1024;
}

async function sendFiles(interaction, downloaded, skipped) {
  const batches = [];
  for (let i = 0; i < downloaded.length; i += MAX_ATTACHMENTS_PER_MESSAGE) {
    batches.push(downloaded.slice(i, i + MAX_ATTACHMENTS_PER_MESSAGE));
  }

  let sentCount = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const attachments = batch.map((f) => new AttachmentBuilder(f.path, { name: f.name }));

    if (i === 0 && sentCount === 0) {
      await interaction.editReply({
        embeds: [resultEmbed(downloaded.length, skipped.length)],
        files: attachments,
      });
    } else {
      await interaction.followUp({ files: attachments });
    }
    sentCount += batch.length;
  }

  if (downloaded.length === 0) {
    const reasonList = skipped.map((s) => `• **${s.name}** — ${s.reason}`).join('\n');
    await interaction.editReply({
      embeds: [errorEmbed(`No files could be downloaded.\n${reasonList}`)],
    });
  }

  cleanupFiles(downloaded.map((f) => f.path));
}

async function sendZipFile(interaction, zipPath, downloadedCount, skippedCount) {
  const stat = fs.statSync(zipPath);
  const maxSize = getMaxSize(interaction);

  if (stat.size > maxSize) {
    cleanupFiles([zipPath]);
    return interaction.editReply({
      embeds: [errorEmbed(`ZIP file (${(stat.size / (1024 * 1024)).toFixed(2)} MB) exceeds the server's upload limit.`)],
    });
  }

  const attachment = new AttachmentBuilder(zipPath, { name: path.basename(zipPath) });

  await interaction.editReply({
    embeds: [resultEmbed(downloadedCount, skippedCount)],
    files: [attachment],
  });

  cleanupFiles([zipPath]);
}

function cleanupFiles(paths) {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
    }
  }
}

module.exports = { sendFiles, sendZipFile, cleanupFiles, getMaxSize, MAX_ATTACHMENTS_PER_MESSAGE };
