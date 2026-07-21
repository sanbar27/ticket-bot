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

const BOT_TOKEN = process.env.DISCORD_TOKEN;
if (!BOT_TOKEN) {
    console.error('❌ DISCORD_TOKEN is missing!');
    process.exit(1);
}

const CONFIG_FILE = path.join(__dirname, 'config.json');

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
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
            staffRoles: [],
            dashboardRoles: [],
            adminRoles: [],
            ticketCategoryId: null,
            logChannelId: null,
            vouchChannelId: null,
            targetRoleId: null,
            giverRoleId: null,
            intervalTime: 60000,
            running: false,
            whitelists: {},
            vouchMinAmount: 1,
            vouchMaxAmount: 5,
            scamAlertRoleId: null,
            scamAlertLogChannel: null,
            vouchLogChannel: null,
            vouchVerifyRole: null,
            scamAlertMessage: "🚨 **YOU'VE BEEN SCAMMED!**\n\nYou have been identified as a scammer. Choose your fate:\n\n💰 **JOIN US AND BE RICH** - Prove your innocence\n💀 **LEAVE AND BE BROKE** - Get kicked from the server\n\nMake your choice.",
            scamAlertJoinMessage: "💰 You chose to join us! Welcome to the rich community! 🤑",
            scamAlertLeaveMessage: "💀 You chose to leave and be broke. Goodbye! 👋"
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
            staffRoles: [],
            dashboardRoles: [],
            adminRoles: [],
            ticketCategoryId: null,
            logChannelId: null,
            vouchChannelId: null,
            targetRoleId: null,
            giverRoleId: null,
            intervalTime: 60000,
            running: false,
            whitelists: {},
            vouchMinAmount: 1,
            vouchMaxAmount: 5,
            scamAlertRoleId: null,
            scamAlertLogChannel: null,
            vouchLogChannel: null,
            vouchVerifyRole: null,
            scamAlertMessage: "🚨 **YOU'VE BEEN SCAMMED!**\n\nYou have been identified as a scammer. Choose your fate:\n\n💰 **JOIN US AND BE RICH** - Prove your innocence\n💀 **LEAVE AND BE BROKE** - Get kicked from the server\n\nMake your choice.",
            scamAlertJoinMessage: "💰 You chose to join us! Welcome to the rich community! 🤑",
            scamAlertLeaveMessage: "💀 You chose to leave and be broke. Goodbye! 👋"
        };
    }
    Object.assign(allConfigs[guildId], updates);
    saveConfig(allConfigs);
    return allConfigs[guildId];
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

function parseTime(str) {
    if (!str) return null;
    const match = str.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return null;
    const val = parseInt(match[1]);
    const unit = match[2];
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return val * multipliers[unit];
}

function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
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

function hasStaffRole(member, conf) {
    if (!conf.staffRoles || conf.staffRoles.length === 0) return false;
    return conf.staffRoles.some(roleId => member.roles.cache.has(roleId));
}

function hasDashboardRole(member, conf) {
    if (!conf.dashboardRoles || conf.dashboardRoles.length === 0) return false;
    return conf.dashboardRoles.some(roleId => member.roles.cache.has(roleId));
}

function hasAdminRole(member, conf) {
    if (!conf.adminRoles || conf.adminRoles.length === 0) return false;
    return conf.adminRoles.some(roleId => member.roles.cache.has(roleId));
}

function hasVouchVerifyRole(member, conf) {
    if (!conf.vouchVerifyRole) return false;
    return member.roles.cache.has(conf.vouchVerifyRole);
}

const activeTrades = new Map();
const activeVouchTimers = new Map();
const afkUsers = new Map();
const userVouchCounts = new Map();
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

// ===================== VOUCH SYSTEM FUNCTIONS =====================

