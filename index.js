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
    TextInputBuilder, TextInputStyle, AuditLogEvent, REST, Routes,
    SlashCommandBuilder
} = require('discord.js');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
if (!BOT_TOKEN) {
    console.error('❌ DISCORD_TOKEN is missing!');
    process.exit(1);
}
if (!CLIENT_ID) {
    console.error('❌ CLIENT_ID is missing! Add it to Railway Variables');
    process.exit(1);
}

const CONFIG_FILE = path.join(__dirname, 'config.json');
const TICKETS_FILE = path.join(__dirname, 'tickets.json');
const VOUCHES_FILE = path.join(__dirname, 'vouches.json');

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

function loadTickets() {
    try {
        if (fs.existsSync(TICKETS_FILE)) {
            return JSON.parse(fs.readFileSync(TICKETS_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Error loading tickets:', error);
    }
    return {};
}

function saveTickets(tickets) {
    try {
        fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2));
    } catch (error) {
        console.error('Error saving tickets:', error);
    }
}

function loadVouches() {
    try {
        if (fs.existsSync(VOUCHES_FILE)) {
            return JSON.parse(fs.readFileSync(VOUCHES_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Error loading vouches:', error);
    }
    return {};
}

function saveVouches(vouches) {
    try {
        fs.writeFileSync(VOUCHES_FILE, JSON.stringify(vouches, null, 2));
    } catch (error) {
        console.error('Error saving vouches:', error);
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
            scamAlertRoleId: null,
            scamAlertLogChannel: null,
            vouchLogChannel: null,
            vouchVerifyRole: null,
            ticketAlertChannelId: null,
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
            scamAlertRoleId: null,
            scamAlertLogChannel: null,
            vouchLogChannel: null,
            vouchVerifyRole: null,
            ticketAlertChannelId: null,
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

function isAuthorized(member, conf) {
    return hasStaffRole(member, conf) || 
           hasDashboardRole(member, conf) || 
           hasAdminRole(member, conf) ||
           member.permissions.has(PermissionFlagsBits.Administrator) ||
           member.id === member.guild.ownerId;
}

function getTicketData(channelId) {
    const allTickets = loadTickets();
    return allTickets[channelId] || null;
}

function setTicketData(channelId, data) {
    const allTickets = loadTickets();
    allTickets[channelId] = data;
    saveTickets(allTickets);
}

function deleteTicketData(channelId) {
    const allTickets = loadTickets();
    delete allTickets[channelId];
    saveTickets(allTickets);
}

function getVouchCount(userId) {
    const allVouches = loadVouches();
    return allVouches[userId] || 0;
}

function setVouchCount(userId, count) {
    const allVouches = loadVouches();
    allVouches[userId] = count;
    saveVouches(allVouches);
}

function addVouchCount(userId, amount) {
    const allVouches = loadVouches();
    allVouches[userId] = (allVouches[userId] || 0) + amount;
    saveVouches(allVouches);
    return allVouches[userId];
}

const activeTickets = new Map();
const activeVouchTimers = new Map();
const afkUsers = new Map();
const scamAlertCooldowns = new Map();

function loadPersistentTickets() {
    const allTickets = loadTickets();
    for (const [channelId, data] of Object.entries(allTickets)) {
        activeTickets.set(channelId, data);
        console.log(`🔄 Loaded ticket ${channelId} from storage (claimed: ${data.claimedBy || 'none'})`);
    }
}

const FAUX_TRADES = [
    "ROBUX: 5000 R$ W/T TAX FOR 20$ LTC",
    "ROBUX: 10k R$ CLEAN FOR 42$ SOL",
    "ROBUX: 2500 R$ AFTER TAX FOR 10$ PAYPAL",
    "ROBUX: 20k R$ CLEAN FOR 80$ BTC",
    "ROBUX: 1000 R$ FOR 4$ LTC",
    "ROBUX: 50k R$ FOR 200$ BTC",
    "BLOX FRUITS: PERM BUDDHA FOR 20$ LTC",
    "BLOX FRUITS: KITSUNE FRUIT FOR 15$ SOL",
    "BLOX FRUITS: PERM DRAGON FOR 35$ BTC",
    "BLOX FRUITS: PERM KITSUNE FOR 24$ LTC",
    "BLOX FRUITS: FRUIT STORAGE FOR 10$ PAYPAL",
    "BLOX FRUITS: 2X MASTERY FOR 8$ LTC",
    "ADOPT ME: FR JUNGLE EGG PET FOR 15$ SOL",
    "ADOPT ME: NFR SHADOW DRAGON FOR 80$ BTC",
    "ADOPT ME: MEGA FROST DRAGON FOR 120$ SOL",
    "ADOPT ME: FR GIRAFFE FOR 45$ LTC",
    "ADOPT ME: NFR OWL FOR 60$ PAYPAL",
    "ADOPT ME: MEGA UNICORN FOR 30$ BTC",
    "VALORANT: 2500 VP CARD FOR 15$ PAYPAL",
    "VALORANT: 1000 VP FOR 6$ LTC",
    "VALORANT: RADIANITE PACK FOR 20$ SOL",
    "DISCORD: 1 YEAR NITRO BOOST FOR 12$ CARD",
    "DISCORD: 3 MONTHS NITRO FOR 4$ LTC",
    "DISCORD: 1 MONTH NITRO FOR 1.5$ SOL",
    "STEAM: 50$ GIFT CARD FOR 40$ CRYPTO",
    "STEAM: 20$ GIFT CARD FOR 16$ LTC",
    "STEAM: 100$ GIFT CARD FOR 80$ BTC"
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

        const trade = FAUX_TRADES[Math.floor(Math.random() * FAUX_TRADES.length)];

        const embed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle('✅ Vouch Verified')
            .setDescription(
                `**From:** <@${randomGiver.id}>\n` +
                `**To:** <@${randomTarget.id}>\n\n` +
                `📦 **Transaction:** \`${trade}\``
            )
            .addFields(
                { name: '📎 Screenshot', value: '❌ No Screenshot (Auto-Vouch)', inline: true }
            )
            .setThumbnail(randomTarget.displayAvatarURL({ dynamic: true, size: 256 }))
            .setFooter({ text: 'Cosmic™ Vouch System', iconURL: guild.iconURL({ dynamic: true }) });

        await channel.send({ embeds: [embed] });
        console.log(`✅ Auto-vouch posted in ${guild.name}`);
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

// ===================== DASHBOARD - FIXED VOUCH SETUP =====================
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
                    `**📝 Logs:** ${conf.logChannelId ? `<#${conf.logChannelId}>` : '❌ Not Set'}\n` +
                    `**📢 Ticket Alert Channel:** ${conf.ticketAlertChannelId ? `<#${conf.ticketAlertChannelId}>` : '❌ Not Set'}\n\n` +
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
                    `**📝 Log Channel:** ${conf.logChannelId ? `<#${conf.logChannelId}>` : '❌ Not Set'}\n` +
                    `**📢 Ticket Alert Channel:** ${conf.ticketAlertChannelId ? `<#${conf.ticketAlertChannelId}>` : '❌ Not Set'}`
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
                ),
                new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId('mm_set_alert')
                        .setPlaceholder('Select Ticket Alert Channel')
                        .addChannelTypes(ChannelType.GuildText)
                )
            ];
            break;

        // ===== VOUCH SETUP - ONE COMPONENT PER ROW, NO BUTTONS =====
        case 'vouch_setup':
            embed.setTitle('🎫 Vouch Configuration')
                .setDescription(
                    `**Current Interval:** \`${formatTime(conf.intervalTime)}\` *(Change with \`!vouch interval 30s\`)*\n\n` +
                    `**Target Role (Receives):** ${conf.targetRoleId ? `<@&${conf.targetRoleId}>` : '❌ Not Set'}\n` +
                    `**Giver Role (Gives):** ${conf.giverRoleId ? `<@&${conf.giverRoleId}>` : '❌ Not Set'}\n` +
                    `**Vouch Channel:** ${conf.vouchChannelId ? `<#${conf.vouchChannelId}>` : '❌ Not Set'}\n` +
                    `**Vouch Log Channel:** ${conf.vouchLogChannel ? `<#${conf.vouchLogChannel}>` : '❌ Not Set'}`
                );
            components = [
                navRow,
                new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId('v_set_target')
                        .setPlaceholder('Target Role (Receives)')
                ),
                new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId('v_set_giver')
                        .setPlaceholder('Giver Role (Gives)')
                ),
                new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId('v_set_chan')
                        .setPlaceholder('Vouch Alerts Channel')
                        .addChannelTypes(ChannelType.GuildText)
                ),
                new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId('v_set_log')
                        .setPlaceholder('Vouch Log Channel')
                        .addChannelTypes(ChannelType.GuildText)
                )
            ];
            break;

        case 'scam_setup':
            embed.setTitle('🚨 Scam Alert Configuration')
                .setDescription(
                    `**Scam Alert Role (Join Role):** ${conf.scamAlertRoleId ? `<@&${conf.scamAlertRoleId}>` : '❌ Not Set'}\n` +
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
                    `**🤝 Tickets (Slash Commands)**\n` +
                    `> \`/claim\` - Claim a ticket\n` +
                    `> \`/unclaim\` - Unclaim a ticket\n` +
                    `> \`/close\` - Close current ticket\n` +
                    `> \`/add @user\` - Add user to ticket\n\n` +
                    `**🎫 Vouch Commands**\n` +
                    `> \`/vouch @user <trade> [screenshot]\` - Submit a vouch\n` +
                    `> \`/vouches [user]\` - Check user's vouches\n` +
                    `> \`!addvouch @user <amount>\` - Add vouches to user (admin)\n` +
                    `> \`!vouch interval <time>\` - Change auto-vouch interval (admin)\n\n` +
                    `**🛡️ Admin Commands**\n` +
                    `> \`${conf.prefix}setup-ticket\` - Create ticket button\n` +
                    `> \`${conf.prefix}ontop @user <reason>\` - 🚨 SCAM ALERT system\n\n` +
                    `**🎫 Auto-Vouch Commands**\n` +
                    `> \`${conf.prefix}vouch start\` - Start auto-vouch\n` +
                    `> \`${conf.prefix}vouch stop\` - Stop auto-vouch\n` +
                    `> \`${conf.prefix}vouch status\` - Check vouch status\n\n` +
                    `**⚙️ Configuration**\n` +
                    `> \`${conf.prefix}dashboard\` - Open control panel\n` +
                    `> \`${conf.prefix}afk\` - Toggle AFK mode`
                );
            components = [navRow];
            break;
    }

    return { embeds: [embed], components };
}

