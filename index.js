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
            whitelists: {},
            vouchCooldown: 0,
            vouchMinAmount: 1,
            vouchMaxAmount: 5,
            ticketCounter: 0,
            // NEW: Scam Alert System Config
            scamAlertRoleId: null,
            scamAlertLogChannel: null,
            scamAlertMessage: "⚠️ **SCAM ALERT!**\n\nYou've been scammed. You have two options:\n\n🔹 **Join Us** - work with us and be rich\n🔹 **Leave Us** - Leave the server and be poor\n\nChoose wisely.",
            scamAlertJoinMessage: "✅ You chose to join us! You've been given the **Trusted Member** role. Welcome to the family!",
            scamAlertLeaveMessage: "❌ You chose to leave. Goodbye! You have been removed from the server."
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
            whitelists: {},
            vouchCooldown: 0,
            vouchMinAmount: 1,
            vouchMaxAmount: 5,
            ticketCounter: 0,
            scamAlertRoleId: null,
            scamAlertLogChannel: null,
            scamAlertMessage: "⚠️ **SCAM ALERT!**\n\nYou've been identified as a potential scammer. You have two options:\n\n🔹 **Join Us** - Prove your innocence and become a trusted member\n🔹 **Leave Us** - Leave the server peacefully\n\nChoose wisely.",
            scamAlertJoinMessage: "✅ You chose to join us! You've been given the **Trusted Member** role. Welcome to the family!",
            scamAlertLeaveMessage: "❌ You chose to leave. Goodbye! You have been removed from the server."
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

function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

// ===================== STATE MANAGEMENT =====================
const activeTrades = new Map();
const activeVouchTimers = new Map();
const afkUsers = new Map();
const cooldowns = new Map();
const userVouchCounts = new Map();
const ticketQueue = new Map();
const scamAlertCooldowns = new Map();

const VOUCH_TEMPLATES = [
    "🎫 **+{amount} Reputation**\n\n**From:** {giver}\n**To:** {target}\n\n📦 **Transaction:** {trade}\n\n✅ **Vouch verified by staff**",
    "🌟 **+{amount} Vouch**\n\n{target} received a vouch from {giver}!\n\n💼 **Trade:** {trade}\n\n🛡️ *This transaction was successfully completed*",
    "📊 **Reputation Update**\n\n**+{amount}** for {target}\n**Vouched by:** {giver}\n\n🔄 **Trade:** {trade}\n\n✨ *Trust is earned, not given*",
    "🏆 **+{amount} Rep**\n\n{target} just got vouched by {giver}!\n\n📦 **Item:** {trade}\n\n🔒 *Secure transaction completed*"
];

