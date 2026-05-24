const { EmbedBuilder } = require('discord.js');

const COLORS = {
  info: 0x4285F4,
  success: 0x34A853,
  warning: 0xFBBC04,
  error: 0xEA4335,
  progress: 0x8E24AA,
};

function fileInfoEmbed(name, sizeKB, mimeType, canDownload) {
  return new EmbedBuilder()
    .setColor(canDownload ? COLORS.success : COLORS.warning)
    .setTitle(name)
    .addFields(
      { name: 'Size', value: `${sizeKB} KB`, inline: true },
      { name: 'Type', value: `\`${mimeType}\``, inline: true },
      {
        name: 'Discord Ready',
        value: canDownload ? '✅ Under 25 MB' : '⚠️ Exceeds 25 MB limit',
        inline: true,
      }
    )
    .setTimestamp();
}

function folderInfoEmbed(name, fileCount, subfolderCount, totalSizeMB, files) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(`📁 ${name}`)
    .addFields(
      { name: 'Files', value: `${fileCount}`, inline: true },
      { name: 'Subfolders', value: `${subfolderCount}`, inline: true },
      { name: 'Total Size', value: `${totalSizeMB} MB`, inline: true }
    );

  if (files.length > 0) {
    const list = files
      .slice(0, 30)
      .map((f) => `• ${f.name} (${(f.size / 1024).toFixed(1)} KB)`)
      .join('\n');

    const suffix = files.length > 30 ? `\n*... and ${files.length - 30} more*` : '';
    embed.addFields({
      name: 'Contents',
      value: (list + suffix).substring(0, 1024),
    });
  }

  embed.setTimestamp();
  return embed;
}

function progressEmbed(current, total, folderName) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const bar = createProgressBar(pct);
  return new EmbedBuilder()
    .setColor(COLORS.progress)
    .setTitle(`📥 Downloading ${folderName}`)
    .setDescription(`${bar} ${current} / ${total} files`);
}

function resultEmbed(downloadedCount, skippedCount) {
  const embed = new EmbedBuilder()
    .setColor(downloadedCount > 0 ? COLORS.success : COLORS.warning)
    .setTitle(downloadedCount > 0 ? '✅ Download Complete' : '⚠️ Download Issues');

  if (downloadedCount > 0) {
    embed.addFields({ name: 'Downloaded', value: `${downloadedCount} file(s)`, inline: true });
  }
  if (skippedCount > 0) {
    embed.addFields({ name: 'Skipped', value: `${skippedCount} file(s)`, inline: true });
  }

  return embed;
}

function errorEmbed(message) {
  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle('❌ Error')
    .setDescription(message)
    .setTimestamp();
}

function autoWatchEmbed(name, info, type) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(`📎 Google Drive ${type === 'folder' ? 'Folder' : 'File'} Detected`)
    .setDescription(`**${name}**`)
    .setTimestamp();

  if (info.totalSize !== undefined) {
    embed.addFields({
      name: 'Contents',
      value: `${info.directFiles} file(s), ${info.subfolders} subfolder(s) — ${(info.totalSize / (1024 * 1024)).toFixed(2)} MB`,
    });
  }

  return embed;
}

function createProgressBar(pct, length = 12) {
  const filled = Math.round((pct / 100) * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

function zipProgressEmbed(current, total) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const bar = createProgressBar(pct);
  return new EmbedBuilder()
    .setColor(COLORS.progress)
    .setTitle('🗜️ Creating ZIP Archive')
    .setDescription(`${bar} ${current} / ${total} files`);
}

module.exports = {
  COLORS,
  fileInfoEmbed,
  folderInfoEmbed,
  progressEmbed,
  resultEmbed,
  errorEmbed,
  autoWatchEmbed,
  zipProgressEmbed,
};
