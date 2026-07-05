const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Discord Bot Online! 🚀');
});

app.listen(port, () => {
    console.log(`🌐 Web server running on port: ${port}`);
});

const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    EmbedBuilder, ChannelType, PermissionFlagsBits, RoleSelectMenuBuilder, 
    ChannelSelectMenuBuilder, StringSelectMenuBuilder, ModalBuilder, 
    TextInputBuilder, TextInputStyle, AuditLogEvent 
} = require('discord.js');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// ===================== CHECK TOKEN =====================
const BOT_TOKEN = process.env.DISCORD_TOKEN;
if (!BOT_TOKEN) {
    console.error('❌ DISCORD_TOKEN is missing! Add it to Railway Variables');
    process.exit(1);
}

// ===================== FILE-BASED STORAGE =====================
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Load config from file or create default
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading config:', error);
    }
    return {};
}

// Save config to file
function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    } catch (error) {
        console.error('Error saving config:', error);
    }
}

// Get server config with defaults
function getServerConfig(guildId) {
    const allConfigs = loadConfig();
    if (!allConfigs[guildId]) {
        allConfigs[guildId] = {
            prefix: '!',
            staffRoleId: null,
            dashboardRoleId: null,
            ticketCategoryId: null,
            logChannelId: null,
            vouchChannelId: null,
            targetRoleId: null,
            giverRoleId: null,
            intervalTime: 60000,
            running: false,
            whitelists: {}
        };
        saveConfig(allConfigs);
    }
    return allConfigs[guildId];
}

// Update server config
async function updateServerConfig(guildId, updates) {
    const allConfigs = loadConfig();
    if (!allConfigs[guildId]) {
        allConfigs[guildId] = {
            prefix: '!',
            staffRoleId: null,
            dashboardRoleId: null,
            ticketCategoryId: null,
            logChannelId: null,
            vouchChannelId: null,
            targetRoleId: null,
            giverRoleId: null,
            intervalTime: 60000,
            running: false,
            whitelists: {}
        };
    }
    Object.assign(allConfigs[guildId], updates);
    saveConfig(allConfigs);
    return allConfigs[guildId];
}

// ===================== CLIENT INIT - FIXED INTENTS =====================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// ===================== HELPERS =====================
function parseTime(str) {
    if (!str) return null;
    const match = str.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return null;
    const val = parseInt(match[1]);
    const unit = match[2];
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return val * multipliers[unit];
}

async function sendTicketLog(guild, conf, title, description, color) {
    if (!conf.logChannelId) return;
    const logChan = guild.channels.cache.get(conf.logChannelId);
    if (logChan) {
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color)
            .setTimestamp();
        await logChan.send({ embeds: [embed] }).catch(() => {});
    }
}

// ===================== STATE MANAGEMENT =====================
const activeTrades = new Map();
const activeVouchTimers = new Map();
const afkUsers = new Map();

const FAUX_TRADES = [
    "ROBUX: 5000 R$ W/T TAX FOR 20$ LTC",
    "ROBUX: 10k R$ CLEAN FOR 42$ SOL",
    "ROBUX: 2500 R$ AFTER TAX FOR 10$ PAYPAL",
    "BLOX FRUITS: PERM BUDDHA FOR 20$ LTC",
    "BLOX FRUITS: KITSUNE FRUIT FOR 15$ SOL",
    "BLOX FRUITS: PERM DRAGON FOR 35$ BTC",
    "ADOPT ME: FR JUNGLE EGG PET FOR 15$ SOL",
    "ADOPT ME: NFR SHADOW DRAGON FOR 80$ BTC",
    "VALORANT: 2500 VP CARD FOR 15$ PAYPAL",
    "DISCORD: 1 YEAR NITRO BOOST FOR 12$ CARD",
    "STEAM: 50$ GIFT CARD FOR 40$ CRYPTO"
];