// Handle /vouch submit
async function handleVouchSubmit(interaction) {
    // Defer FIRST - this prevents timeout!
    await interaction.deferReply({ flags: 64 }); // Using flags instead of ephemeral
    
    const guildId = interaction.guild.id;
    const conf = getServerConfig(guildId);
    
    const trade = interaction.options.getString('trade');
    const image = interaction.options.getAttachment('screenshot');

    if (!conf.vouchLogChannel) {
        return interaction.editReply({
            content: '❌ Vouch log channel is not configured! Ask an admin to set it up in `!dashboard`.'
        });
    }

    const vouchChannel = interaction.guild.channels.cache.get(conf.vouchLogChannel);
    if (!vouchChannel) {
        return interaction.editReply({
            content: '❌ Vouch log channel no longer exists! Ask an admin to fix it.'
        });
    }

    const embed = new EmbedBuilder()
        .setColor('#2ECC71')
        .setTitle('📩 New Vouch Submitted')
        .setDescription(
            `**Submitted By:** ${interaction.user}\n` +
            `**Trade:** \`${trade}\``
        )
        .setFooter({ text: 'Cosmic™ Vouch System', iconURL: interaction.guild.iconURL({ dynamic: true }) })
        .setTimestamp();

    if (image) {
        embed.setImage(image.url);
        embed.addFields({ name: '📷 Screenshot', value: `[Click to view](${image.url})`, inline: false });
    }

    embed.addFields(
        { name: '📊 Status', value: '⏳ Pending Verification', inline: true },
        { name: '🛡️ Verified By', value: '❌ Not yet verified', inline: true }
    );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`vouch_verify_${interaction.user.id}`)
            .setLabel('✅ Verify Vouch')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅'),
        new ButtonBuilder()
            .setCustomId(`vouch_deny_${interaction.user.id}`)
            .setLabel('❌ Deny Vouch')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌')
    );

    await vouchChannel.send({
        content: conf.vouchVerifyRole ? `<@&${conf.vouchVerifyRole}> New vouch needs verification!` : null,
        embeds: [embed],
        components: [row]
    });

    await interaction.editReply({
        content: `✅ Vouch submitted! A staff member will review it shortly.`
    });
}

// Handle vouch verify button
async function handleVouchVerify(interaction) {
    // Defer update first
    await interaction.deferUpdate();
    
    const guildId = interaction.guild.id;
    const conf = getServerConfig(guildId);
    
    if (!hasStaffRole(interaction.member, conf) && !hasAdminRole(interaction.member, conf) && !hasVouchVerifyRole(interaction.member, conf)) {
        return interaction.followUp({
            content: '❌ You do not have permission to verify vouches!',
            flags: 64
        });
    }

    const originalEmbed = interaction.message.embeds[0];
    if (!originalEmbed) {
        return interaction.followUp({
            content: '❌ Could not find the vouch embed.',
            flags: 64
        });
    }

    const updatedEmbed = EmbedBuilder.from(originalEmbed)
        .setColor('#2ECC71')
        .addFields(
            { name: '📊 Status', value: '✅ Verified', inline: true },
            { name: '🛡️ Verified By', value: `${interaction.user}`, inline: true }
        );

    await interaction.editReply({
        embeds: [updatedEmbed],
        components: []
    });

    const submitterId = interaction.customId.split('_')[2];
    if (submitterId) {
        const current = userVouchCounts.get(submitterId) || 0;
        userVouchCounts.set(submitterId, current + 1);
    }

    await interaction.followUp({
        content: `✅ Vouch verified by ${interaction.user}!`,
        flags: 64
    });
}

// Handle vouch deny button
async function handleVouchDeny(interaction) {
    await interaction.deferUpdate();
    
    const guildId = interaction.guild.id;
    const conf = getServerConfig(guildId);
    
    if (!hasStaffRole(interaction.member, conf) && !hasAdminRole(interaction.member, conf) && !hasVouchVerifyRole(interaction.member, conf)) {
        return interaction.followUp({
            content: '❌ You do not have permission to deny vouches!',
            flags: 64
        });
    }

    const originalEmbed = interaction.message.embeds[0];
    if (!originalEmbed) {
        return interaction.followUp({
            content: '❌ Could not find the vouch embed.',
            flags: 64
        });
    }

    const updatedEmbed = EmbedBuilder.from(originalEmbed)
        .setColor('#ED4245')
        .addFields(
            { name: '📊 Status', value: '❌ Denied', inline: true },
            { name: '🛡️ Denied By', value: `${interaction.user}`, inline: true }
        );

    await interaction.editReply({
        embeds: [updatedEmbed],
        components: []
    });

    await interaction.followUp({
        content: `❌ Vouch denied by ${interaction.user}!`,
        flags: 64
    });
}

// Handle /vouches command
async function handleVouches(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const count = userVouchCounts.get(target.id) || 0;

    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('📊 Vouch Count')
        .setDescription(
            `${target} has **${count}** verified vouches! 🎉`
        )
        .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
        .setFooter({ text: 'Cosmic™ Vouch System' })
        .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: 64 });
}

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
            .setFooter({ text: 'Cosmic™ Vouch System', iconURL: guild.iconURL({ dynamic: true }) })
            .setTimestamp();

        const currentCount = userVouchCounts.get(randomTarget.id) || 0;
        userVouchCounts.set(randomTarget.id, currentCount + vouchAmount);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('vouch_confirm')
                .setLabel('✅ Confirm')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('vouch_report')
                .setLabel('🚨 Report')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('vouch_back')
                .setLabel('🔄 Vouch Back')
                .setStyle(ButtonStyle.Secondary)
        );

        await channel.send({ 
            embeds: [embed], 
            components: [row] 
        });

        console.log(`✅ Auto-vouch posted in ${guild.name} (${vouchAmount} rep)`);
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