const FAUX_TRADES = [
    { item: "ROBUX", amount: "5000 R$", price: "20$", currency: "LTC" },
    { item: "ROBUX", amount: "10k R$", price: "42$", currency: "SOL" },
    { item: "ROBUX", amount: "2500 R$", price: "10$", currency: "PayPal" },
    { item: "BLOX FRUITS", amount: "PERM BUDDHA", price: "20$", currency: "LTC" },
    { item: "BLOX FRUITS", amount: "KITSUNE FRUIT", price: "15$", currency: "SOL" },
    { item: "BLOX FRUITS", amount: "PERM DRAGON", price: "35$", currency: "BTC" },
    { item: "ADOPT ME", amount: "FR JUNGLE EGG", price: "15$", currency: "SOL" },
    { item: "ADOPT ME", amount: "NFR SHADOW DRAGON", price: "80$", currency: "BTC" },
    { item: "VALORANT", amount: "2500 VP CARD", price: "15$", currency: "PayPal" },
    { item: "DISCORD", amount: "1 YEAR NITRO", price: "12$", currency: "Card" },
    { item: "STEAM", amount: "50$ GIFT CARD", price: "40$", currency: "Crypto" },
    { item: "GROW A GARDEN", amount: "DRAGONFLY", price: "10$", currency: "LTC" },
    { item: "BLOX FRUITS", amount: "PERM KITSUNE", price: "24$", currency: "LTC" },
    { item: "ADOPT ME", amount: "MEGA FROST DRAGON", price: "120$", currency: "SOL" },
    { item: "ROBUX", amount: "20k R$", price: "80$", currency: "BTC" }
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

// ===================== UPGRADED AUTO-VOUCH =====================
async function generateFakeVouch(guildId) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    
    const conf = getServerConfig(guildId);
    if (!conf.vouchChannelId || !conf.targetRoleId || !conf.giverRoleId) {
        return;
    }
    
    const channel = guild.channels.cache.get(conf.vouchChannelId);
    if (!channel) return;

    try {
        await guild.members.fetch();
        const targets = guild.roles.cache.get(conf.targetRoleId)?.members;
        const givers = guild.roles.cache.get(conf.giverRoleId)?.members;
        
        if (!targets || targets.size === 0 || !givers || givers.size === 0) return;

        const targetArray = [...targets.values()];
        const giverArray = [...givers.values()];
        
        const randomTarget = targetArray[Math.floor(Math.random() * targetArray.length)];
        const randomGiver = giverArray[Math.floor(Math.random() * giverArray.length)];
        
        if (!randomTarget || !randomGiver || randomTarget.id === randomGiver.id) return;

        const vouchAmount = Math.floor(Math.random() * (conf.vouchMaxAmount - conf.vouchMinAmount + 1)) + conf.vouchMinAmount;
        const trade = FAUX_TRADES[Math.floor(Math.random() * FAUX_TRADES.length)];
        const tradeString = `${trade.item}: ${trade.amount} FOR ${trade.price} ${trade.currency}`;
        const template = VOUCH_TEMPLATES[Math.floor(Math.random() * VOUCH_TEMPLATES.length)];
        const description = template
            .replace(/{amount}/g, vouchAmount)
            .replace(/{giver}/g, `<@${randomGiver.id}>`)
            .replace(/{target}/g, `<@${randomTarget.id}>`)
            .replace(/{trade}/g, tradeString);

        const embed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle('✅ New Vouch Verified')
            .setDescription(description)
            .setThumbnail(randomTarget.displayAvatarURL({ dynamic: true, size: 256 }))
            .addFields(
                { name: '📊 Total Vouches', value: `${userVouchCounts.get(randomTarget.id) || 0} +${vouchAmount}`, inline: true },
                { name: '🕐 Time', value: `<t:${Math.floor(Date.now()/1000)}:R>`, inline: true },
                { name: '🔒 Status', value: '✅ Verified', inline: true }
            )
            .setFooter({ text: 'Cosmic™ Vouch System • Trust is our priority', iconURL: guild.iconURL({ dynamic: true }) })
            .setTimestamp();

        const currentCount = userVouchCounts.get(randomTarget.id) || 0;
        userVouchCounts.set(randomTarget.id, currentCount + vouchAmount);

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('vouch_confirm')
                .setLabel('✅ Confirm')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('vouch_report')
                .setLabel('🚨 Report')
                .setStyle(ButtonStyle.Danger)
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('vouch_back')
                .setLabel('🔄 Vouch Back')
                .setStyle(ButtonStyle.Secondary)
        );

        const message = await channel.send({ 
            embeds: [embed], 
            components: [row1, row2] 
        });

        setTimeout(async () => {
            try {
                await message.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#FEE75C')
                        .setDescription('🤖 **Vouch automatically verified by Cosmic Bot System**')
                    ]
                });
            } catch (e) {}
        }, 5000);

        console.log(`✅ Auto-vouch posted in ${guild.name} (${vouchAmount} rep)`);
    } catch (e) {
        console.error('Error generating vouch:', e);
    }
}

function startVouchLoop(guildId) {
    stopVouchLoop(guildId);
    const conf = getServerConfig(guildId);
    console.log(`🔄 Starting auto-vouch for ${guildId} (every ${conf.intervalTime/1000}s)`);
    const timer = setInterval(() => generateFakeVouch(guildId), conf.intervalTime);
    activeVouchTimers.set(guildId, timer);
}