// ===================== ANTI-NUKE =====================
async function triggerAntiNuke(guild, executorId, actionType, targetId) {
    if (executorId === guild.ownerId || executorId === client.user.id) return false;
    
    const conf = getServerConfig(guild.id);
    const userWhitelist = conf.whitelists[executorId] || [];
    if (userWhitelist.includes(actionType)) return false;

    let punished = false;
    try {
        await guild.members.ban(executorId, { 
            reason: `Anti-Nuke: Unauthorized ${actionType} action` 
        });
        punished = true;
    } catch(e) {
        console.error(`Failed to ban ${executorId}:`, e);
    }

    const alertEmbed = new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle('🚨 ANTI-NUKE ACTIVATED')
        .addFields(
            { name: 'User', value: `<@${executorId}> (\`${executorId}\`)`, inline: true },
            { name: 'Action', value: `\`${actionType}\``, inline: true },
            { name: 'Target', value: targetId ? `\`${targetId}\`` : 'N/A', inline: true },
            { name: 'Punishment', value: punished ? '✅ Banned' : '⚠️ Failed (Role too low)', inline: false }
        )
        .setTimestamp();

    if (conf.logChannelId) {
        const logChan = guild.channels.cache.get(conf.logChannelId);
        if (logChan) {
            await logChan.send({ 
                content: '@everyone 🛡️ **SECURITY ALERT**', 
                embeds: [alertEmbed] 
            }).catch(() => {});
        }
    }
    return true;
}

// ===================== AUTO-VOUCH =====================
async function generateFakeVouch(guildId) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    
    const conf = getServerConfig(guildId);
    if (!conf.vouchChannelId || !conf.targetRoleId || !conf.giverRoleId) return;
    
    const channel = guild.channels.cache.get(conf.vouchChannelId);
    if (!channel) return;

    try {
        await guild.members.fetch();
        const targets = guild.roles.cache.get(conf.targetRoleId)?.members;
        const givers = guild.roles.cache.get(conf.giverRoleId)?.members;
        
        if (!targets || targets.size === 0 || !givers || givers.size === 0) return;

        const randomTarget = targets.random().user;
        const randomGiver = givers.random().user;
        if (randomTarget.id === randomGiver.id) return;

        const randomTrade = FAUX_TRADES[Math.floor(Math.random() * FAUX_TRADES.length)];
        const embed = new EmbedBuilder()
            .setColor('#EB459E')
            .setTitle('🎫 New Reputation Received')
            .setDescription(
                `**From:** <@${randomGiver.id}>\n` +
                `**To:** <@${randomTarget.id}>\n\n` +
                `📦 **Transaction:** \`${randomTrade}\``
            )
            .setThumbnail(randomGiver.displayAvatarURL({ dynamic: true, size: 256 }))
            .setFooter({ text: 'Cosmic Vouch System' })
            .setTimestamp();

        const btn = new ButtonBuilder()
            .setCustomId('vouch_back_deco')
            .setLabel('🔄 Vouch Back')
            .setStyle(ButtonStyle.Secondary);

        await channel.send({ 
            embeds: [embed], 
            components: [new ActionRowBuilder().addComponents(btn)] 
        });
    } catch (e) {
        console.error('Error generating vouch:', e);
    }
}

function startVouchLoop(guildId) {
    stopVouchLoop(guildId);
    const conf = getServerConfig(guildId);
    const timer = setInterval(() => generateFakeVouch(guildId), conf.intervalTime);
    activeVouchTimers.set(guildId, timer);
}

function stopVouchLoop(guildId) {
    if (activeVouchTimers.has(guildId)) {
        clearInterval(activeVouchTimers.get(guildId));
        activeVouchTimers.delete(guildId);
    }
}