async function sendScamAlert(guild, staffMember, victim, reason) {
    const conf = getServerConfig(guild.id);
    
    if (!conf.scamAlertRoleId) {
        return {
            success: false,
            error: '❌ Scam alert role not configured! Use `!dashboard` to set it up.'
        };
    }

    if (victim.id === client.user.id || victim.id === staffMember.id) {
        return {
            success: false,
            error: '❌ Invalid user!'
        };
    }

    const cooldownKey = `scam_${victim.id}`;
    if (scamAlertCooldowns.has(cooldownKey)) {
        const remaining = scamAlertCooldowns.get(cooldownKey) - Date.now();
        if (remaining > 0) {
            return {
                success: false,
                error: `⏳ Wait ${formatTime(remaining)} before alerting this user again.`
            };
        }
    }

    scamAlertCooldowns.set(cooldownKey, Date.now() + 300000);
    setTimeout(() => scamAlertCooldowns.delete(cooldownKey), 300000);

    const embed = new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle('🚨 YOU\'VE BEEN SCAMMED!')
        .setDescription(conf.scamAlertMessage)
        .addFields(
            { name: '👤 Accused User', value: `${victim}`, inline: true },
            { name: '🛡️ Reported By', value: `${staffMember}`, inline: true },
            { name: '📝 Reason', value: reason || 'Suspicious activity detected', inline: false },
            { name: '⏱️ Time', value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true },
            { name: '📊 Status', value: '⏳ Awaiting decision', inline: true }
        )
        .setThumbnail(victim.displayAvatarURL({ dynamic: true, size: 256 }))
        .setFooter({ text: 'Cosmic™ Security System', iconURL: guild.iconURL({ dynamic: true }) })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`scam_join_${victim.id}`)
            .setLabel('💰 JOIN US AND BE RICH')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🤝'),
        new ButtonBuilder()
            .setCustomId(`scam_leave_${victim.id}`)
            .setLabel('💀 LEAVE AND BE BROKE')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🚪')
    );

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
                    { name: '💬 DM Status', value: dmSent ? '✅ Sent' : '❌ Failed', inline: true },
                    { name: '⏱️ Time', value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true }
                )
                .setTimestamp();
            await logChan.send({ embeds: [logEmbed] });
        }
    }

    return {
        success: true,
        dmSent: dmSent,
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
            { label: '🤝 MM Roles', value: 'nav_mm_roles' },
            { label: '📁 MM Channels', value: 'nav_mm_channels' },
            { label: '🎫 Vouch Setup', value: 'nav_vouch_setup' },
            { label: '🚨 Scam Alert', value: 'nav_scam_setup' },
            { label: '⚙️ Settings', value: 'nav_settings' },
            { label: '📜 Commands', value: 'nav_cmds' }
        ]);
    const navRow = new ActionRowBuilder().addComponents(navMenu);

    switch(pageName) {
        case 'home':
            embed.setTitle('⚙️ Central Control Panel')
                .setDescription(
                    `**Current Prefix:** \`${conf.prefix}\`\n\n` +
                    `**👥 Staff Roles:** ${conf.staffRoles && conf.staffRoles.length > 0 ? conf.staffRoles.map(id => `<@&${id}>`).join(', ') : '❌ None Set'}\n` +
                    `**👑 Dashboard Roles:** ${conf.dashboardRoles && conf.dashboardRoles.length > 0 ? conf.dashboardRoles.map(id => `<@&${id}>`).join(', ') : '❌ None Set'}\n` +
                    `**⚡ Admin Roles:** ${conf.adminRoles && conf.adminRoles.length > 0 ? conf.adminRoles.map(id => `<@&${id}>`).join(', ') : '❌ None Set'}\n\n` +
                    `**📁 Category:** ${conf.ticketCategoryId ? `<#${conf.ticketCategoryId}>` : '❌ Not Set'}\n` +
                    `**📝 Logs:** ${conf.logChannelId ? `<#${conf.logChannelId}>` : '❌ Not Set'}\n\n` +
                    `**🎫 Auto-Vouch:** ${conf.running ? '🟢 Running' : '🔴 Stopped'}\n` +
                    `**⏱️ Interval:** ${formatTime(conf.intervalTime)}`
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

        case 'mm_roles':
            embed.setTitle('🤝 MM Roles Configuration')
                .setDescription(
                    `**👥 Staff Roles:** ${conf.staffRoles && conf.staffRoles.length > 0 ? conf.staffRoles.map(id => `<@&${id}>`).join(', ') : '❌ None Set'}\n` +
                    `**👑 Dashboard Roles:** ${conf.dashboardRoles && conf.dashboardRoles.length > 0 ? conf.dashboardRoles.map(id => `<@&${id}>`).join(', ') : '❌ None Set'}\n` +
                    `**⚡ Admin Roles:** ${conf.adminRoles && conf.adminRoles.length > 0 ? conf.adminRoles.map(id => `<@&${id}>`).join(', ') : '❌ None Set'}`
                );
            components = [
                navRow,
                new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId('mm_set_staff')
                        .setPlaceholder('Add Staff Role')
                        .setMinValues(0)
                        .setMaxValues(10)
                ),
                new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId('mm_set_dashboard')
                        .setPlaceholder('Add Dashboard Role')
                        .setMinValues(0)
                        .setMaxValues(10)
                ),
                new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId('mm_set_admin')
                        .setPlaceholder('Add Admin Role')
                        .setMinValues(0)
                        .setMaxValues(10)
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('clear_staff_roles')
                        .setLabel('🗑️ Clear Staff Roles')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('clear_dashboard_roles')
                        .setLabel('🗑️ Clear Dashboard Roles')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('clear_admin_roles')
                        .setLabel('🗑️ Clear Admin Roles')
                        .setStyle(ButtonStyle.Danger)
                )
            ];
            break;

        case 'mm_channels':
            embed.setTitle('📁 MM Channels Configuration')
                .setDescription(
                    `**📁 Ticket Category:** ${conf.ticketCategoryId ? `<#${conf.ticketCategoryId}>` : '❌ Not Set'}\n` +
                    `**📝 Log Channel:** ${conf.logChannelId ? `<#${conf.logChannelId}>` : '❌ Not Set'}`
                );
            components = [
                navRow,
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
                    `**Message Preview:**\n${conf.scamAlertMessage ? conf.scamAlertMessage.substring(0, 100) + '...' : 'Not Set'}`
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
                    `> \`${conf.prefix}add @user\` - Add user to ticket\n` +
                    `> \`${conf.prefix}ontop @user <reason>\` - 🚨 SCAM ALERT system\n\n` +
                    `**🎫 Auto-Vouch**\n` +
                    `> \`${conf.prefix}vouch start\` - Start auto-vouch\n` +
                    `> \`${conf.prefix}vouch stop\` - Stop auto-vouch\n` +
                    `> \`${conf.prefix}vouch status\` - Check vouch status\n\n` +
                    `**⚙️ Configuration**\n` +
                    `> \`${conf.prefix}whitelist @user\` - Manage permissions\n` +
                    `> \`${conf.prefix}afk\` - Toggle AFK mode\n` +
                    `> \`${conf.prefix}help\` - Show middleman guide\n\n` +
                    `**📩 Vouch System**\n` +
                    `> \`/vouch\` - Submit a vouch with trade details\n` +
                    `> \`/vouches @user\` - Check user's vouches`
                );
            components = [navRow];
            break;
    }

    return { embeds: [embed], components };
}