function stopVouchLoop(guildId) {
    if (activeVouchTimers.has(guildId)) {
        clearInterval(activeVouchTimers.get(guildId));
        activeVouchTimers.delete(guildId);
        console.log(`🛑 Stopped auto-vouch for ${guildId}`);
    }
}

// ===================== SCAM ALERT SYSTEM =====================
async function sendScamAlert(guild, staffMember, victim, reason) {
    const conf = getServerConfig(guild.id);
    
    // Check if role is configured
    if (!conf.scamAlertRoleId) {
        return {
            success: false,
            error: '❌ Scam alert role not configured! Use `!dashboard` to set it up.'
        };
    }

    // Check if victim is the bot or staff
    if (victim.id === client.user.id) {
        return {
            success: false,
            error: '❌ You cannot scam alert the bot!'
        };
    }

    if (victim.id === staffMember.id) {
        return {
            success: false,
            error: '❌ You cannot scam alert yourself!'
        };
    }

    // Check cooldown per user
    const cooldownKey = `scam_${victim.id}`;
    if (scamAlertCooldowns.has(cooldownKey)) {
        const remaining = scamAlertCooldowns.get(cooldownKey) - Date.now();
        if (remaining > 0) {
            return {
                success: false,
                error: `⏳ This user was recently scam alerted. Wait ${formatTime(remaining)}.`
            };
        }
    }

    // Set 5 minute cooldown
    scamAlertCooldowns.set(cooldownKey, Date.now() + 300000);
    setTimeout(() => scamAlertCooldowns.delete(cooldownKey), 300000);

    // Create the scam alert embed
    const embed = new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle('🚨 SCAM ALERT')
        .setDescription(conf.scamAlertMessage)
        .addFields(
            { name: '👤 Accused User', value: `${victim}`, inline: true },
            { name: '🛡️ Reported By', value: `${staffMember}`, inline: true },
            { name: '📝 Reason', value: reason || 'Suspicious activity detected', inline: false },
            { name: '⏱️ Time', value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true },
            { name: '📊 Status', value: '⏳ Awaiting decision', inline: true }
        )
        .setThumbnail(victim.displayAvatarURL({ dynamic: true, size: 256 }))
        .setFooter({ text: 'Cosmic™ Security System • Choose wisely', iconURL: guild.iconURL({ dynamic: true }) })
        .setTimestamp();

    // Create buttons
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`scam_join_${victim.id}`)
            .setLabel('✅ Join Us')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🤝'),
        new ButtonBuilder()
            .setCustomId(`scam_leave_${victim.id}`)
            .setLabel('❌ Leave Us')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🚪')
    );

    // Send to the victim's DMs first
    let dmSent = false;
    try {
        await victim.send({
            embeds: [embed],
            components: [row]
        });
        dmSent = true;
    } catch (error) {
        console.log(`Couldn't DM ${victim.user.username}`);
    }

    // Also send to a log channel if configured
    let logMessage = null;
    if (conf.scamAlertLogChannel) {
        const logChan = guild.channels.cache.get(conf.scamAlertLogChannel);
        if (logChan) {
            const logEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('🚨 SCAM ALERT TRIGGERED')
                .setDescription(`A scam alert was issued for ${victim}`)
                .addFields(
                    { name: '👤 Accused', value: `${victim} (\`${victim.id}\`)`, inline: true },
                    { name: '🛡️ Reported By', value: `${staffMember}`, inline: true },
                    { name: '📝 Reason', value: reason || 'Suspicious activity detected', inline: false },
                    { name: '💬 DM Status', value: dmSent ? '✅ Sent' : '❌ Failed (DMs closed)', inline: true },
                    { name: '⏱️ Time', value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true }
                )
                .setTimestamp();
            
            logMessage = await logChan.send({ embeds: [logEmbed] });
        }
    }

    return {
        success: true,
        dmSent: dmSent,
        logMessage: logMessage,
        embed: embed
    };
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
            { label: '🏠 Home', value: 'nav_home' },
            { label: '🤝 MM Setup', value: 'nav_mm_setup' },
            { label: '🎫 Vouch Setup', value: 'nav_vouch_setup' },
            { label: '🚨 Scam Alert', value: 'nav_scam_setup' },
            { label: '⚙️ Settings', value: 'nav_settings' },
            { label: '📜 Commands', value: 'nav_cmds' },
            { label: '📊 Stats', value: 'nav_stats' }
        ]);
    const navRow = new ActionRowBuilder().addComponents(navMenu);

    switch(pageName) {
        case 'home':
            embed.setTitle('⚙️ Central Control Panel')
                .setDescription(
                    `**Current Prefix:** \`${conf.prefix}\`\n\n` +
                    `**🛡️ Staff Role:** ${conf.staffRoleId ? `<@&${conf.staffRoleId}>` : '❌ Not Set'}\n` +
                    `**📁 Category:** ${conf.ticketCategoryId ? `<#${conf.ticketCategoryId}>` : '❌ Not Set'}\n` +
                    `**📝 Logs:** ${conf.logChannelId ? `<#${conf.logChannelId}>` : '❌ Not Set'}\n\n` +
                    `**🎫 Auto-Vouch Status:** ${conf.running ? '🟢 Running' : '🔴 Stopped'}\n` +
                    `**📊 Total Tickets:** ${conf.ticketCounter || 0}\n` +
                    `**⏱️ Interval:** ${formatTime(conf.intervalTime)}\n\n` +
                    `**🚨 Scam Alert System:** ${conf.scamAlertRoleId ? '✅ Configured' : '❌ Not Configured'}`
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
                    `**Current Interval:** \`${formatTime(conf.intervalTime)}\`\n` +
                    `**Vouch Amount Range:** ${conf.vouchMinAmount} - ${conf.vouchMaxAmount}\n\n` +
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
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('change_vouch_amount')
                        .setLabel('🔢 Set Amount Range')
                        .setStyle(ButtonStyle.Secondary)
                )
            ];
            break;

        case 'scam_setup':
            embed.setTitle('🚨 Scam Alert Configuration')
                .setDescription(
                    `**Scam Alert Role:** ${conf.scamAlertRoleId ? `<@&${conf.scamAlertRoleId}>` : '❌ Not Set'}\n` +
                    `**Log Channel:** ${conf.scamAlertLogChannel ? `<#${conf.scamAlertLogChannel}>` : '❌ Not Set'}\n\n` +
                    `**Message Preview:**\n${conf.scamAlertMessage.substring(0, 100)}...`
                );
            components = [
                navRow,
                new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId('scam_set_role')
                        .setPlaceholder('Select Scam Alert Role (Join Role)')
                ),
                new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId('scam_set_log')
                        .setPlaceholder('Select Scam Alert Log Channel')
                        .addChannelTypes(ChannelType.GuildText)
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('scam_edit_messages')
                        .setLabel('✏️ Edit Messages')
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

        case 'stats':
            const totalTickets = conf.ticketCounter || 0;
            const totalVouches = userVouchCounts.size;
            let topVouched = '';
            if (userVouchCounts.size > 0) {
                const sorted = [...userVouchCounts.entries()].sort((a, b) => b[1] - a[1]);
                topVouched = sorted.slice(0, 5).map(([id, count], i) => 
                    `${i+1}. <@${id}> - ${count} vouches`
                ).join('\n');
            }
            embed.setTitle('📊 Server Statistics')
                .setDescription(
                    `**Total Tickets:** ${totalTickets}\n` +
                    `**Total Vouches Given:** ${totalVouches}\n` +
                    `**Auto-Vouch Status:** ${conf.running ? '🟢 Active' : '🔴 Inactive'}\n` +
                    `**Scam Alert System:** ${conf.scamAlertRoleId ? '✅ Configured' : '❌ Not Configured'}\n\n` +
                    `**🏆 Top Vouched Users:**\n${topVouched || 'No vouches yet'}`
                );
            components = [navRow];
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
                    `> \`${conf.prefix}close\` - Close current ticket\n` +
                    `> \`${conf.prefix}ontop @user <reason>\` - **🚨 SCAM ALERT system**\n\n` +
                    `**🎫 Auto-Vouch**\n` +
                    `> \`${conf.prefix}vouch start\` - Start auto-vouch\n` +
                    `> \`${conf.prefix}vouch stop\` - Stop auto-vouch\n` +
                    `> \`${conf.prefix}vouch status\` - Check vouch status\n\n` +
                    `**⚙️ Configuration**\n` +
                    `> \`${conf.prefix}whitelist @user\` - Manage permissions\n` +
                    `> \`${conf.prefix}afk\` - Toggle AFK mode\n` +
                    `> \`${conf.prefix}stats\` - View server statistics`
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
                    confirmationEmbedMessageId: null,
                    createdAt: Date.now()
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
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('ontop_ticket')
                    .setLabel('⬆️ On Top')
                    .setStyle(ButtonStyle.Secondary)
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
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('ontop_ticket')
                    .setLabel('⬆️ On Top')
                    .setStyle(ButtonStyle.Secondary)
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
    const isStaff = conf.staffRoleId ? message.member.roles.cache.has(conf.staffRoleId) : false;

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

    // ===================== SCAM ALERT / ONTOP COMMAND =====================
    if (command === 'ontop') {
        // Check if user is staff or admin
        if (!isStaff && !isAdmin) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ This command is for staff only!')
                ]
            });
        }

        // Get the victim
        const victim = message.mentions.members.first();
        if (!victim) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription(`❌ Usage: \`${prefix}ontop @user <reason>\`\nExample: \`${prefix}ontop @user Scamming multiple users\``)
                ]
            });
        }

        // Get the reason (everything after the mention)
        const reason = args.slice(1).join(' ') || 'Suspicious activity detected';

        // Send the scam alert
        const result = await sendScamAlert(message.guild, message.member, victim, reason);

        if (!result.success) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription(result.error)
                ]
            });
        }

        // Reply to staff
        const replyEmbed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle('✅ Scam Alert Sent')
            .setDescription(
                `🚨 Scam alert has been sent to ${victim}\n` +
                `📝 Reason: ${reason}\n` +
                `💬 DM Status: ${result.dmSent ? '✅ Delivered' : '❌ Failed (DMs closed)'}\n\n` +
                `📌 The victim will see two buttons:\n` +
                `• **Join Us** → Gets the scam alert role\n` +
                `• **Leave Us** → Gets kicked from the server`
            )
            .setTimestamp();

        await message.reply({ embeds: [replyEmbed] });
        
        // Delete the command message
        await message.delete().catch(() => {});
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
        if (!isStaff && !isAdmin) {
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

    // ===================== STATS =====================
    if (command === 'stats') {
        const totalTickets = conf.ticketCounter || 0;
        const totalVouches = userVouchCounts.size;
        let topVouched = '';
        if (userVouchCounts.size > 0) {
            const sorted = [...userVouchCounts.entries()].sort((a, b) => b[1] - a[1]);
            topVouched = sorted.slice(0, 5).map(([id, count], i) => 
                `${i+1}. <@${id}> - ${count} vouches`
            ).join('\n');
        }
        const embed = new EmbedBuilder()
            .setColor('#2B2D31')
            .setTitle('📊 Server Statistics')
            .addFields(
                { name: '📝 Total Tickets', value: `${totalTickets}`, inline: true },
                { name: '🎫 Total Vouches', value: `${totalVouches}`, inline: true },
                { name: '🟢 Auto-Vouch', value: conf.running ? 'Active' : 'Inactive', inline: true },
                { name: '🚨 Scam Alert System', value: conf.scamAlertRoleId ? '✅ Configured' : '❌ Not Configured', inline: true },
                { name: '🏆 Top Vouched', value: topVouched || 'No vouches yet', inline: false }
            )
            .setTimestamp();
        await message.reply({ embeds: [embed] });
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
            const interval = formatTime(conf.intervalTime);
            const channel = conf.vouchChannelId ? `<#${conf.vouchChannelId}>` : 'Not Set';
            const target = conf.targetRoleId ? `<@&${conf.targetRoleId}>` : 'Not Set';
            const giver = conf.giverRoleId ? `<@&${conf.giverRoleId}>` : 'Not Set';
            const totalVouches = userVouchCounts.size;
            
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#2B2D31')
                    .setTitle('🎫 Auto-Vouch Status')
                    .addFields(
                        { name: 'Status', value: status, inline: true },
                        { name: 'Interval', value: interval, inline: true },
                        { name: 'Total Vouches', value: `${totalVouches}`, inline: true },
                        { name: 'Channel', value: channel, inline: false },
                        { name: 'Target Role', value: target, inline: true },
                        { name: 'Giver Role', value: giver, inline: true }
                    )
                    .setTimestamp()
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

    // ===== SCAM ALERT BUTTONS =====
    if (interaction.customId?.startsWith('scam_join_') || interaction.customId?.startsWith('scam_leave_')) {
        const victimId = interaction.customId.split('_')[2];
        const action = interaction.customId.split('_')[1];
        const isJoin = action === 'join';

        // Verify this is the victim clicking
        if (user.id !== victimId) {
            return interaction.reply({
                content: '❌ This scam alert is not for you!',
                ephemeral: true
            });
        }

        const victim = await interaction.guild.members.fetch(victimId).catch(() => null);
        if (!victim) {
            return interaction.reply({
                content: '❌ You are no longer in this server.',
                ephemeral: true
            });
        }

        if (isJoin) {
            // JOIN: Give the role
            const role = interaction.guild.roles.cache.get(conf.scamAlertRoleId);
            if (role) {
                await victim.roles.add(role);
                
                // Send confirmation
                const embed = new EmbedBuilder()
                    .setColor('#2ECC71')
                    .setTitle('🤝 Welcome to the Trusted Community!')
                    .setDescription(conf.scamAlertJoinMessage)
                    .addFields(
                        { name: 'Role Added', value: `${role}`, inline: true },
                        { name: 'Decision', value: '✅ Joined', inline: true }
                    )
                    .setFooter({ text: 'Cosmic™ Security System' })
                    .setTimestamp();

                await interaction.update({
                    embeds: [embed],
                    components: []
                });

                // Log the decision
                if (conf.scamAlertLogChannel) {
                    const logChan = interaction.guild.channels.cache.get(conf.scamAlertLogChannel);
                    if (logChan) {
                        const logEmbed = new EmbedBuilder()
                            .setColor('#2ECC71')
                            .setTitle('✅ Scam Alert Resolved - JOINED')
                            .setDescription(`${victim} chose to join and received ${role}`)
                            .addFields(
                                { name: 'User', value: `${victim} (\`${victim.id}\`)`, inline: true },
                                { name: 'Decision', value: '✅ Joined', inline: true }
                            )
                            .setTimestamp();
                        await logChan.send({ embeds: [logEmbed] });
                    }
                }

                // Send a thank you DM
                try {
                    await victim.send({
                        embeds: [new EmbedBuilder()
                            .setColor('#2ECC71')
                            .setTitle('🤝 Welcome to the Trusted Community!')
                            .setDescription('You made the right choice! Enjoy your stay and stay safe! 🛡️')
                        ]
                    });
                } catch (e) {}

                return interaction.followUp({
                    content: `✅ ${victim} has joined the trusted community! They received ${role}`,
                    ephemeral: false
                });
            } else {
                return interaction.reply({
                    content: '❌ The role for scam alerts is not configured properly. Please contact an admin.',
                    ephemeral: true
                });
            }
        } else {
            // LEAVE: Kick the user
            const reason = 'Chose to leave during scam alert process';
            await victim.kick(reason);

            const embed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('🚪 Goodbye')
                .setDescription(conf.scamAlertLeaveMessage)
                .addFields(
                    { name: 'Decision', value: '❌ Left', inline: true }
                )
                .setFooter({ text: 'Cosmic™ Security System' })
                .setTimestamp();

            await interaction.update({
                embeds: [embed],
                components: []
            });

            // Log the decision
            if (conf.scamAlertLogChannel) {
                const logChan = interaction.guild.channels.cache.get(conf.scamAlertLogChannel);
                if (logChan) {
                    const logEmbed = new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle('❌ Scam Alert Resolved - LEFT')
                        .setDescription(`${victim.user.username} chose to leave and was kicked`)
                        .addFields(
                            { name: 'User', value: `${victim.user.username} (\`${victim.id}\`)`, inline: true },
                            { name: 'Decision', value: '❌ Left', inline: true }
                        )
                        .setTimestamp();
                    await logChan.send({ embeds: [logEmbed] });
                }
            }

            return interaction.followUp({
                content: `❌ ${victim.user.username} chose to leave and was kicked.`,
                ephemeral: false
            });
        }
    }

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

        if (interaction.customId === 'amount_modal') {
            const min = parseInt(interaction.fields.getTextInputValue('min_amount'));
            const max = parseInt(interaction.fields.getTextInputValue('max_amount'));
            
            if (isNaN(min) || isNaN(max) || min < 1 || max < min) {
                return interaction.reply({
                    content: '❌ Invalid amount. Min must be >= 1 and Max must be >= Min.',
                    ephemeral: true
                });
            }
            
            await updateServerConfig(guildId, { 
                vouchMinAmount: min, 
                vouchMaxAmount: max 
            });
            
            const dashData = await getDashboard(guildId, 'vouch_setup');
            return interaction.update(dashData);
        }

        if (interaction.customId === 'scam_edit_messages_modal') {
            const alertMsg = interaction.fields.getTextInputValue('alert_message');
            const joinMsg = interaction.fields.getTextInputValue('join_message');
            const leaveMsg = interaction.fields.getTextInputValue('leave_message');
            
            await updateServerConfig(guildId, {
                scamAlertMessage: alertMsg,
                scamAlertJoinMessage: joinMsg,
                scamAlertLeaveMessage: leaveMsg
            });
            
            const dashData = await getDashboard(guildId, 'scam_setup');
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
            'v_set_giver': () => updateServerConfig(guildId, { giverRoleId: interaction.values[0] }),
            'scam_set_role': () => updateServerConfig(guildId, { scamAlertRoleId: interaction.values[0] })
        };

        const handler = handlers[interaction.customId];
        if (handler) {
            await handler();
            const page = interaction.customId.startsWith('mm_') ? 'mm_setup' : 
                        interaction.customId.startsWith('v_') ? 'vouch_setup' : 'scam_setup';
            const dashData = await getDashboard(guildId, page);
            return interaction.update(dashData);
        }
    }

    // ===== CHANNEL SELECT MENUS =====
    if (interaction.isChannelSelectMenu()) {
        const handlers = {
            'mm_set_category': () => updateServerConfig(guildId, { ticketCategoryId: interaction.values[0] }),
            'mm_set_logs': () => updateServerConfig(guildId, { logChannelId: interaction.values[0] }),
            'v_set_chan': () => updateServerConfig(guildId, { vouchChannelId: interaction.values[0] }),
            'scam_set_log': () => updateServerConfig(guildId, { scamAlertLogChannel: interaction.values[0] })
        };

        const handler = handlers[interaction.customId];
        if (handler) {
            await handler();
            const page = interaction.customId.startsWith('mm_') ? 'mm_setup' : 
                        interaction.customId.startsWith('v_') ? 'vouch_setup' : 'scam_setup';
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

    // Change Vouch Amount
    if (interaction.customId === 'change_vouch_amount') {
        const modal = new ModalBuilder()
            .setCustomId('amount_modal')
            .setTitle('Set Vouch Amount Range')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('min_amount')
                        .setLabel('Minimum Vouch Amount')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setPlaceholder('1')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('max_amount')
                        .setLabel('Maximum Vouch Amount')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setPlaceholder('5')
                )
            );
        return interaction.showModal(modal);
    }

    // Edit Scam Alert Messages
    if (interaction.customId === 'scam_edit_messages') {
        const modal = new ModalBuilder()
            .setCustomId('scam_edit_messages_modal')
            .setTitle('Edit Scam Alert Messages')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('alert_message')
                        .setLabel('Alert Message')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                        .setPlaceholder('Enter the scam alert message...')
                        .setValue(conf.scamAlertMessage || '⚠️ SCAM ALERT!...')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('join_message')
                        .setLabel('Join Message')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                        .setPlaceholder('Message when user joins...')
                        .setValue(conf.scamAlertJoinMessage || '✅ You chose to join us!...')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('leave_message')
                        .setLabel('Leave Message')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                        .setPlaceholder('Message when user leaves...')
                        .setValue(conf.scamAlertLeaveMessage || '❌ You chose to leave...')
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

    // Vouch Confirm
    if (interaction.customId === 'vouch_confirm') {
        const embed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor('#2ECC71')
            .addFields(
                { name: '✅ Status', value: 'Verified by community', inline: true },
                { name: '🔒 Trust Score', value: '100%', inline: true }
            );
        
        await interaction.update({ embeds: [embed], components: [] });
        await interaction.followUp({
            content: '✅ **Vouch confirmed and verified!**',
            ephemeral: true
        });
        return;
    }

    // Vouch Report
    if (interaction.customId === 'vouch_report') {
        const modal = new ModalBuilder()
            .setCustomId('report_modal')
            .setTitle('Report Vouch')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('report_reason')
                        .setLabel('Reason for reporting')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                        .setPlaceholder('Explain why this vouch should be removed...')
                )
            );
        return interaction.showModal(modal);
    }

    // Vouch Back
    if (interaction.customId === 'vouch_back') {
        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🔄 Vouch Back Request')
            .setDescription(`<@${user.id}> wants to vouch back!`)
            .addFields(
                { name: 'Status', value: '⏳ Pending staff approval' }
            )
            .setTimestamp();
        
        await interaction.reply({
            embeds: [embed],
            ephemeral: false
        });
        return;
    }

    // ===== TICKET BUTTONS =====
    // On Top Ticket Button (moves ticket to top)
    if (interaction.customId === 'ontop_ticket') {
        if (!conf.staffRoleId || !interaction.member.roles.cache.has(conf.staffRoleId)) {
            return interaction.reply({
                content: '❌ Staff access only.',
                ephemeral: true
            });
        }

        try {
            await interaction.channel.setPosition(0);
            await interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#2ECC71')
                    .setTitle('⬆️ Ticket Moved to Top')
                    .setDescription('This ticket has been moved to the top of the category.')
                ]
            });
        } catch (error) {
            await interaction.reply({
                content: '❌ Failed to move ticket. Check bot permissions.',
                ephemeral: true
            });
        }
        return;
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
            const newCounter = (conf.ticketCounter || 0) + 1;
            await updateServerConfig(guildId, { ticketCounter: newCounter });

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
                confirmationEmbedMessageId: null,
                createdAt: Date.now()
            });

            await sendTicketLog(interaction.guild, conf, '🎫 Ticket Opened', 
                `Ticket ${ticketChannel} created by ${user} (Ticket #${newCounter})`, '#2ECC71');

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('🎫 Ticket Created')
                .setDescription(
                    `Welcome <@${user.id}>,\n\n` +
                    `**Ticket #${newCounter}**\n\n` +
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
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('ontop_ticket')
                    .setLabel('⬆️ On Top')
                    .setStyle(ButtonStyle.Secondary)
            );

            await ticketChannel.send({ content: `${user} 👋`, embeds: [embed], components: [row] });
            
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#2ECC71')
                    .setDescription(`✅ Ticket #${newCounter} created: ${ticketChannel}`)
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
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('ontop_ticket')
                .setLabel('⬆️ On Top')
                .setStyle(ButtonStyle.Secondary)
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
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('ontop_ticket')
                .setLabel('⬆️ On Top')
                .setStyle(ButtonStyle.Secondary)
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
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('ontop_ticket')
                .setLabel('⬆️ On Top')
                .setStyle(ButtonStyle.Secondary)
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
<<<<<<< HEAD
client.login(BOT_TOKEN);
=======
client.login(BOT_TOKEN);
>>>>>>> 00b167d7b0b570b878b94885cbf111fe43969fa3