// ===================== SLASH COMMANDS =====================
async function registerSlashCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('claim')
            .setDescription('Claim the current ticket'),
        new SlashCommandBuilder()
            .setName('unclaim')
            .setDescription('Unclaim the current ticket'),
        new SlashCommandBuilder()
            .setName('close')
            .setDescription('Close the current ticket'),
        new SlashCommandBuilder()
            .setName('add')
            .setDescription('Add a user to the ticket')
            .addUserOption(option => 
                option.setName('user')
                    .setDescription('The user to add')
                    .setRequired(true)),
        new SlashCommandBuilder()
            .setName('vouch')
            .setDescription('Submit a vouch for a user')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('The user to vouch for')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('trade')
                    .setDescription('Describe the trade')
                    .setRequired(true)
                    .setMaxLength(500))
            .addAttachmentOption(option =>
                option.setName('screenshot')
                    .setDescription('Screenshot of the trade (optional)')
                    .setRequired(false)),
        new SlashCommandBuilder()
            .setName('vouches')
            .setDescription('Check a user\'s vouch count')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('The user to check')
                    .setRequired(false))
    ];

    try {
        const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
        console.log('🔄 Registering slash commands...');
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands.map(cmd => cmd.toJSON()) });
        console.log('✅ Slash commands registered!');
    } catch (error) {
        console.error('❌ Error registering slash commands:', error);
    }
}

