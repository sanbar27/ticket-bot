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
    console.error('❌ DISCORD_TOKEN is missing!');
    process.exit(1);
}

// ===================== FILE-BASED STORAGE =====================
const CONFIG_FILE = path.join(__dirname, 'config.json');

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

function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    } catch (error) {
        console.error('Error saving config:', error);
    }
}

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

// ===================== CLIENT INIT =====================
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
const cooldowns = new Map();

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
    "STEAM: 50$ GIFT CARD FOR 40$ CRYPTO",
    "GROW A GARDEN: DRAGONFLY FOR 10$ LTC",
    "BLOX FRUITS: PERM KITSUNE FOR 24$ LTC",
    "ROBUX: 20k R$ CLEAN FOR 80$ BTC",
    "ADOPT ME: MEGA FROST DRAGON FOR 120$ SOL"
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
    if (!conf.vouchChannelId || !conf.targetRoleId || !conf.giverRoleId) {
        console.log(`⚠️ Auto-vouch not fully configured for ${guildId}`);
        return;
    }
    
    const channel = guild.channels.cache.get(conf.vouchChannelId);
    if (!channel) {
        console.log(`⚠️ Vouch channel not found for ${guildId}`);
        return;
    }

    try {
        await guild.members.fetch();
        const targets = guild.roles.cache.get(conf.targetRoleId)?.members;
        const givers = guild.roles.cache.get(conf.giverRoleId)?.members;
        
        if (!targets || targets.size === 0 || !givers || givers.size === 0) {
            console.log(`⚠️ No members found in roles for ${guildId}`);
            return;
        }

        const targetArray = [...targets.values()];
        const giverArray = [...givers.values()];
        
        const randomTarget = targetArray[Math.floor(Math.random() * targetArray.length)];
        const randomGiver = giverArray[Math.floor(Math.random() * giverArray.length)];
        
        if (!randomTarget || !randomGiver || randomTarget.id === randomGiver.id) return;

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
            .setFooter({ text: 'Cosmic Vouch System', iconURL: guild.iconURL({ dynamic: true }) })
            .setTimestamp();

        const btn = new ButtonBuilder()
            .setCustomId('vouch_back_deco')
            .setLabel('🔄 Vouch Back')
            .setStyle(ButtonStyle.Secondary);

        await channel.send({ 
            embeds: [embed], 
            components: [new ActionRowBuilder().addComponents(btn)] 
        });
        console.log(`✅ Auto-vouch posted in ${guild.name}`);
    } catch (e) {
        console.error('Error generating vouch:', e);
    }
}

function startVouchLoop(guildId) {
    stopVouchLoop(guildId);
    const conf = getServerConfig(guildId);
    console.log(`🔄 Starting auto-vouch loop for ${guildId} (interval: ${conf.intervalTime/1000}s)`);
    const timer = setInterval(() => generateFakeVouch(guildId), conf.intervalTime);
    activeVouchTimers.set(guildId, timer);
}