// ===================== DASHBOARD =====================
async function getDashboard(guildId, pageName) {
    const conf = getServerConfig(guildId);
    const embed = new EmbedBuilder().setColor('#2B2D31');
    let components = [];

    const navMenu = new StringSelectMenuBuilder()
        .setCustomId('dash_nav_menu')
        .setPlaceholder('📂 Navigate Dashboard...')
        .addOptions([
            { label: 'Home', value: 'nav_home', emoji: '🏠' },
            { label: 'MM Setup', value: 'nav_mm_setup', emoji: '🤝' },
            { label: 'Vouch Setup', value: 'nav_vouch_setup', emoji: '🎫' },
            { label: 'Settings', value: 'nav_settings', emoji: '⚙️' },
            { label: 'Commands', value: 'nav_cmds', emoji: '📜' }
        ]);
    const navRow = new ActionRowBuilder().addComponents(navMenu);

    switch(pageName) {
        case 'home':
            embed.setTitle('⚙️ Central Control Panel')
                .setDescription(
                    `**Current Prefix:** \`${conf.prefix}\`\n\n` +
                    `**Staff Role:** ${conf.staffRoleId ? `<@&${conf.staffRoleId}>` : '❌ Not Set'}\n` +
                    `**Category:** ${conf.ticketCategoryId ? `<#${conf.ticketCategoryId}>` : '❌ Not Set'}\n` +
                    `**Logs:** ${conf.logChannelId ? `<#${conf.logChannelId}>` : '❌ Not Set'}\n\n` +
                    `**Auto-Vouch Status:** ${conf.running ? '🟢 Running' : '🔴 Stopped'}`
                );
            components = [
                navRow,
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('v_toggle')
                        .setLabel(conf.running ? '🛑 Stop Auto-Vouch' : '🟢 Start Auto-Vouch')
                        .setStyle(conf.running ? ButtonStyle.Danger : ButtonStyle.Success)
                )
            ];
            break;

        case 'mm_setup':
            embed.setTitle('🤝 Middleman Configuration')
                .setDescription('Configure roles and channels for the ticket system.');
            components = [
                navRow,
                new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId('mm_set_staff')
                        .setPlaceholder('Select Staff Role')
                ),
                new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId('mm_set_admin')
                        .setPlaceholder('Select Dashboard Access Role')
                ),
                new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId('mm_set_category')
                        .setPlaceholder('Select Tickets Category')
                        .addChannelTypes(ChannelType.GuildCategory)
                ),
                new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId('mm_set_logs')
                        .setPlaceholder('Select Logs Channel')
                        .addChannelTypes(ChannelType.GuildText)
                )
            ];
            break;

        case 'vouch_setup':
            embed.setTitle('🎫 Vouch Configuration')
                .setDescription(`**Current Interval:** \`${conf.intervalTime / 1000}s\``);
            components = [
                navRow,
                new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId('v_set_target')
                        .setPlaceholder('Role to RECEIVE Vouch')
                ),
                new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId('v_set_giver')
                        .setPlaceholder('Role to GIVE Vouch')
                ),
                new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId('v_set_chan')
                        .setPlaceholder('Vouch Alerts Channel')
                        .addChannelTypes(ChannelType.GuildText)
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('change_vouch_interval')
                        .setLabel('⏱️ Set Interval')
                        .setStyle(ButtonStyle.Primary)
                )
            ];
            break;

        case 'settings':
            embed.setTitle('⚙️ General Settings')
                .setDescription(`**Prefix:** \`${conf.prefix}\``);
            components = [
                navRow,
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('change_prefix')
                        .setLabel('✏️ Change Prefix')
                        .setStyle(ButtonStyle.Primary)
                )
            ];
            break;

        case 'cmds':
            embed.setTitle('📜 Command Directory')
                .setDescription(
                    `**Prefix:** \`${conf.prefix}\`\n\n` +
                    `**🛡️ Moderation**\n` +
                    `> \`${conf.prefix}ban @user\` - Ban a member\n` +
                    `> \`${conf.prefix}unban <id>\` - Unban by ID\n` +
                    `> \`${conf.prefix}kick @user\` - Kick a member\n` +
                    `> \`${conf.prefix}mute @user <time>\` - Timeout\n` +
                    `> \`${conf.prefix}purge <amount>\` - Clear messages\n` +
                    `> \`${conf.prefix}fban @user\` - Fake ban\n\n` +
                    `**🤝 Tickets**\n` +
                    `> \`${conf.prefix}setup-ticket\` - Create ticket button\n` +
                    `> \`${conf.prefix}close\` - Close current ticket\n\n` +
                    `**⚙️ Configuration**\n` +
                    `> \`${conf.prefix}whitelist @user\` - Manage permissions\n` +
                    `> \`${conf.prefix}afk\` - Toggle AFK mode`
                );
            components = [navRow];
            break;
    }

    return { embeds: [embed], components };
}

