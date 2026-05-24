const { AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { errorEmbed } = require('../utils/embeds');

const MAX_ATTACHMENTS_PER_MESSAGE = 10;

function getMaxSize(interaction) {
  const tier = interaction.guild?.premiumTier ?? 0;
  if (tier === 2) return 100 * 1024 * 1024;
  if (tier === 1) return 50 * 1024 * 1024;
  return 25 * 1024 * 1024;
}

const BATCH_SIZE = 10;

async function sendBatch(interaction, files, isFirstBatch) {
  const attachments = files.map((f) => new AttachmentBuilder(f.path, { name: f.name }));
  try {
    if (isFirstBatch) {
      await interaction.editReply({ files: attachments });
    } else {
      await interaction.followUp({ files: attachments });
    }
  } catch (err) {
    if (err?.code === 10062 || err?.status === 404) {
      await interaction.channel?.send({ files: attachments }).catch(() => {});
    }
  }
  cleanupFiles(files.map((f) => f.path));
}

async function sendSingleFile(interaction, file, isFirst) {
  await sendBatch(interaction, [file], isFirst);
}

async function sendFiles(interaction, downloaded, skipped) {
  let failed = [...skipped];
  const batches = [];
  for (let i = 0; i < downloaded.length; i += BATCH_SIZE) {
    batches.push(downloaded.slice(i, i + BATCH_SIZE));
  }

  for (let i = 0; i < batches.length; i++) {
    try {
      await sendBatch(interaction, batches[i], i === 0);
    } catch {
      for (const file of batches[i]) {
        failed.push({ name: file.name, size: file.size, reason: 'upload failed' });
      }
    }
  }

  const sent = downloaded.length - (failed.length - skipped.length);
  if (sent === 0) {
    let reasonList = failed.map((s) => `• **${s.name}** — ${s.reason}`).join('\n');
    if (reasonList.length > 3900) {
      reasonList = reasonList.substring(0, 3900) + `\n*... and ${failed.length} skipped*`;
    }
    try {
      await interaction.editReply({
        embeds: [errorEmbed(`No files could be uploaded.\n${reasonList}`)],
      });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 15000);
    } catch {
      const errMsg = await interaction.channel?.send({
        embeds: [errorEmbed(`No files could be uploaded.\n${reasonList}`)],
      }).catch(() => {});
      if (errMsg) setTimeout(() => errMsg.delete().catch(() => {}), 15000);
    }
  }
}

async function sendZipFile(interaction, zipPath, downloadedCount, skippedCount) {
  const stat = fs.statSync(zipPath);
  const maxSize = getMaxSize(interaction);

  if (stat.size > maxSize) {
    cleanupFiles([zipPath]);
    await interaction.editReply({
      embeds: [errorEmbed(`ZIP file (${(stat.size / (1024 * 1024)).toFixed(2)} MB) exceeds the server's upload limit.`)],
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 15000);
    return;
  }

  const attachment = new AttachmentBuilder(zipPath, { name: path.basename(zipPath) });

  await interaction.editReply({
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

module.exports = { sendFiles, sendBatch, sendSingleFile, sendZipFile, cleanupFiles, getMaxSize, MAX_ATTACHMENTS_PER_MESSAGE };