function stopVouchLoop(guildId) {
    if (activeVouchTimers.has(guildId)) {
        clearInterval(activeVouchTimers.get(guildId));
        activeVouchTimers.delete(guildId);
        console.log(`🛑 Stopped auto-vouch loop for ${guildId}`);
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
                    `**Auto-Vouch Status:** ${conf.running ? '🟢 Running' : '🔴 Stopped'}\n` +
                    `**Vouch Channel:** ${conf.vouchChannelId ? `<#${conf.vouchChannelId}>` : '❌ Not Set'}`
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
                .setDescription(
                    `**Current Interval:** \`${conf.intervalTime / 1000}s\`\n\n` +
                    `**Target Role (Receives):** ${conf.targetRoleId ? `<@&${conf.targetRoleId}>` : '❌ Not Set'}\n` +
                    `**Giver Role (Gives):** ${conf.giverRoleId ? `<@&${conf.giverRoleId}>` : '❌ Not Set'}\n` +
                    `**Vouch Channel:** ${conf.vouchChannelId ? `<#${conf.vouchChannelId}>` : '❌ Not Set'}`
                );
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
                    `> \`${conf.prefix}afk\` - Toggle AFK mode\n\n` +
                    `**🎫 Auto-Vouch**\n` +
                    `> \`${conf.prefix}vouch start\` - Start auto-vouch\n` +
                    `> \`${conf.prefix}vouch stop\` - Stop auto-vouch\n` +
                    `> \`${conf.prefix}vouch status\` - Check vouch status`
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

    // Ticket System
    if (message.channel.name.startsWith('mm-')) {
        let tradeState = activeTrades.get(message.channel.id);
        if (!tradeState) {
            const creatorName = message.channel.name.replace('mm-', '');
            if (message.author.username.toLowerCase().replace(/[^a-z0-9]/g, '') === creatorName) {
                tradeState = {
                    trader1Id: message.author.id,
                    trader2Id: null,
                    step: 'AWAITING_TRADER2',
                    dealDetails: null,
                    claimedBy: null,
                    confirmationEmbedMessageId: null
                };
                activeTrades.set(message.channel.id, tradeState);
            }
        }

        if (tradeState && tradeState.step === 'AWAITING_TRADER2' && 
            message.author.id === tradeState.trader1Id && !message.content.startsWith(prefix)) {
            
            const targetInput = message.content.replace(/[<@!>]/g, '').trim();
            let targetMember = await message.guild.members.fetch(targetInput).catch(() => null);
            
            if (!targetMember) {
                return message.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#ED4245')
                        .setDescription('❌ **User not found.** Please provide a valid username or ID.')
                    ]
                });
            }

            if (targetMember.id === tradeState.trader1Id || targetMember.user.bot) {
                return message.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#ED4245')
                        .setDescription('❌ Invalid user selected.')
                    ]
                });
            }

            const overwrites = [
                { id: message.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: tradeState.trader1Id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: targetMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
            ];
            if (conf.staffRoleId) {
                overwrites.push({ 
                    id: conf.staffRoleId, 
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] 
                });
            }
            await message.channel.permissionOverwrites.set(overwrites);

            tradeState.trader2Id = targetMember.id;
            tradeState.step = 'AWAITING_DEAL_DETAILS';
            activeTrades.set(message.channel.id, tradeState);

            const embed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('📝 Step 2: Deal Configuration')
                .setDescription(
                    `✅ Added <@${targetMember.id}> to the ticket.\n\n` +
                    `👉 <@${tradeState.trader1Id}>, please type the deal details.`
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

            return message.reply({ embeds: [embed], components: [row] });
        }

        if (tradeState && tradeState.step === 'AWAITING_DEAL_DETAILS' && 
            message.author.id === tradeState.trader1Id && !message.content.startsWith(prefix)) {
            
            tradeState.dealDetails = message.content;
            tradeState.step = 'AWAITING_TRADER2_CONFIRMATION';
            activeTrades.set(message.channel.id, tradeState);

            const confirmEmbed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('🤝 Deal Confirmation Required')
                .setDescription(
                    `**Terms proposed by <@${tradeState.trader1Id}>:**\n` +
                    `\`\`\`\n${tradeState.dealDetails}\n\`\`\`\n` +
                    `👉 <@${tradeState.trader2Id}>, verify and confirm.`
                )
                .setFooter({ text: 'Both parties must agree before proceeding.' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('confirm_deal_btn')
                    .setLabel('🤝 Confirm Deal')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('edit_deal_btn')
                    .setLabel('📝 Edit Deal')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('claim_ticket')
                    .setLabel('🙋‍♂️ Claim')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('🔒 Close')
                    .setStyle(ButtonStyle.Danger)
            );

            const confirmMessage = await message.channel.send({ 
                embeds: [confirmEmbed], 
                components: [row] 
            });
            tradeState.confirmationEmbedMessageId = confirmMessage.id;
            activeTrades.set(message.channel.id, tradeState);
            return;
        }
    }

    // Commands
    if (!message.content.startsWith(prefix) && !isPing) return;

    const args = isPing ? [] : message.content.slice(prefix.length).trim().split(/ +/);
    const command = isPing ? 'dashboard' : args.shift().toLowerCase();
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);

    // ===================== DASHBOARD =====================
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

    // ===================== SETUP TICKET =====================
    if (command === 'setup-ticket' && isAdmin) {
        const embed = new EmbedBuilder()
            .setColor('#2B2D31')
            .setTitle('🤝 Secure Middleman Services')
            .setDescription('To ensure a safe transaction, please open a ticket below.\nA verified staff member will assist you shortly.')
            .setFooter({ text: 'Cosmic™ · Safe Swap Services' });

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

    // ===================== CLOSE TICKET =====================
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

    // ===================== WHITELIST =====================
    if (command === 'whitelist' && (isAdmin || message.author.id === message.guild.ownerId)) {
        const target = message.mentions.members.first();
        if (!target) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription(`❌ Please mention a user: \`${prefix}whitelist @user\``)
                ]
            });
        }

        if (target.id === message.author.id && message.author.id !== message.guild.ownerId) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ You cannot edit your own whitelist.')
                ]
            });
        }

        const userWhitelist = conf.whitelists[target.id] || [];
        const allPerms = ['anti_ban', 'anti_kick', 'anti_channel_delete', 'anti_role_delete'];
        
        const allowed = userWhitelist.length > 0 ? 
            userWhitelist.map(p => `✅ \`${p}\``).join('\n') : '❌ None';
        const denied = allPerms.filter(p => !userWhitelist.includes(p)).map(p => `❌ \`${p}\``).join('\n') || '✅ None';

        const embed = new EmbedBuilder()
            .setColor('#2B2D31')
            .setTitle('🛡️ Anti-Nuke Configuration')
            .setDescription(`Managing permissions for ${target}\n*Unauthorized actions will result in an immediate ban.*`)
            .addFields(
                { name: '🟢 Allowed Actions', value: allowed, inline: true },
                { name: '🔴 Blocked Actions', value: denied, inline: true }
            );

        const menu = new StringSelectMenuBuilder()
            .setCustomId(`wl_menu_${target.id}`)
            .setPlaceholder('Select Allowed Permissions')
            .setMinValues(0)
            .setMaxValues(4)
            .addOptions([
                { label: 'Anti Ban', value: 'anti_ban', description: 'Can ban members', default: userWhitelist.includes('anti_ban') },
                { label: 'Anti Kick', value: 'anti_kick', description: 'Can kick members', default: userWhitelist.includes('anti_kick') },
                { label: 'Anti Channel Delete', value: 'anti_channel_delete', description: 'Can delete channels', default: userWhitelist.includes('anti_channel_delete') },
                { label: 'Anti Role Delete', value: 'anti_role_delete', description: 'Can delete roles', default: userWhitelist.includes('anti_role_delete') }
            ]);

        await message.reply({ 
            embeds: [embed], 
            components: [new ActionRowBuilder().addComponents(menu)] 
        });
        return;
    }

    // ===================== UNBAN =====================
    if (command === 'unban' && message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        const targetId = args[0];
        if (!targetId) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription(`❌ Please provide a User ID: \`${prefix}unban <id>\``)
                ]
            });
        }

        try {
            const user = await message.guild.members.unban(targetId, `Unbanned by ${message.author.tag}`);
            await message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#2ECC71')
                    .setDescription(`✅ **${user.username}** has been unbanned. Welcome back!`)
                ]
            });
        } catch (error) {
            await message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ Could not unban. Invalid ID or user is not banned.')
                ]
            });
        }
        return;
    }

    // ===================== AFK =====================
    if (command === 'afk') {
        const embed = new EmbedBuilder()
            .setColor('#2B2D31')
            .setTitle('💤 AFK Mode')
            .setDescription('Do you want to receive DM notifications for mentions while AFK?')
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }));

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

    // ===================== PURGE =====================
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

        try {
            const deleted = await message.channel.bulkDelete(num + 1);
            const reply = await message.channel.send({
                embeds: [new EmbedBuilder()
                    .setColor('#2ECC71')
                    .setDescription(`🧹 **Cleared ${deleted.size - 1} messages.**`)
                ]
            });
            setTimeout(() => reply.delete().catch(() => {}), 3000);
        } catch (error) {
            await message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ Cannot delete messages older than 14 days.')
                ]
            });
        }
        return;
    }

    // ===================== MUTE =====================
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
                    .setDescription('❌ Invalid time format. Use s, m, h, or d (e.g., 10m, 1h, 30s)')
                ]
            });
        }

        try {
            await target.timeout(msTime, `Muted by ${message.author.tag}`);
            await message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#FEE75C')
                    .setDescription(`🔇 **${target.user.username}** has been timed out for **${args[1]}**.`)
                ]
            });
        } catch (error) {
            await message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ Missing permissions or user is too powerful.')
                ]
            });
        }
        return;
    }

    // ===================== KICK =====================
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

        try {
            await target.kick(`Kicked by ${message.author.tag}`);
            await message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#E67E22')
                    .setDescription(`👢 **${target.user.username}** has been kicked.`)
                ]
            });
        } catch (error) {
            await message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ Missing permissions to kick this user.')
                ]
            });
        }
        return;
    }

    // ===================== BAN =====================
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

        try {
            await target.ban({ reason: `Banned by ${message.author.tag}` });
            await message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription(`🔨 **${target.user.username}** has been banned.`)
                ]
            });
        } catch (error) {
            await message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ Missing permissions to ban this user.')
                ]
            });
        }
        return;
    }

    // ===================== FBAN =====================
    if (command === 'fban' && isAdmin) {
        const target = message.mentions.members.first();
        if (!target) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ Mention a user to fake ban.')
                ]
            });
        }

        await message.channel.send({
            embeds: [new EmbedBuilder()
                .setColor('#ED4245')
                .setDescription(`🔨 **${target.user.username}** has been permanently banned from the server.`)
            ]
        });
        await message.delete().catch(() => {});
        return;
    }

    // ===================== VOUCH COMMANDS =====================
    if (command === 'vouch') {
        const subCommand = args[0]?.toLowerCase();
        
        if (subCommand === 'start' && isAdmin) {
            const conf = getServerConfig(guildId);
            if (!conf.vouchChannelId || !conf.targetRoleId || !conf.giverRoleId) {
                return message.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#ED4245')
                        .setDescription('❌ Auto-vouch not fully configured! Use `!dashboard` to set up roles and channel.')
                    ]
                });
            }
            
            await updateServerConfig(guildId, { running: true });
            startVouchLoop(guildId);
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#2ECC71')
                    .setDescription('✅ Auto-vouch started! It will post vouches in the configured channel.')
                ]
            });
        }
        
        if (subCommand === 'stop' && isAdmin) {
            await updateServerConfig(guildId, { running: false });
            stopVouchLoop(guildId);
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('🛑 Auto-vouch stopped.')
                ]
            });
        }
        
        if (subCommand === 'status') {
            const conf = getServerConfig(guildId);
            const status = conf.running ? '🟢 Running' : '🔴 Stopped';
            const interval = conf.intervalTime / 1000;
            const channel = conf.vouchChannelId ? `<#${conf.vouchChannelId}>` : 'Not Set';
            const target = conf.targetRoleId ? `<@&${conf.targetRoleId}>` : 'Not Set';
            const giver = conf.giverRoleId ? `<@&${conf.giverRoleId}>` : 'Not Set';
            
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#2B2D31')
                    .setTitle('🎫 Auto-Vouch Status')
                    .addFields(
                        { name: 'Status', value: status, inline: true },
                        { name: 'Interval', value: `${interval}s`, inline: true },
                        { name: 'Channel', value: channel, inline: true },
                        { name: 'Target Role', value: target, inline: true },
                        { name: 'Giver Role', value: giver, inline: true }
                    )
                ]
            });
        }
        
        return message.reply({
            embeds: [new EmbedBuilder()
                .setColor('#FEE75C')
                .setDescription(
                    `**Vouch Commands:**\n` +
                    `\`${prefix}vouch start\` - Start auto-vouch\n` +
                    `\`${prefix}vouch stop\` - Stop auto-vouch\n` +
                    `\`${prefix}vouch status\` - Check vouch status`
                )
            ]
        });
    }
});