// ===================== BOT EVENTS =====================
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} is online!`);
    console.log(`📊 Serving ${client.guilds.cache.size} servers`);
    console.log(`💾 Using file-based storage (no database needed!)`);
    
    for (const [guildId] of client.guilds.cache) {
        try {
            const conf = getServerConfig(guildId);
            if (conf && conf.running) {
                startVouchLoop(guildId);
            }
        } catch (err) {
            console.error(`Error starting vouch loop for ${guildId}:`, err);
        }
    }
});

client.on('guildAuditLogEntryCreate', async (auditLog, guild) => {
    const { action, executorId, targetId } = auditLog;
    if (!executorId) return;

    const actionMap = {
        [AuditLogEvent.MemberBanAdd]: 'anti_ban',
        [AuditLogEvent.MemberKick]: 'anti_kick',
        [AuditLogEvent.ChannelDelete]: 'anti_channel_delete',
        [AuditLogEvent.RoleDelete]: 'anti_role_delete'
    };

    const actionType = actionMap[action];
    if (actionType) {
        await triggerAntiNuke(guild, executorId, actionType, targetId);
    }
});

// ===================== MESSAGE HANDLER =====================
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    
    const guildId = message.guild.id;
    const conf = getServerConfig(guildId);
    const prefix = conf.prefix;
    const isPing = message.content === `<@${client.user.id}>`;

    // AFK System
    if (afkUsers.has(message.author.id)) {
        afkUsers.delete(message.author.id);
        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setDescription(`👋 Welcome back ${message.author}, your AFK status has been removed.`);
        const reply = await message.reply({ embeds: [embed] });
        setTimeout(() => reply.delete().catch(() => {}), 5000);
    }

    message.mentions.users.forEach(user => {
        if (afkUsers.has(user.id)) {
            const embed = new EmbedBuilder()
                .setColor('#2B2D31')
                .setDescription(`💤 **${user.username}** is currently AFK.`);
            message.reply({ embeds: [embed] })
                .then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        }
    });

    // Commands
    if (!message.content.startsWith(prefix) && !isPing) return;

    const args = isPing ? [] : message.content.slice(prefix.length).trim().split(/ +/);
    const command = isPing ? 'dashboard' : args.shift().toLowerCase();
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);

    if (command === 'dashboard') {
        const hasDashRole = conf.dashboardRoleId ? 
            message.member.roles.cache.has(conf.dashboardRoleId) : false;
        
        if (!isAdmin && message.author.id !== message.guild.ownerId && !hasDashRole) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ Access Denied.')
                ]
            });
        }

        const dashboardData = await getDashboard(guildId, 'home');
        await message.channel.send(dashboardData);
        return;
    }

    if (command === 'setup-ticket' && isAdmin) {
        const embed = new EmbedBuilder()
            .setColor('#2B2D31')
            .setTitle('🤝 Secure Middleman Services')
            .setDescription('Open a ticket below for secure transactions.');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('create_ticket')
                .setLabel('📩 Request Middleman')
                .setStyle(ButtonStyle.Primary)
        );

        await message.channel.send({ embeds: [embed], components: [row] });
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'close' && message.channel.name.startsWith('mm-')) {
        if (!conf.staffRoleId || !message.member.roles.cache.has(conf.staffRoleId) && !isAdmin) {
            return message.reply('❌ Staff access required.');
        }

        await message.reply({
            embeds: [new EmbedBuilder()
                .setColor('#ED4245')
                .setDescription('🔒 **Closing ticket in 5 seconds...**')
            ]
        });

        await sendTicketLog(message.guild, conf, '🔒 Ticket Closed', 
            `Ticket \`${message.channel.name}\` closed by ${message.author}`, '#ED4245');
        
        activeTrades.delete(message.channel.id);
        setTimeout(() => message.channel.delete().catch(() => {}), 5000);
        return;
    }

    // Moderation Commands
    if (command === 'afk') {
        const embed = new EmbedBuilder()
            .setColor('#2B2D31')
            .setTitle('💤 AFK Mode')
            .setDescription('Do you want to receive DM notifications when mentioned?');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('afk_dm_yes')
                .setLabel('Yes, DM me')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('afk_dm_no')
                .setLabel('No DMs')
                .setStyle(ButtonStyle.Danger)
        );

        await message.reply({ embeds: [embed], components: [row] });
        return;
    }

    if (command === 'purge' && message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        const num = parseInt(args[0]);
        if (isNaN(num) || num < 1 || num > 99) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ Please provide a number between 1 and 99.')
                ]
            });
        }

        await message.channel.bulkDelete(num + 1).then(deleted => {
            message.channel.send({
                embeds: [new EmbedBuilder()
                    .setColor('#2ECC71')
                    .setDescription(`🧹 **Cleared ${deleted.size - 1} messages.**`)
                ]
            }).then(m => setTimeout(() => m.delete().catch(() => {}), 3000));
        }).catch(() => message.reply({
            embeds: [new EmbedBuilder()
                .setColor('#ED4245')
                .setDescription('❌ Cannot delete messages older than 14 days.')
            ]
        }));
        return;
    }

    if (command === 'mute' && message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        const target = message.mentions.members.first();
        if (!target || !args[1]) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription(`❌ **Usage:** \`${prefix}mute @user 10m\``)
                ]
            });
        }

        const msTime = parseTime(args[1]);
        if (!msTime) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ Invalid time format. Use s, m, h, or d.')
                ]
            });
        }

        await target.timeout(msTime, `Muted by ${message.author.tag}`).then(() => {
            message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#FEE75C')
                    .setDescription(`🔇 **${target.user.username}** has been timed out for **${args[1]}**.`)
                ]
            });
        }).catch(() => message.reply({
            embeds: [new EmbedBuilder()
                .setColor('#ED4245')
                .setDescription('❌ Missing permissions or user is too powerful.')
            ]
        }));
        return;
    }

    if (command === 'kick' && message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
        const target = message.mentions.members.first();
        if (!target) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ Mention a user to kick.')
                ]
            });
        }

        const isBlocked = await triggerAntiNuke(message.guild, message.author.id, 'anti_kick', target.id);
        if (isBlocked) return;

        await target.kick(`Kicked by ${message.author.tag}`).then(() => {
            message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#E67E22')
                    .setDescription(`👢 **${target.user.username}** has been kicked.`)
                ]
            });
        }).catch(() => message.reply({
            embeds: [new EmbedBuilder()
                .setColor('#ED4245')
                .setDescription('❌ Missing permissions to kick this user.')
            ]
        }));
        return;
    }

    if (command === 'ban' && message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        const target = message.mentions.members.first();
        if (!target) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ Mention a user to ban.')
                ]
            });
        }

        const isBlocked = await triggerAntiNuke(message.guild, message.author.id, 'anti_ban', target.id);
        if (isBlocked) return;

        await target.ban({ reason: `Banned by ${message.author.tag}` }).then(() => {
            message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription(`🔨 **${target.user.username}** has been banned.`)
                ]
            });
        }).catch(() => message.reply({
            embeds: [new EmbedBuilder()
                .setColor('#ED4245')
                .setDescription('❌ Missing permissions to ban this user.')
            ]
        }));
        return;
    }

    if (command === 'fban' && isAdmin) {
        const target = message.mentions.members.first();
        if (!target) return;

        await message.channel.send({
            embeds: [new EmbedBuilder()
                .setColor('#ED4245')
                .setDescription(`🔨 **${target.user.username}** has been banned (fake).`)
            ]
        });
        await message.delete().catch(() => {});
        return;
    }
});

