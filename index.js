require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client, Collection, Events, GatewayIntentBits, REST, Routes, EmbedBuilder } = require('discord.js');

const ALLOWED_GUILD_ID = process.env.ALLOWED_GUILD_ID;
if (!ALLOWED_GUILD_ID) {
  console.error('❌ ALLOWED_GUILD_ID is not set. Set it to your Discord server ID.');
  process.exit(1);
}
const { parseDriveLink } = require('./utils/parseLink');
const { createDriveClient } = require('./services/driveClient');
const { getFileInfo, getFolderInfo } = require('./services/downloader');
const { autoWatchEmbed, errorEmbed } = require('./utils/embeds');
const { handleDownloadButton } = require('./components/downloadButton');
const { checkMessagePermission } = require('./utils/permissions');
const { isSetupComplete } = require('./services/configStore');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));

const commands = [];
for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
    commands.push(command.data.toJSON());
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    console.log('🔄 Registering commands...');
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
    console.log(`✅ Registered ${commands.length} command(s).`);

    const googleOk = !!(process.env.GOOGLE_CREDENTIALS_PATH || process.env.GOOGLE_CREDENTIALS_JSON);
    if (!googleOk) {
      console.warn('⚠️  Google credentials not set. Set GOOGLE_CREDENTIALS_PATH or GOOGLE_CREDENTIALS_JSON.');
    }

    for (const guild of c.guilds.cache.values()) {
      if (!isSetupComplete(guild.id)) {
        try {
          await sendSetupNotice(guild);
          await new Promise((r) => setTimeout(r, 1000));
        } catch {
        }
      }
    }
  } catch (err) {
    console.error('Failed to register commands:', err);
  }

  for (const guild of c.guilds.cache.values()) {
    if (guild.id !== ALLOWED_GUILD_ID) {
      console.log(`Leaving unallowed guild: ${guild.name} (${guild.id})`);
      await guild.leave().catch(() => {});
    }
  }
});

client.on(Events.GuildCreate, async (guild) => {
  if (guild.id !== ALLOWED_GUILD_ID) {
    await guild.leave().catch(() => {});
    return;
  }
  if (!isSetupComplete(guild.id)) {
    try {
      await sendSetupNotice(guild);
    } catch {
    }
  }
});

async function sendSetupNotice(guild) {
  const cfg = require('./services/configStore').getGuildConfig(guild.id);
  let channel = null;

  if (cfg?.channelId) {
    channel = guild.channels.cache.get(cfg.channelId);
  }
  if (!channel) {
    channel = guild.systemChannel;
  }
  if (!channel) {
    channel = guild.channels.cache
      .filter((c) => c.isTextBased && c.permissionsFor(guild.members.me).has('SendMessages'))
      .first();
  }
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0x4285F4)
    .setTitle('🚀 Google Drive Downloader Bot')
    .setDescription(
      'Thanks for adding me! To start using the bot, an admin needs to run `/setup`.\n\n' +
      '**Quick start:**\n' +
      '1. Run `/setup` to configure role restrictions\n' +
      '2. Make sure Google credentials are set in Railway env vars\n' +
      '3. Share your Drive folders/files with the service account email\n' +
      '4. Use `/drive <link>` to download files'
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] });
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.inGuild() && interaction.guildId !== ALLOWED_GUILD_ID) {
    return interaction.reply({ content: 'This bot is not configured for this server.', ephemeral: true });
  }

  if (interaction.isChatInputCommand() || interaction.isMessageContextMenuCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`Error executing ${interaction.commandName}:`, err);
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: '❌ An error occurred.', ephemeral: true });
      } else {
        await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
      }
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    const command = client.commands.get('setup');
    if (command?.handleModal) {
      await command.handleModal(interaction);
    }
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('drive_download:')) {
      await handleDownloadButton(interaction);
      return;
    }
    if (interaction.customId === 'cancel_folder' || interaction.customId.startsWith('confirm_folder:')) {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(() => {});
      }
      return;
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.guildId !== ALLOWED_GUILD_ID) return;

  const allowed = await checkMessagePermission(message);
  if (!allowed) return;

  const parsed = parseDriveLink(message.content);
  if (!parsed) return;

  try {
    const drive = await createDriveClient();

    let info;
    if (parsed.type === 'file') {
      info = await getFileInfo(drive, parsed.id);
      const size = parseInt(info.size || '0', 10);
      info.totalSize = size;
    } else {
      info = await getFolderInfo(drive, parsed.id);
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`drive_download:${parsed.type}:${parsed.id}`)
        .setLabel(parsed.type === 'folder' ? 'Download Folder' : 'Download File')
        .setStyle(ButtonStyle.Primary)
    );

    await message.reply({
      embeds: [autoWatchEmbed(info.name || 'Unknown', info, parsed.type)],
      components: [row],
    });
  } catch (err) {
    if (err?.response?.status === 403 || err?.response?.status === 404) return;
    console.error('Auto-watch error:', err);
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ DISCORD_TOKEN is not set.');
  console.error('   For Railway: set DISCORD_TOKEN in Railway dashboard → Variables');
  process.exit(1);
}

client.login(token);