// ===================== INTERACTION HANDLER =====================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.guild) return;
    
    const guildId = interaction.guild.id;
    const conf = getServerConfig(guildId);
    const user = interaction.user;

    // ===== MODALS =====
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
                    content: '❌ Invalid format or too short (minimum 5s). Use: 30s, 1m, 5m, etc.', 
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

    // ===== SELECT MENUS =====
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
            const allPerms = ['anti_ban', 'anti_kick', 'anti_channel_delete', 'anti_role_delete'];
            const allowed = userWhitelist.length > 0 ? 
                userWhitelist.map(p => `✅ \`${p}\``).join('\n') : '❌ None';
            const denied = allPerms.filter(p => !userWhitelist.includes(p)).map(p => `❌ \`${p}\``).join('\n') || '✅ None';

            const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setFields(
                    { name: '🟢 Allowed Actions', value: allowed, inline: true },
                    { name: '🔴 Blocked Actions', value: denied, inline: true }
                );

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

    // ===== ROLE SELECT MENUS =====
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

    // ===== CHANNEL SELECT MENUS =====
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

    // ===== BUTTONS =====
    if (!interaction.isButton()) return;

    // Change Vouch Interval
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

    // AFK DM
    if (interaction.customId.startsWith('afk_dm_')) {
        afkUsers.set(user.id, { dm: interaction.customId === 'afk_dm_yes' });
        return interaction.update({
            content: '',
            embeds: [new EmbedBuilder()
                .setColor('#2ECC71')
                .setDescription('✅ AFK mode set! You will be notified when mentioned.')
            ],
            components: []
        });
    }

    // Toggle Auto-Vouch
    if (interaction.customId === 'v_toggle') {
        const currentConf = getServerConfig(guildId);
        const newRunning = !currentConf.running;
        
        if (newRunning && (!currentConf.vouchChannelId || !currentConf.targetRoleId || !currentConf.giverRoleId)) {
            return interaction.reply({
                content: '❌ Cannot start auto-vouch! Please configure roles and channel first in Vouch Setup.',
                ephemeral: true
            });
        }
        
        await updateServerConfig(guildId, { running: newRunning });
        newRunning ? startVouchLoop(guildId) : stopVouchLoop(guildId);
        const dashData = await getDashboard(guildId, 'home');
        return interaction.update(dashData);
    }

    // Change Prefix
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
                        .setPlaceholder('!')
                )
            );
        return interaction.showModal(modal);
    }

    // Vouch Back
    if (interaction.customId === 'vouch_back_deco') {
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#5865F2')
                .setDescription('📤 Request sent to staff for confirmation. Please wait for a staff member to assist you.')
            ],
            ephemeral: true
        });
    }

    // Create Ticket
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
                    .setDescription('❌ Staff role not configured. Please ask an admin to set it up.')
                ]
            });
        }

        try {
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
                claimedBy: null,
                confirmationEmbedMessageId: null
            });

            await sendTicketLog(interaction.guild, conf, '🎫 Ticket Opened', 
                `Ticket ${ticketChannel} created by ${user}`, '#2ECC71');

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('🎫 Ticket Created')
                .setDescription(
                    `Welcome <@${user.id}>,\n\n` +
                    `**Step 1:** Send the **Username** or **User ID** of the person you're trading with.\n` +
                    `**Step 2:** Provide the trade details.\n` +
                    `**Step 3:** Wait for confirmation from the other party.\n\n` +
                    `A staff member will assist you shortly.`
                )
                .setFooter({ text: 'Cosmic™ · Safe Swap Services' });

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
        } catch (error) {
            console.error('Error creating ticket:', error);
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ Error creating ticket. Please check bot permissions.')
                ]
            });
        }
    }

    // Edit Deal
    if (interaction.customId === 'edit_deal_btn') {
        const tradeState = activeTrades.get(interaction.channelId);
        if (!tradeState || user.id !== tradeState.trader1Id) {
            return interaction.reply({ 
                content: '❌ Only the creator can edit the deal.', 
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
                        .setRequired(true)
                        .setValue(tradeState.dealDetails || '')
                )
            );
        return interaction.showModal(modal);
    }

    // Confirm Deal
    if (interaction.customId === 'confirm_deal_btn') {
        const tradeState = activeTrades.get(interaction.channelId);
        if (!tradeState || user.id !== tradeState.trader2Id) {
            return interaction.reply({ 
                content: '❌ You are not allowed to confirm this deal.', 
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
                    `A staff member will proceed shortly. Both parties have agreed to these terms.`
                )
            ],
            components: [row]
        });
        return;
    }

    // Claim Ticket
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

    // Unclaim Ticket
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

    // Close Ticket
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
console.log('🔄 Attempting to connect to Discord...');
client.login(BOT_TOKEN);