client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} is online!`);
    console.log(`📊 Serving ${client.guilds.cache.size} servers`);
    await registerSlashCommands();
    
    loadPersistentTickets();
    console.log(`📋 Loaded ${activeTickets.size} tickets from persistent storage`);
    
    const allVouches = loadVouches();
    console.log(`📋 Loaded ${Object.keys(allVouches).length} users with vouches`);
    
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

// ===================== VOUCH HANDLERS =====================
async function handleVouchSubmit(interaction) {
    const target = interaction.options.getUser('user');
    const trade = interaction.options.getString('trade');
    const screenshot = interaction.options.getAttachment('screenshot');

    const conf = getServerConfig(interaction.guild.id);
    
    const newCount = addVouchCount(target.id, 1);

    const embed = new EmbedBuilder()
        .setColor('#2ECC71')
        .setTitle('✅ Vouch Submitted!')
        .setDescription(
            `**Vouched User:** ${target}\n` +
            `**Submitted By:** ${interaction.user}\n` +
            `**Trade:** \`${trade}\``
        )
        .addFields(
            { name: '📊 New Vouch Count', value: `${newCount} vouches`, inline: true },
            { name: '📎 Screenshot', value: screenshot ? '✅ Attached' : '❌ No Screenshot', inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Cosmic™ Vouch System', iconURL: interaction.guild.iconURL({ dynamic: true }) });

    if (screenshot) {
        embed.setImage(screenshot.url);
    }

    if (conf.vouchLogChannel) {
        const vouchChan = interaction.guild.channels.cache.get(conf.vouchLogChannel);
        if (vouchChan) {
            const logEmbed = new EmbedBuilder()
                .setColor('#2ECC71')
                .setTitle('📝 Vouch Recorded')
                .setDescription(
                    `**Vouched User:** ${target}\n` +
                    `**Submitted By:** ${interaction.user}\n` +
                    `**Trade:** \`${trade}\``
                )
                .addFields(
                    { name: '📊 New Total', value: `${newCount} vouches`, inline: true },
                    { name: '📎 Screenshot', value: screenshot ? '✅ Attached' : '❌ No Screenshot', inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'Cosmic™ Vouch System', iconURL: interaction.guild.iconURL({ dynamic: true }) });
            
            if (screenshot) {
                logEmbed.setImage(screenshot.url);
            }
            
            await vouchChan.send({ embeds: [logEmbed] }).catch((err) => {
                console.error('Failed to send vouch log:', err);
            });
        }
    }

    await interaction.reply({ embeds: [embed] });
}

async function handleVouches(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const count = getVouchCount(target.id);

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

// ===================== LOCK TICKET =====================
async function lockTicketChannel(channel, ticket, claimant, conf) {
    try {
        console.log(`🔒 Locking ticket ${channel.id}...`);

        await channel.permissionOverwrites.set([]);

        await channel.permissionOverwrites.create(channel.guild.id, {
            SendMessages: false
        });

        await channel.permissionOverwrites.create(claimant.id, {
            SendMessages: true,
            ViewChannel: true
        });

        await channel.permissionOverwrites.create(ticket.creatorId, {
            SendMessages: true,
            ViewChannel: true
        });

        if (ticket.addedUsers && ticket.addedUsers.length > 0) {
            for (const userId of ticket.addedUsers) {
                await channel.permissionOverwrites.create(userId, {
                    SendMessages: true,
                    ViewChannel: true
                }).catch(() => {});
            }
        }

        console.log(`✅ Ticket ${channel.id} locked successfully!`);
        
        await channel.send({
            embeds: [new EmbedBuilder()
                .setColor('#2ECC71')
                .setDescription('🔒 **Ticket locked.** Only the claimant, ticket creator, and added users can talk.')
            ]
        }).catch(() => {});

        return true;
    } catch (error) {
        console.error('❌ Error locking ticket channel:', error);
        return false;
    }
}

async function unlockTicketChannel(channel, conf) {
    try {
        console.log(`🔓 Unlocking ticket ${channel.id}...`);
        
        await channel.permissionOverwrites.set([]);

        await channel.permissionOverwrites.create(channel.guild.id, {
            ViewChannel: true,
            SendMessages: true
        });

        if (conf.staffRoles && conf.staffRoles.length > 0) {
            for (const roleId of conf.staffRoles) {
                try {
                    await channel.permissionOverwrites.create(roleId, {
                        ViewChannel: true,
                        SendMessages: true
                    });
                } catch (e) {}
            }
        }

        console.log(`✅ Ticket ${channel.id} unlocked successfully!`);
        return true;
    } catch (error) {
        console.error('❌ Error unlocking ticket channel:', error);
        return false;
    }
}

// ===================== MESSAGE CREATE =====================
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    
    const guildId = message.guild.id;
    const conf = getServerConfig(guildId);
    const prefix = conf.prefix;

    if (message.content === `<@${client.user.id}>`) {
        return;
    }

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

    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
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

    if (command === 'addvouch' && isAdmin) {
        const target = message.mentions.members.first();
        if (!target) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription(`❌ Usage: \`!addvouch @user <amount>\``)
                ]
            });
        }

        const amount = parseInt(args[1]);
        if (isNaN(amount) || amount < 1) {
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription(`❌ Please provide a valid amount.`)
                ]
            });
        }

        const newCount = addVouchCount(target.id, amount);

        return message.reply({
            embeds: [new EmbedBuilder()
                .setColor('#2ECC71')
                .setTitle('✅ Vouches Added')
                .setDescription(
                    `**${amount}** vouches added to ${target}\n` +
                    `📊 **Total Vouches:** ${newCount}`
                )
                .setTimestamp()
            ]
        });
    }

    if (command === 'vouches') {
        let target = message.mentions.members.first();
        
        if (!target) {
            target = message.member;
        }

        const count = getVouchCount(target.id);

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('📊 Vouch Count')
            .setDescription(
                `${target} has **${count}** vouches! 🎉`
            )
            .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
            .setFooter({ text: 'Cosmic™ Vouch System' })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
        return;
    }

    if (command === 'vouch') {
        const subCommand = args[0]?.toLowerCase();
        
        // ===== NEW: Change interval =====
        if (subCommand === 'interval' && isAdmin) {
            const time = args[1];
            if (!time) {
                return message.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#FEE75C')
                        .setDescription('❌ Usage: `!vouch interval 30s`\nExamples: `30s`, `1m`, `5m`, `1h`, `1d`')
                    ]
                });
            }
            const ms = parseTime(time);
            if (!ms || ms < 5000) {
                return message.reply({
                    embeds: [new EmbedBuilder()
                        .setColor('#ED4245')
                        .setDescription('❌ Invalid interval. Use: `30s`, `1m`, `5m`, etc. (minimum 5s)')
                    ]
                });
            }
            await updateServerConfig(guildId, { intervalTime: ms });
            const updatedConf = getServerConfig(guildId);
            if (updatedConf.running) {
                stopVouchLoop(guildId);
                startVouchLoop(guildId);
            }
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#2ECC71')
                    .setDescription(`✅ Interval set to ${formatTime(ms)}`)
                ]
            });
        }
        
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
            const totalVouches = Object.keys(loadVouches()).length;
            
            return message.reply({
                embeds: [new EmbedBuilder()
                    .setColor('#2B2D31')
                    .setTitle('🎫 Auto-Vouch Status')
                    .addFields(
                        { name: 'Status', value: status, inline: true },
                        { name: 'Interval', value: interval, inline: true },
                        { name: 'Total Users with Vouches', value: `${totalVouches}`, inline: true },
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
                    `\`${prefix}vouch status\` - Check vouch status\n` +
                    `\`${prefix}vouch interval <time>\` - Change interval (e.g. 30s, 1m)\n` +
                    `\`${prefix}addvouch @user <amount>\` - Add vouches to user\n` +
                    `\`${prefix}vouches @user\` - Check user's vouches`
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

    // ===== SLASH COMMANDS =====
    if (interaction.isCommand()) {
        const { commandName } = interaction;
        const member = interaction.member;
        const isStaff = hasStaffRole(member, conf);
        const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

        if (commandName === 'claim') {
            if (!isStaff && !isAdmin) {
                return interaction.reply({
                    content: '❌ Staff access only!',
                    flags: 64
                });
            }

            const channelId = interaction.channelId;
            let ticket = activeTickets.get(channelId);
            if (!ticket) {
                const savedTicket = getTicketData(channelId);
                if (savedTicket) {
                    ticket = savedTicket;
                    activeTickets.set(channelId, ticket);
                }
            }
            
            if (!ticket) {
                return interaction.reply({
                    content: '❌ This ticket is not in the system.',
                    flags: 64
                });
            }

            if (ticket.claimedBy) {
                return interaction.reply({
                    content: `❌ This ticket has already been claimed by <@${ticket.claimedBy}>!`,
                    flags: 64
                });
            }

            ticket.claimedBy = interaction.user.id;
            activeTickets.set(channelId, ticket);
            setTicketData(channelId, ticket);

            await lockTicketChannel(interaction.channel, ticket, interaction.user, conf);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`unclaim_${interaction.user.id}`)
                    .setLabel('🤷‍♂️ Unclaim')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔄'),
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('🔒 Close')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🗑️')
            );

            try {
                const messages = await interaction.channel.messages.fetch({ limit: 10 });
                const ticketMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 0);
                if (ticketMsg) {
                    await ticketMsg.edit({ components: [row] });
                }
            } catch (e) {}

            await interaction.reply({
                content: `🛡️ **Ticket Claimed by** <@${interaction.user.id}>`,
                flags: 64
            });

            return;
        }

        if (commandName === 'unclaim') {
            if (!isStaff && !isAdmin) {
                return interaction.reply({
                    content: '❌ Staff access only!',
                    flags: 64
                });
            }

            const channelId = interaction.channelId;
            let ticket = activeTickets.get(channelId);
            if (!ticket) {
                const savedTicket = getTicketData(channelId);
                if (savedTicket) {
                    ticket = savedTicket;
                    activeTickets.set(channelId, ticket);
                }
            }
            
            if (!ticket) {
                return interaction.reply({
                    content: '❌ This ticket is not in the system.',
                    flags: 64
                });
            }

            if (!ticket.claimedBy) {
                return interaction.reply({
                    content: '❌ This ticket is not claimed!',
                    flags: 64
                });
            }

            if (ticket.claimedBy !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({
                    content: `❌ This ticket was claimed by <@${ticket.claimedBy}>. Only they can unclaim it.`,
                    flags: 64
                });
            }

            ticket.claimedBy = null;
            activeTickets.set(channelId, ticket);
            setTicketData(channelId, ticket);

            await unlockTicketChannel(interaction.channel, conf);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('claim_ticket')
                    .setLabel('🙋‍♂️ Claim')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🛡️'),
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('🔒 Close')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🗑️')
            );

            try {
                const messages = await interaction.channel.messages.fetch({ limit: 10 });
                const ticketMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 0);
                if (ticketMsg) {
                    await ticketMsg.edit({ components: [row] });
                }
            } catch (e) {}

            await interaction.reply({
                content: `🔄 Ticket unclaimed by <@${interaction.user.id}>!`,
                flags: 64
            });

            return;
        }

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
            
            activeTickets.delete(interaction.channelId);
            deleteTicketData(interaction.channelId);
            
            setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
            return;
        }

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
                await interaction.channel.permissionOverwrites.create(target.id, {
                    ViewChannel: true,
                    SendMessages: true
                });

                let ticket = activeTickets.get(interaction.channelId);
                if (!ticket) {
                    const savedTicket = getTicketData(interaction.channelId);
                    if (savedTicket) {
                        ticket = savedTicket;
                        activeTickets.set(interaction.channelId, ticket);
                    }
                }
                
                if (ticket) {
                    if (!ticket.addedUsers) ticket.addedUsers = [];
                    if (!ticket.addedUsers.includes(target.id)) {
                        ticket.addedUsers.push(target.id);
                        activeTickets.set(interaction.channelId, ticket);
                        setTicketData(interaction.channelId, ticket);
                    }
                }

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

        if (commandName === 'vouch') {
            if (!isAuthorized(interaction.member, conf) && !hasVouchVerifyRole(interaction.member, conf)) {
                return interaction.reply({
                    content: '❌ You do not have permission to submit vouches!',
                    flags: 64
                });
            }
            await handleVouchSubmit(interaction);
            return;
        }

        if (commandName === 'vouches') {
            await handleVouches(interaction);
            return;
        }
    }

    // ===== SCAM ALERT BUTTONS =====
    if (interaction.customId?.startsWith('scam_join_') || interaction.customId?.startsWith('scam_leave_')) {
        await interaction.deferUpdate();
        
        try {
            const victimId = interaction.customId.split('_')[2];
            const action = interaction.customId.split('_')[1];
            const isJoin = action === 'join';

            if (interaction.user.id !== victimId) {
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
                    .setDescription(conf.scamAlertJoinMessage || '💰 You chose to join us! Welcome to the rich community! 🤑')
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
                    .setDescription(conf.scamAlertLeaveMessage || '💀 You chose to leave and be broke. Goodbye! 👋')
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
            
            if (targetId === interaction.user.id && interaction.user.id !== interaction.guild.ownerId) {
                return interaction.reply({ 
                    content: '❌ You cannot edit your own whitelist.',
                    flags: 64
                });
            }
            
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && 
                interaction.user.id !== interaction.guild.ownerId) {
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
            const selectedRoles = interaction.values;
            const current = getServerConfig(guildId);
            
            if (interaction.customId === 'mm_set_staff') {
                const roles = current.staffRoles || [];
                selectedRoles.forEach(roleId => {
                    if (!roles.includes(roleId)) {
                        roles.push(roleId);
                    }
                });
                await updateServerConfig(guildId, { staffRoles: roles });
                const dashData = await getDashboard(guildId, 'mm_roles');
                return await interaction.editReply(dashData);
            }
            
            if (interaction.customId === 'mm_set_dashboard') {
                const roles = current.dashboardRoles || [];
                selectedRoles.forEach(roleId => {
                    if (!roles.includes(roleId)) {
                        roles.push(roleId);
                    }
                });
                await updateServerConfig(guildId, { dashboardRoles: roles });
                const dashData = await getDashboard(guildId, 'mm_roles');
                return await interaction.editReply(dashData);
            }
            
            if (interaction.customId === 'mm_set_admin') {
                const roles = current.adminRoles || [];
                selectedRoles.forEach(roleId => {
                    if (!roles.includes(roleId)) {
                        roles.push(roleId);
                    }
                });
                await updateServerConfig(guildId, { adminRoles: roles });
                const dashData = await getDashboard(guildId, 'mm_roles');
                return await interaction.editReply(dashData);
            }
            
            if (interaction.customId === 'v_set_target') {
                await updateServerConfig(guildId, { targetRoleId: selectedRoles[0] || null });
                const dashData = await getDashboard(guildId, 'vouch_setup');
                return await interaction.editReply(dashData);
            }
            
            if (interaction.customId === 'v_set_giver') {
                await updateServerConfig(guildId, { giverRoleId: selectedRoles[0] || null });
                const dashData = await getDashboard(guildId, 'vouch_setup');
                return await interaction.editReply(dashData);
            }
            
            if (interaction.customId === 'scam_set_role') {
                await updateServerConfig(guildId, { scamAlertRoleId: selectedRoles[0] || null });
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
                await updateServerConfig(guildId, { ticketCategoryId: interaction.values[0] || null });
                const dashData = await getDashboard(guildId, 'mm_channels');
                return await interaction.editReply(dashData);
            }
            
            if (interaction.customId === 'mm_set_logs') {
                await updateServerConfig(guildId, { logChannelId: interaction.values[0] || null });
                const dashData = await getDashboard(guildId, 'mm_channels');
                return await interaction.editReply(dashData);
            }
            
            if (interaction.customId === 'mm_set_alert') {
                await updateServerConfig(guildId, { ticketAlertChannelId: interaction.values[0] || null });
                const dashData = await getDashboard(guildId, 'mm_channels');
                return await interaction.editReply(dashData);
            }
            
            if (interaction.customId === 'v_set_chan') {
                await updateServerConfig(guildId, { vouchChannelId: interaction.values[0] || null });
                const dashData = await getDashboard(guildId, 'vouch_setup');
                return await interaction.editReply(dashData);
            }
            
            if (interaction.customId === 'v_set_log') {
                await updateServerConfig(guildId, { vouchLogChannel: interaction.values[0] || null });
                const dashData = await getDashboard(guildId, 'vouch_setup');
                return await interaction.editReply(dashData);
            }
            
            if (interaction.customId === 'scam_set_log') {
                await updateServerConfig(guildId, { scamAlertLogChannel: interaction.values[0] || null });
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
        afkUsers.set(interaction.user.id, { dm: interaction.customId === 'afk_dm_yes' });
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

    // ===== CREATE TICKET =====
    if (interaction.customId === 'create_ticket') {
        await interaction.deferReply({ flags: 64 });
        const user = interaction.user;
        
        const cleanName = user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
        const existingTicket = interaction.guild.channels.cache.find(c => c.name === `mm-${cleanName}`);
        if (existingTicket) {
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#ED4245')
                    .setDescription(`❌ You already have an open ticket: ${existingTicket}`)
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
                    {
                        id: interaction.guild.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                    }
                ]
            });

            if (conf.staffRoles && conf.staffRoles.length > 0) {
                for (const roleId of conf.staffRoles) {
                    try {
                        const role = interaction.guild.roles.cache.get(roleId);
                        if (role) {
                            await ticketChannel.permissionOverwrites.create(roleId, {
                                ViewChannel: true,
                                SendMessages: true
                            });
                        }
                    } catch (e) {}
                }
            }

            if (conf.dashboardRoles && conf.dashboardRoles.length > 0) {
                for (const roleId of conf.dashboardRoles) {
                    try {
                        const role = interaction.guild.roles.cache.get(roleId);
                        if (role) {
                            await ticketChannel.permissionOverwrites.create(roleId, {
                                ViewChannel: true,
                                SendMessages: true
                            });
                        }
                    } catch (e) {}
                }
            }

            if (conf.adminRoles && conf.adminRoles.length > 0) {
                for (const roleId of conf.adminRoles) {
                    try {
                        const role = interaction.guild.roles.cache.get(roleId);
                        if (role) {
                            await ticketChannel.permissionOverwrites.create(roleId, {
                                ViewChannel: true,
                                SendMessages: true
                            });
                        }
                    } catch (e) {}
                }
            }

            if (interaction.guild.ownerId) {
                try {
                    await ticketChannel.permissionOverwrites.create(interaction.guild.ownerId, {
                        ViewChannel: true,
                        SendMessages: true
                    });
                } catch (e) {}
            }

            const ticketData = {
                creatorId: user.id,
                claimedBy: null,
                createdAt: Date.now(),
                addedUsers: [],
                channelId: ticketChannel.id
            };
            activeTickets.set(ticketChannel.id, ticketData);
            setTicketData(ticketChannel.id, ticketData);
            console.log(`✅ Ticket stored: ${ticketChannel.id} for user ${user.id}`);

            await sendTicketLog(interaction.guild, conf, '🎫 Ticket Opened', 
                `Ticket ${ticketChannel} created by ${user}`, '#2ECC71');

            if (conf.ticketAlertChannelId) {
                const alertChan = interaction.guild.channels.cache.get(conf.ticketAlertChannelId);
                if (alertChan) {
                    const alertEmbed = new EmbedBuilder()
                        .setColor('#2ECC71')
                        .setTitle('🎫 New Ticket Opened')
                        .setDescription(
                            `**User:** ${user}\n` +
                            `**Ticket:** ${ticketChannel}\n` +
                            `**Staff:** Use the claim button below.`
                        )
                        .setTimestamp();
                    
                    const staffMentions = conf.staffRoles.map(id => `<@&${id}>`).join(' ');
                    const claimRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('claim_ticket_alert')
                            .setLabel('🙋‍♂️ Claim Ticket')
                            .setStyle(ButtonStyle.Success)
                            .setEmoji('🛡️')
                    );
                    
                    await alertChan.send({
                        content: staffMentions || '',
                        embeds: [alertEmbed],
                        components: [claimRow]
                    }).catch(() => {});
                }
            }

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('🎫 Ticket Created')
                .setDescription(
                    `Welcome <@${user.id}>!\n\n` +
                    `A staff member will assist you shortly.\n\n` +
                    `**Staff:** Use the buttons below to claim or close this ticket.`
                )
                .setFooter({ text: 'Cosmic™ · Safe Swap Services' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('claim_ticket')
                    .setLabel('🙋‍♂️ Claim')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🛡️'),
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('🔒 Close')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🗑️')
            );

            await ticketChannel.send({ 
                content: `${user} 👋`, 
                embeds: [embed], 
                components: [row] 
            });
            
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
                    .setDescription(`❌ Error creating ticket: ${error.message || 'Unknown error'}`)
                ]
            });
        }
    }

    // ===== CLAIM TICKET (from alert channel) =====
    if (interaction.customId === 'claim_ticket_alert') {
        const isStaff = hasStaffRole(interaction.member, conf) || 
                       interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                       interaction.user.id === interaction.guild.ownerId;
        
        if (!isStaff) {
            return interaction.reply({ 
                content: '❌ Staff access only.',
                flags: 64
            });
        }

        const embed = interaction.message.embeds[0];
        if (!embed) {
            return interaction.reply({
                content: '❌ Could not find ticket information.',
                flags: 64
            });
        }

        const description = embed.description || '';
        const ticketMatch = description.match(/<#(\d+)>/);
        if (!ticketMatch) {
            return interaction.reply({
                content: '❌ Could not find the ticket channel.',
                flags: 64
            });
        }

        const ticketChannelId = ticketMatch[1];
        const ticketChannel = interaction.guild.channels.cache.get(ticketChannelId);
        if (!ticketChannel) {
            return interaction.reply({
                content: '❌ The ticket channel no longer exists.',
                flags: 64
            });
        }

        let ticket = activeTickets.get(ticketChannelId);
        if (!ticket) {
            const savedTicket = getTicketData(ticketChannelId);
            if (savedTicket) {
                ticket = savedTicket;
                activeTickets.set(ticketChannelId, ticket);
            }
        }
        
        if (!ticket) {
            return interaction.reply({
                content: '❌ This ticket is not in the system.',
                flags: 64
            });
        }

        if (ticket.claimedBy) {
            return interaction.reply({
                content: `❌ This ticket has already been claimed by <@${ticket.claimedBy}>!`,
                flags: 64
            });
        }

        ticket.claimedBy = interaction.user.id;
        activeTickets.set(ticketChannelId, ticket);
        setTicketData(ticketChannelId, ticket);

        await lockTicketChannel(ticketChannel, ticket, interaction.user, conf);

        await interaction.update({
            embeds: [new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('🛡️ Ticket Claimed')
                .setDescription(
                    `**Ticket:** ${ticketChannel}\n` +
                    `**Claimed By:** <@${interaction.user.id}>\n` +
                    `**User:** <@${ticket.creatorId}>`
                )
                .setTimestamp()
            ],
            components: []
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`unclaim_${interaction.user.id}`)
                .setLabel('🤷‍♂️ Unclaim')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🔄'),
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('🔒 Close')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️')
        );

        try {
            const messages = await ticketChannel.messages.fetch({ limit: 10 });
            const ticketMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 0);
            if (ticketMsg) {
                await ticketMsg.edit({ components: [row] });
            }
        } catch (e) {}

        await ticketChannel.send({
            embeds: [new EmbedBuilder()
                .setColor('#FEE75C')
                .setDescription(`🛡️ **Ticket Claimed by** <@${interaction.user.id}>`)
            ]
        });

        await interaction.followUp({
            content: `✅ You have claimed the ticket ${ticketChannel}!`,
            flags: 64
        });

        return;
    }

    // ===== CLAIM TICKET (from ticket channel) =====
    if (interaction.customId === 'claim_ticket') {
        const isStaff = hasStaffRole(interaction.member, conf) || 
                       interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                       interaction.user.id === interaction.guild.ownerId;
        
        if (!isStaff) {
            return interaction.reply({ 
                content: '❌ Staff access only.',
                flags: 64
            });
        }

        let ticket = activeTickets.get(interaction.channelId);
        if (!ticket) {
            const savedTicket = getTicketData(interaction.channelId);
            if (savedTicket) {
                ticket = savedTicket;
                activeTickets.set(interaction.channelId, ticket);
            }
        }
        
        if (!ticket) {
            return interaction.reply({
                content: '❌ This ticket is not in the system.',
                flags: 64
            });
        }

        if (ticket.claimedBy) {
            return interaction.reply({
                content: `❌ This ticket has already been claimed by <@${ticket.claimedBy}>!`,
                flags: 64
            });
        }

        ticket.claimedBy = interaction.user.id;
        activeTickets.set(interaction.channelId, ticket);
        setTicketData(interaction.channelId, ticket);

        await lockTicketChannel(interaction.channel, ticket, interaction.user, conf);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`unclaim_${interaction.user.id}`)
                .setLabel('🤷‍♂️ Unclaim')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🔄'),
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('🔒 Close')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️')
        );

        await interaction.update({ components: [row] });

        await interaction.channel.send({
            embeds: [new EmbedBuilder()
                .setColor('#FEE75C')
                .setDescription(`🛡️ **Ticket Claimed by** <@${interaction.user.id}>`)
            ]
        });

        await interaction.followUp({
            content: `✅ You have claimed this ticket!`,
            flags: 64
        });

        if (conf.ticketAlertChannelId) {
            const alertChan = interaction.guild.channels.cache.get(conf.ticketAlertChannelId);
            if (alertChan) {
                const claimEmbed = new EmbedBuilder()
                    .setColor('#FEE75C')
                    .setTitle('🛡️ Ticket Claimed')
                    .setDescription(
                        `**Ticket:** ${interaction.channel}\n` +
                        `**Claimed By:** <@${interaction.user.id}>\n` +
                        `**User:** <@${ticket.creatorId}>`
                    )
                    .setTimestamp();
                await alertChan.send({ embeds: [claimEmbed] }).catch(() => {});
            }
        }

        return;
    }

    // ===== UNCLAIM TICKET (button) =====
    if (interaction.customId.startsWith('unclaim_')) {
        const allowedStaffId = interaction.customId.split('_')[1];
        
        const canUnclaim = interaction.user.id === allowedStaffId || 
                          interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                          interaction.user.id === interaction.guild.ownerId;
        
        if (!canUnclaim) {
            return interaction.reply({ 
                content: '❌ You cannot unclaim someone else\'s ticket.',
                flags: 64
            });
        }

        let ticket = activeTickets.get(interaction.channelId);
        if (!ticket) {
            const savedTicket = getTicketData(interaction.channelId);
            if (savedTicket) {
                ticket = savedTicket;
                activeTickets.set(interaction.channelId, ticket);
            }
        }
        
        if (!ticket) {
            return interaction.reply({
                content: '❌ This ticket is not in the system.',
                flags: 64
            });
        }

        ticket.claimedBy = null;
        activeTickets.set(interaction.channelId, ticket);
        setTicketData(interaction.channelId, ticket);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('claim_ticket')
                .setLabel('🙋‍♂️ Claim')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🛡️'),
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('🔒 Close')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️')
        );

        await interaction.update({ components: [row] });
        
        await unlockTicketChannel(interaction.channel, conf);

        await interaction.channel.send({
            embeds: [new EmbedBuilder()
                .setColor('#2ECC71')
                .setDescription(`🔄 Ticket unclaimed by ${interaction.user}! Ticket is now available for claiming.`)
            ]
        });

        await interaction.followUp({
            content: `✅ You have unclaimed this ticket!`,
            flags: 64
        });

        return;
    }

    // ===== CLOSE TICKET =====
    if (interaction.customId === 'close_ticket') {
        const isStaff = hasStaffRole(interaction.member, conf) || 
                       interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                       interaction.user.id === interaction.guild.ownerId;
        
        if (!isStaff) {
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
            `Ticket \`${interaction.channel.name}\` closed by ${interaction.user}`, '#ED4245');
        
        activeTickets.delete(interaction.channelId);
        deleteTicketData(interaction.channelId);
        
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
        return;
    }
});

process.on('unhandledRejection', error => {
    console.error('❌ Unhandled Rejection:', error);
});

console.log('🔄 Attempting to connect to Discord...');
client.login(BOT_TOKEN);