async function sendHelpMessage(message) {
    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🤝 Middleman System Guide')
        .setDescription('Here\'s how the middleman system works:')
        .addFields(
            { name: '📋 Step 1: Open a Ticket', value: 'Click the **"Request Middleman"** button or use `!setup-ticket` to create a ticket channel.', inline: false },
            { name: '👤 Step 2: Add Trading Partner', value: 'In your ticket, send the **username** or **ID** of the person you\'re trading with.', inline: false },
            { name: '📝 Step 3: Provide Deal Details', value: 'Type the details of your trade (e.g., "Giving 5000 Robux for $20 PayPal").', inline: false },
            { name: '🤝 Step 4: Partner Confirms', value: 'Your trading partner will **confirm** the deal details.', inline: false },
            { name: '🛡️ Step 5: Middleman Takes Over', value: 'A staff member will **claim** the ticket and assist with the trade.', inline: false },
            { name: '🔒 Step 6: Complete Trade', value: 'The middleman will ensure both parties complete their part of the trade safely.', inline: false }
        )
        .addFields(
            { name: '💡 How It Works', value: '**User 1** gives item to **Middleman** → **Middleman** verifies → **User 2** sends payment → **Middleman** gives item to **User 2**', inline: false }
        )
        .addFields(
            { name: '📌 Ticket Commands', value: '`!close` - Close ticket (Staff only)\n`!add @user` - Add user to ticket (Staff only)', inline: false }
        )
        .setFooter({ text: 'Cosmic™ Middleman System • Safe & Secure Trades' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

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

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    
    const guildId = message.guild.id;
    const conf = getServerConfig(guildId);
    const prefix = conf.prefix;
    const isPing = message.content === `<@${client.user.id}>`;

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

    // ===== HELP COMMAND =====
    if (message.content === `${prefix}help` || message.content === `${prefix}help middleman`) {
        await sendHelpMessage(message);
        return;
    }

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
            if (conf.staffRoles && conf.staffRoles.length > 0) {
                conf.staffRoles.forEach(roleId => {
                    overwrites.push({ 
                        id: roleId, 
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] 
                    });
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
    const isStaff = hasStaffRole(message.member, conf);

    if (command === 'dashboard') {
        const hasDashRole = hasDashboardRole(message.member, conf);
        const hasAdmin = hasAdminRole(message.member, conf);
        
        if (!isAdmin && message.author.id !== message.guild.ownerId && !hasDashRole && !hasAdmin) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ Access Denied. You need a Dashboard Role.')
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

    if (command === 'add' && message.channel.name.startsWith('mm-')) {
        if (!isStaff && !isAdmin) {
            return message.reply('❌ This command is for staff only!');
        }

        const target = message.mentions.members.first();
        if (!target) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription(`❌ Usage: \`${prefix}add @user\``)
                ]
            });
        }

        try {
            await message.channel.permissionOverwrites.edit(target.id, {
                ViewChannel: true,
                SendMessages: true
            });

            await message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#2ECC71')
                    .setDescription(`✅ Added ${target} to the ticket!`)
                ]
            });

            await sendTicketLog(message.guild, conf, '👤 User Added', 
                `${target} was added to ticket \`${message.channel.name}\` by ${message.author}`, '#2ECC71');

        } catch (error) {
            await message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ Failed to add user. Check bot permissions.')
                ]
            });
        }
        return;
    }

    if (command === 'ontop') {
        if (!isStaff && !isAdmin) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ This command is for staff only!')
                ]
            });
        }

        let victim = message.mentions.members.first();
        
        if (!victim && args[0]) {
            const id = args[0].replace(/[<@!>]/g, '').trim();
            if (/^\d+$/.test(id)) {
                try {
                    victim = await message.guild.members.fetch(id);
                } catch (e) {}
            }
        }

        if (!victim) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription(`❌ Usage: \`${prefix}ontop @user <reason>\` or \`${prefix}ontop <user_id> <reason>\`\nExample: \`${prefix}ontop @user Scamming multiple users\``)
                ]
            });
        }

        const reason = args.slice(1).join(' ') || 'Suspicious activity detected';
        const result = await sendScamAlert(message.guild, message.member, victim, reason);

        if (!result.success) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription(result.error)
                ]
            });
        }

        const replyEmbed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle('✅ Scam Alert Sent')
            .setDescription(
                `🚨 Scam alert has been sent to ${victim}\n` +
                `📝 Reason: ${reason}\n` +
                `💬 DM Status: ${result.dmSent ? '✅ Delivered' : '❌ Failed (DMs closed)'}\n\n` +
                `📌 The victim will see two buttons:\n` +
                `• **JOIN US AND BE RICH** → Gets the scam alert role\n` +
                `• **LEAVE AND BE BROKE** → Gets kicked from the server`
            )
            .setTimestamp();

        await message.reply({ embeds: [replyEmbed] });
        await message.delete().catch(() => {});
        return;
    }

    // ===== WHITELIST =====
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

    // ===== UNBAN =====
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

    // ===== AFK =====
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

    // ===== PURGE =====
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

    // ===== MUTE =====
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

    // ===== KICK =====
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

    // ===== BAN =====
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

    // ===== FBAN =====
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

    // ===== VOUCH COMMANDS =====
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

    // ===== SLASH COMMANDS =====
    if (interaction.isCommand()) {
        const { commandName } = interaction;
        const member = interaction.member;
        const isStaff = hasStaffRole(member, conf);
        const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

        // Handle /vouch
        if (commandName === 'vouch') {
            await handleVouchSubmit(interaction);
            return;
        }

        // Handle /vouches
        if (commandName === 'vouches') {
            await handleVouches(interaction);
            return;
        }

        // Handle /claim
        if (commandName === 'claim') {
            if (!isStaff && !isAdmin) {
                return interaction.reply({
                    content: '❌ Staff access only!',
                    flags: 64
                });
            }

            const channelId = interaction.channelId;
            const tradeState = activeTrades.get(channelId);
            if (!tradeState) {
                return interaction.reply({
                    content: '❌ This is not a valid ticket channel!',
                    flags: 64
                });
            }

            tradeState.claimedBy = interaction.user.id;
            activeTrades.set(channelId, tradeState);

            await interaction.reply({
                content: `🛡️ **Ticket Claimed by** <@${interaction.user.id}>`,
                flags: 64
            });

            await interaction.channel.send({
                embeds: [new EmbedBuilder()
                    .setColor('#FEE75C')
                    .setDescription(`🛡️ **Ticket Claimed by** <@${interaction.user.id}>`)
                ]
            });
            return;
        }

        // Handle /close
        if (commandName === 'close') {
            if (!isStaff && !isAdmin) {
                return interaction.reply({
                    content: '❌ Staff access only!',
                    flags: 64
                });
            }

            if (!interaction.channel.name.startsWith('mm-')) {
                return interaction.reply({
                    content: '❌ This command can only be used in ticket channels!',
                    flags: 64
                });
            }

            await interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('🔒 **Closing ticket in 5 seconds...**')
                ]
            });

            await sendTicketLog(interaction.guild, conf, '🔒 Ticket Closed', 
                `Ticket \`${interaction.channel.name}\` closed by ${interaction.user}`, '#ED4245');
            
            activeTrades.delete(interaction.channelId);
            setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
            return;
        }

        // Handle /add
        if (commandName === 'add') {
            if (!isStaff && !isAdmin) {
                return interaction.reply({
                    content: '❌ Staff access only!',
                    flags: 64
                });
            }

            if (!interaction.channel.name.startsWith('mm-')) {
                return interaction.reply({
                    content: '❌ This command can only be used in ticket channels!',
                    flags: 64
                });
            }

            const target = interaction.options.getUser('user');
            if (!target) {
                return interaction.reply({
                    content: '❌ Please mention a user to add!',
                    flags: 64
                });
            }

            try {
                await interaction.channel.permissionOverwrites.edit(target.id, {
                    ViewChannel: true,
                    SendMessages: true
                });

                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#2ECC71')
                        .setDescription(`✅ Added ${target} to the ticket!`)
                    ]
                });

                await sendTicketLog(interaction.guild, conf, '👤 User Added', 
                    `${target} was added to ticket \`${interaction.channel.name}\` by ${interaction.user}`, '#2ECC71');

            } catch (error) {
                await interaction.reply({
                    content: '❌ Failed to add user. Check bot permissions.',
                    flags: 64
                });
            }
            return;
        }
    }

    // ===== VOUCH VERIFY/DENY BUTTONS =====
    if (interaction.customId?.startsWith('vouch_verify_')) {
        await handleVouchVerify(interaction);
        return;
    }

    if (interaction.customId?.startsWith('vouch_deny_')) {
        await handleVouchDeny(interaction);
        return;
    }

    // ===== SCAM ALERT BUTTONS =====
    if (interaction.customId?.startsWith('scam_join_') || interaction.customId?.startsWith('scam_leave_')) {
        await interaction.deferUpdate();
        
        try {
            const victimId = interaction.customId.split('_')[2];
            const action = interaction.customId.split('_')[1];
            const isJoin = action === 'join';

            if (user.id !== victimId) {
                return interaction.followUp({
                    content: '❌ This scam alert is not for you!',
                    flags: 64
                });
            }

            const victim = await interaction.guild.members.fetch(victimId).catch(() => null);
            if (!victim) {
                return interaction.followUp({
                    content: '❌ You are no longer in this server.',
                    flags: 64
                });
            }

            if (!conf.scamAlertRoleId) {
                return interaction.followUp({
                    content: '❌ Scam alert role is not configured. Please contact an admin.',
                    flags: 64
                });
            }

            if (isJoin) {
                const role = interaction.guild.roles.cache.get(conf.scamAlertRoleId);
                if (!role) {
                    return interaction.followUp({
                        content: '❌ The scam alert role no longer exists. Please contact an admin.',
                        flags: 64
                    });
                }

                await victim.roles.add(role);
                
                const embed = new EmbedBuilder()
                    .setColor('#2ECC71')
                    .setTitle('💰 YOU JOINED AND BECAME RICH!')
                    .setDescription(conf.scamAlertJoinMessage)
                    .addFields(
                        { name: 'Role Added', value: `${role}`, inline: true },
                        { name: 'Decision', value: '✅ Joined - RICH', inline: true }
                    )
                    .setFooter({ text: 'Cosmic™ Security System' })
                    .setTimestamp();

                await interaction.editReply({
                    embeds: [embed],
                    components: []
                });

                if (conf.scamAlertLogChannel) {
                    const logChan = interaction.guild.channels.cache.get(conf.scamAlertLogChannel);
                    if (logChan) {
                        const logEmbed = new EmbedBuilder()
                            .setColor('#2ECC71')
                            .setTitle('✅ Scam Alert Resolved - JOINED')
                            .setDescription(`${victim} chose to join and received ${role}`)
                            .addFields(
                                { name: 'User', value: `${victim} (\`${victim.id}\`)`, inline: true },
                                { name: 'Decision', value: '✅ Joined - RICH', inline: true }
                            )
                            .setTimestamp();
                        await logChan.send({ embeds: [logEmbed] });
                    }
                }

                await interaction.followUp({
                    content: `✅ ${victim} joined and became RICH! They received ${role} 💰`,
                    flags: 64
                });
            } else {
                const username = victim.user.username;

                const embed = new EmbedBuilder()
                    .setColor('#ED4245')
                    .setTitle('💀 YOU LEFT AND ARE NOW BROKE!')
                    .setDescription(conf.scamAlertLeaveMessage)
                    .addFields(
                        { name: 'Decision', value: '❌ Left - BROKE', inline: true }
                    )
                    .setFooter({ text: 'Cosmic™ Security System' })
                    .setTimestamp();

                await interaction.editReply({
                    embeds: [embed],
                    components: []
                });

                if (conf.scamAlertLogChannel) {
                    const logChan = interaction.guild.channels.cache.get(conf.scamAlertLogChannel);
                    if (logChan) {
                        const logEmbed = new EmbedBuilder()
                            .setColor('#ED4245')
                            .setTitle('❌ Scam Alert Resolved - LEFT')
                            .setDescription(`${username} chose to leave and was kicked`)
                            .addFields(
                                { name: 'User', value: `${username} (\`${victimId}\`)`, inline: true },
                                { name: 'Decision', value: '❌ Left - BROKE', inline: true }
                            )
                            .setTimestamp();
                        await logChan.send({ embeds: [logEmbed] });
                    }
                }

                await interaction.followUp({
                    content: `❌ ${username} left and is now BROKE! 💀`,
                    flags: 64
                }).catch(() => null);

                await victim.kick('Chose to leave and be broke');
            }
        } catch (error) {
            console.error('Scam Alert Error:', error);
            await interaction.followUp({
                content: '❌ Something went wrong. Please contact an admin.',
                flags: 64
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
                    flags: 64
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
                    flags: 64
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
                    flags: 64
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
                flags: 64
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
                    flags: 64
                });
            }
            
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && 
                user.id !== interaction.guild.ownerId) {
                return interaction.reply({ 
                    content: '❌ Admins only.',
                    flags: 64
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
        await interaction.deferUpdate();
        
        try {
            const current = getServerConfig(guildId);
            
            if (interaction.customId === 'mm_set_staff') {
                const roles = current.staffRoles || [];
                if (!roles.includes(interaction.values[0])) {
                    roles.push(interaction.values[0]);
                    await updateServerConfig(guildId, { staffRoles: roles });
                }
                const dashData = await getDashboard(guildId, 'mm_roles');
                return await interaction.editReply(dashData);
            }
            
            if (interaction.customId === 'mm_set_dashboard') {
                const roles = current.dashboardRoles || [];
                if (!roles.includes(interaction.values[0])) {
                    roles.push(interaction.values[0]);
                    await updateServerConfig(guildId, { dashboardRoles: roles });
                }
                const dashData = await getDashboard(guildId, 'mm_roles');
                return await interaction.editReply(dashData);
            }
            
            if (interaction.customId === 'mm_set_admin') {
                const roles = current.adminRoles || [];
                if (!roles.includes(interaction.values[0])) {
                    roles.push(interaction.values[0]);
                    await updateServerConfig(guildId, { adminRoles: roles });
                }
                const dashData = await getDashboard(guildId, 'mm_roles');
                return await interaction.editReply(dashData);
            }
            
            if (interaction.customId === 'v_set_target') {
                await updateServerConfig(guildId, { targetRoleId: interaction.values[0] });
                const dashData = await getDashboard(guildId, 'vouch_setup');
                return await interaction.editReply(dashData);
            }
            
            if (interaction.customId === 'v_set_giver') {
                await updateServerConfig(guildId, { giverRoleId: interaction.values[0] });
                const dashData = await getDashboard(guildId, 'vouch_setup');
                return await interaction.editReply(dashData);
            }
            
            if (interaction.customId === 'scam_set_role') {
                await updateServerConfig(guildId, { scamAlertRoleId: interaction.values[0] });
                const dashData = await getDashboard(guildId, 'scam_setup');
                return await interaction.editReply(dashData);
            }
        } catch (error) {
            console.error('Role select error:', error);
            await interaction.followUp({
                content: '❌ Something went wrong. Please try again.',
                flags: 64
            });
        }
        return;
    }

    // ===== CHANNEL SELECT MENUS =====
    if (interaction.isChannelSelectMenu()) {
        await interaction.deferUpdate();
        
        try {
            if (interaction.customId === 'mm_set_category') {
                await updateServerConfig(guildId, { ticketCategoryId: interaction.values[0] });
                const dashData = await getDashboard(guildId, 'mm_channels');
                return await interaction.editReply(dashData);
            }
            
            if (interaction.customId === 'mm_set_logs') {
                await updateServerConfig(guildId, { logChannelId: interaction.values[0] });
                const dashData = await getDashboard(guildId, 'mm_channels');
                return await interaction.editReply(dashData);
            }
            
            if (interaction.customId === 'v_set_chan') {
                await updateServerConfig(guildId, { vouchChannelId: interaction.values[0] });
                const dashData = await getDashboard(guildId, 'vouch_setup');
                return await interaction.editReply(dashData);
            }
            
            if (interaction.customId === 'scam_set_log') {
                await updateServerConfig(guildId, { scamAlertLogChannel: interaction.values[0] });
                const dashData = await getDashboard(guildId, 'scam_setup');
                return await interaction.editReply(dashData);
            }
        } catch (error) {
            console.error('Channel select error:', error);
            await interaction.followUp({
                content: '❌ Something went wrong. Please try again.',
                flags: 64
            });
        }
        return;
    }

    // ===== BUTTONS =====
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
                        .setValue(conf.scamAlertMessage)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('join_message')
                        .setLabel('Join Message')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                        .setValue(conf.scamAlertJoinMessage)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('leave_message')
                        .setLabel('Leave Message')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                        .setValue(conf.scamAlertLeaveMessage)
                )
            );
        return interaction.showModal(modal);
    }

    if (interaction.customId === 'clear_staff_roles') {
        await interaction.deferUpdate();
        await updateServerConfig(guildId, { staffRoles: [] });
        const dashData = await getDashboard(guildId, 'mm_roles');
        return interaction.editReply(dashData);
    }

    if (interaction.customId === 'clear_dashboard_roles') {
        await interaction.deferUpdate();
        await updateServerConfig(guildId, { dashboardRoles: [] });
        const dashData = await getDashboard(guildId, 'mm_roles');
        return interaction.editReply(dashData);
    }

    if (interaction.customId === 'clear_admin_roles') {
        await interaction.deferUpdate();
        await updateServerConfig(guildId, { adminRoles: [] });
        const dashData = await getDashboard(guildId, 'mm_roles');
        return interaction.editReply(dashData);
    }

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

    if (interaction.customId === 'v_toggle') {
        const currentConf = getServerConfig(guildId);
        const newRunning = !currentConf.running;
        
        if (newRunning && (!currentConf.vouchChannelId || !currentConf.targetRoleId || !currentConf.giverRoleId)) {
            return interaction.reply({
                content: '❌ Cannot start auto-vouch! Please configure roles and channel first in Vouch Setup.',
                flags: 64
            });
        }
        
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
                        .setPlaceholder('!')
                )
            );
        return interaction.showModal(modal);
    }

    if (interaction.customId === 'vouch_confirm') {
        await interaction.deferUpdate();
        const embed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor('#2ECC71')
            .addFields(
                { name: '✅ Status', value: 'Verified by community', inline: true },
                { name: '🔒 Trust Score', value: '100%', inline: true }
            );
        
        await interaction.editReply({ embeds: [embed], components: [] });
        await interaction.followUp({
            content: '✅ **Vouch confirmed and verified!**',
            flags: 64
        });
        return;
    }

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
            flags: 64
        });
        return;
    }

    // ===== TICKET BUTTONS =====
    if (interaction.customId === 'create_ticket') {
        await interaction.deferReply({ flags: 64 });
        
        const cleanName = user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (interaction.guild.channels.cache.some(c => c.name === `mm-${cleanName}`)) {
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ You already have an open ticket.')
                ]
            });
        }

        if (!conf.staffRoles || conf.staffRoles.length === 0) {
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription('❌ No staff roles configured. Please ask an admin to set it up.')
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
                    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ]
            });

            if (conf.staffRoles && conf.staffRoles.length > 0) {
                conf.staffRoles.forEach(roleId => {
                    ticketChannel.permissionOverwrites.create(roleId, {
                        ViewChannel: true,
                        SendMessages: true
                    });
                });
            }

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

    if (interaction.customId === 'edit_deal_btn') {
        const tradeState = activeTrades.get(interaction.channelId);
        if (!tradeState || user.id !== tradeState.trader1Id) {
            return interaction.reply({ 
                content: '❌ Only the creator can edit the deal.',
                flags: 64
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

    if (interaction.customId === 'confirm_deal_btn') {
        const tradeState = activeTrades.get(interaction.channelId);
        if (!tradeState || user.id !== tradeState.trader2Id) {
            return interaction.reply({ 
                content: '❌ You are not allowed to confirm this deal.',
                flags: 64
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

    if (interaction.customId === 'claim_ticket') {
        if (!hasStaffRole(interaction.member, conf) && !hasAdminRole(interaction.member, conf)) {
            return interaction.reply({ 
                content: '❌ Staff access only.',
                flags: 64
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
                flags: 64
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
        if (!hasStaffRole(interaction.member, conf) && !hasAdminRole(interaction.member, conf)) {
            return interaction.reply({ 
                content: '❌ Staff access only.',
                flags: 64
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

process.on('unhandledRejection', error => {
    console.error('❌ Unhandled Rejection:', error);
});

console.log('🔄 Attempting to connect to Discord...');
client.login(BOT_TOKEN);