// ===================== INTERACTION HANDLER =====================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.guild) return;
    
    const guildId = interaction.guild.id;
    const conf = getServerConfig(guildId);
    const user = interaction.user;

    // Modals
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'prefix_modal') {
            const newPrefix = interaction.fields.getTextInputValue('prefix_input');
            await updateServerConfig(guildId, { prefix: newPrefix });
            const dashData = await getDashboard(guildId, 'settings');
            return interaction.update(dashData);
        }

        if (interaction.customId === 'interval_modal') {
            const inputTime = interaction.fields.getTextInputValue('interval_input');
            const ms = parseTime(inputTime);
            if (!ms || ms < 5000) {
                return interaction.reply({ 
                    content: '❌ Invalid format or too short (minimum 5s).', 
                    ephemeral: true 
                });
            }
            
            await updateServerConfig(guildId, { intervalTime: ms });
            const updatedConf = getServerConfig(guildId);
            if (updatedConf.running) startVouchLoop(guildId);
            
            const dashData = await getDashboard(guildId, 'vouch_setup');
            return interaction.update(dashData);
        }

        if (interaction.customId === 'edit_deal_modal') {
            let tradeState = activeTrades.get(interaction.channelId);
            if (!tradeState) {
                return interaction.reply({ 
                    content: '❌ Ticket expired.', 
                    ephemeral: true 
                });
            }
            
            tradeState.dealDetails = interaction.fields.getTextInputValue('deal_text');
            activeTrades.set(interaction.channelId, tradeState);

            const confirmMessage = await interaction.channel.messages
                .fetch(tradeState.confirmationEmbedMessageId)
                .catch(() => null);
                
            if (confirmMessage) {
                const updatedEmbed = EmbedBuilder.from(confirmMessage.embeds[0])
                    .setDescription(
                        `**Terms proposed by <@${tradeState.trader1Id}> (Edited):**\n` +
                        `\`\`\`\n${tradeState.dealDetails}\n\`\`\`\n` +
                        `👉 <@${tradeState.trader2Id}>, verify and confirm.`
                    );
                await confirmMessage.edit({ embeds: [updatedEmbed] });
            }
            
            return interaction.reply({ 
                content: '✅ Deal updated.', 
                ephemeral: true 
            });
        }
    }

    // Select Menus
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'dash_nav_menu') {
            const page = interaction.values[0].replace('nav_', '');
            const dashData = await getDashboard(guildId, page);
            return interaction.update(dashData);
        }
        
        if (interaction.customId.startsWith('wl_menu_')) {
            const targetId = interaction.customId.replace('wl_menu_', '');
            
            if (targetId === user.id && user.id !== interaction.guild.ownerId) {
                return interaction.reply({ 
                    content: '❌ You cannot edit your own whitelist.', 
                    ephemeral: true 
                });
            }
            
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && 
                user.id !== interaction.guild.ownerId) {
                return interaction.reply({ 
                    content: '❌ Admins only.', 
                    ephemeral: true 
                });
            }

            const currentConfig = getServerConfig(guildId);
            currentConfig.whitelists[targetId] = interaction.values;
            await updateServerConfig(guildId, { whitelists: currentConfig.whitelists });

            const userWhitelist = currentConfig.whitelists[targetId];
            const allowed = userWhitelist.length > 0 ? 
                userWhitelist.map(p => `✅ \`${p}\``).join('\n') : '❌ None';

            const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setFields({ name: '🟢 Allowed Actions', value: allowed });

            const menu = new StringSelectMenuBuilder()
                .setCustomId(`wl_menu_${targetId}`)
                .setPlaceholder('Select Allowed Permissions')
                .setMinValues(0)
                .setMaxValues(4)
                .addOptions([
                    { label: 'Anti Ban', value: 'anti_ban', default: userWhitelist.includes('anti_ban') },
                    { label: 'Anti Kick', value: 'anti_kick', default: userWhitelist.includes('anti_kick') },
                    { label: 'Anti Channel Delete', value: 'anti_channel_delete', default: userWhitelist.includes('anti_channel_delete') },
                    { label: 'Anti Role Delete', value: 'anti_role_delete', default: userWhitelist.includes('anti_role_delete') }
                ]);

            return interaction.update({ 
                embeds: [updatedEmbed], 
                components: [new ActionRowBuilder().addComponents(menu)] 
            });
        }
    }

    // Role Select Menus
    if (interaction.isRoleSelectMenu()) {
        const handlers = {
            'mm_set_staff': () => updateServerConfig(guildId, { staffRoleId: interaction.values[0] }),
            'mm_set_admin': () => updateServerConfig(guildId, { dashboardRoleId: interaction.values[0] }),
            'v_set_target': () => updateServerConfig(guildId, { targetRoleId: interaction.values[0] }),
            'v_set_giver': () => updateServerConfig(guildId, { giverRoleId: interaction.values[0] })
        };

        const handler = handlers[interaction.customId];
        if (handler) {
            await handler();
            const page = interaction.customId.startsWith('mm_') ? 'mm_setup' : 'vouch_setup';
            const dashData = await getDashboard(guildId, page);
            return interaction.update(dashData);
        }
    }

    // Channel Select Menus
    if (interaction.isChannelSelectMenu()) {
        const handlers = {
            'mm_set_category': () => updateServerConfig(guildId, { ticketCategoryId: interaction.values[0] }),
            'mm_set_logs': () => updateServerConfig(guildId, { logChannelId: interaction.values[0] }),
            'v_set_chan': () => updateServerConfig(guildId, { vouchChannelId: interaction.values[0] })
        };

        const handler = handlers[interaction.customId];
        if (handler) {
            await handler();
            const page = interaction.customId.startsWith('mm_') ? 'mm_setup' : 'vouch_setup';
            const dashData = await getDashboard(guildId, page);
            return interaction.update(dashData);
        }
    }

    // Buttons
    if (!interaction.isButton()) return;

    if (interaction.customId === 'change_vouch_interval') {
        const modal = new ModalBuilder()
            .setCustomId('interval_modal')
            .setTitle('Change Auto-Vouch Speed')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('interval_input')
                        .setLabel('Interval (e.g., 30s, 1m, 2h)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setPlaceholder('30s')
                )
            );
        return interaction.showModal(modal);
    }

    if (interaction.customId.startsWith('afk_dm_')) {
        afkUsers.set(user.id, { dm: interaction.customId === 'afk_dm_yes' });
        return interaction.update({
            content: '',
            embeds: [new EmbedBuilder()
                .setColor('#2ECC71')
                .setDescription('✅ AFK mode set!')
            ],
            components: []
        });
    }

    if (interaction.customId === 'v_toggle') {
        const currentConf = getServerConfig(guildId);
        const newRunning = !currentConf.running;
        await updateServerConfig(guildId, { running: newRunning });
        newRunning ? startVouchLoop(guildId) : stopVouchLoop(guildId);
        const dashData = await getDashboard(guildId, 'home');
        return interaction.update(dashData);
    }

    if (interaction.customId === 'change_prefix') {
        const modal = new ModalBuilder()
            .setCustomId('prefix_modal')
            .setTitle('Change Bot Prefix')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('prefix_input')
                        .setLabel('New Prefix')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMaxLength(3)
                )
            );
        return interaction.showModal(modal);
    }

    if (interaction.customId === 'vouch_back_deco') {
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#5865F2')
                .setDescription('📤 Request sent to staff for confirmation.')
            ],
            ephemeral: true
        });
    }

    if (interaction.customId === 'create_ticket') {
        await interaction.deferReply({ ephemeral: true });
        
        const cleanName = user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (interaction.guild.channels.cache.some(c => c.name === `mm-${cleanName}`)) {
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ You already have an open ticket.')
                ]
            });
        }

        if (!conf.staffRoleId) {
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ Staff role not configured.')
                ]
            });
        }

        const ticketChannel = await interaction.guild.channels.create({
            name: `mm-${cleanName}`,
            type: ChannelType.GuildText,
            parent: conf.ticketCategoryId || null,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: conf.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
            ]
        });

        activeTrades.set(ticketChannel.id, {
            trader1Id: user.id,
            trader2Id: null,
            step: 'AWAITING_TRADER2',
            dealDetails: null,
            claimedBy: null
        });

        await sendTicketLog(interaction.guild, conf, '🎫 Ticket Opened', 
            `Ticket ${ticketChannel} created by ${user}`, '#2ECC71');

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🎫 Ticket Created')
            .setDescription(
                `Welcome <@${user.id}>,\n\n` +
                `**Step 1:** Send the **Username** or **User ID** of the person you're trading with.`
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('claim_ticket')
                .setLabel('🙋‍♂️ Claim')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('🔒 Close')
                .setStyle(ButtonStyle.Danger)
        );

        await ticketChannel.send({ content: `${user} 👋`, embeds: [embed], components: [row] });
        
        return interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor('#2ECC71')
                .setDescription(`✅ Ticket created: ${ticketChannel}`)
            ]
        });
    }

    if (interaction.customId === 'edit_deal_btn') {
        const tradeState = activeTrades.get(interaction.channelId);
        if (!tradeState || user.id !== tradeState.trader1Id) {
            return interaction.reply({ 
                content: '❌ Only the creator can edit.', 
                ephemeral: true 
            });
        }

        const modal = new ModalBuilder()
            .setCustomId('edit_deal_modal')
            .setTitle('Edit Deal Details')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('deal_text')
                        .setLabel('New Deal Terms')
                        .setStyle(TextInputStyle.Paragraph)
                        .setValue(tradeState.dealDetails || '')
                )
            );
        return interaction.showModal(modal);
    }

    if (interaction.customId === 'confirm_deal_btn') {
        const tradeState = activeTrades.get(interaction.channelId);
        if (!tradeState || user.id !== tradeState.trader2Id) {
            return interaction.reply({ 
                content: '❌ You are not allowed to confirm.', 
                ephemeral: true 
            });
        }

        tradeState.step = 'DEAL_CONFIRMED';
        activeTrades.set(interaction.channelId, tradeState);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('claim_ticket')
                .setLabel('🙋‍♂️ Claim')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('🔒 Close')
                .setStyle(ButtonStyle.Danger)
        );

        await interaction.update({
            embeds: [new EmbedBuilder()
                .setColor('#2ECC71')
                .setTitle('✅ Deal Confirmed')
                .setDescription(
                    `🔒 **Final Agreement:**\n` +
                    `\`\`\`\n${tradeState.dealDetails}\n\`\`\`\n` +
                    `A staff member will proceed shortly.`
                )
            ],
            components: [row]
        });
        return;
    }

    if (interaction.customId === 'claim_ticket') {
        if (!conf.staffRoleId || !interaction.member.roles.cache.has(conf.staffRoleId)) {
            return interaction.reply({ 
                content: '❌ Staff access only.', 
                ephemeral: true 
            });
        }

        const tradeState = activeTrades.get(interaction.channelId);
        if (tradeState) tradeState.claimedBy = user.id;
        activeTrades.set(interaction.channelId, tradeState);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`unclaim_${user.id}`)
                .setLabel('🤷‍♂️ Unclaim')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('🔒 Close')
                .setStyle(ButtonStyle.Danger)
        );

        if (tradeState && tradeState.step === 'AWAITING_TRADER2_CONFIRMATION') {
            row.components.unshift(
                new ButtonBuilder()
                    .setCustomId('edit_deal_btn')
                    .setLabel('📝 Edit Deal')
                    .setStyle(ButtonStyle.Primary)
            );
            row.components.unshift(
                new ButtonBuilder()
                    .setCustomId('confirm_deal_btn')
                    .setLabel('🤝 Confirm Deal')
                    .setStyle(ButtonStyle.Success)
            );
        }

        await interaction.update({ components: [row] });
        await interaction.channel.send({
            embeds: [new EmbedBuilder()
                .setColor('#FEE75C')
                .setDescription(`🛡️ **Ticket Claimed by** <@${user.id}>`)
            ]
        });
        return;
    }

    if (interaction.customId.startsWith('unclaim_')) {
        const allowedStaffId = interaction.customId.split('_')[1];
        if (user.id !== allowedStaffId && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ 
                content: '❌ You cannot unclaim someone else\'s ticket.', 
                ephemeral: true 
            });
        }

        const tradeState = activeTrades.get(interaction.channelId);
        if (tradeState) tradeState.claimedBy = null;
        activeTrades.set(interaction.channelId, tradeState);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('claim_ticket')
                .setLabel('🙋‍♂️ Claim')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('🔒 Close')
                .setStyle(ButtonStyle.Danger)
        );

        if (tradeState && tradeState.step === 'AWAITING_TRADER2_CONFIRMATION') {
            row.components.unshift(
                new ButtonBuilder()
                    .setCustomId('edit_deal_btn')
                    .setLabel('📝 Edit Deal')
                    .setStyle(ButtonStyle.Primary)
            );
            row.components.unshift(
                new ButtonBuilder()
                    .setCustomId('confirm_deal_btn')
                    .setLabel('🤝 Confirm Deal')
                    .setStyle(ButtonStyle.Success)
            );
        }

        await interaction.update({ components: [row] });
        return;
    }

    if (interaction.customId === 'close_ticket') {
        if (!conf.staffRoleId || (!interaction.member.roles.cache.has(conf.staffRoleId) && 
            !interaction.member.permissions.has(PermissionFlagsBits.Administrator))) {
            return interaction.reply({ 
                content: '❌ Staff access only.', 
                ephemeral: true 
            });
        }

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#ED4245')
                .setDescription('🔒 **Closing ticket in 5 seconds...**')
            ]
        });

        await sendTicketLog(interaction.guild, conf, '🔒 Ticket Closed', 
            `Ticket \`${interaction.channel.name}\` closed by ${user}`, '#ED4245');
        
        activeTrades.delete(interaction.channelId);
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
        return;
    }
});

// ===================== ERROR HANDLING =====================
process.on('unhandledRejection', error => {
    console.error('❌ Unhandled Rejection:', error);
});

// ===================== START BOT =====================
client.login(BOT_TOKEN);
