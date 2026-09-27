require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const {
  Client, GatewayIntentBits, Partials, REST, Routes,
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const config = require('../config');

const DB_FILE = path.resolve(config.database.file);
const BACKUP_FILE = path.resolve(config.database.backupFile);
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const defaults = () => ({
  schemaVersion: 2, guilds: {}, warnings: {}, tickets: {}, reminders: [], giveaways: {}, finishedGiveaways: {},
  levels: {}, economy: {}, afk: {}, autoreplies: {}
});
let db;
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { db = defaults(); }\nif (!Number.isInteger(db.schemaVersion) || db.schemaVersion < 2) db.schemaVersion = 2;
for (const k of Object.keys(defaults())) if (!db[k]) db[k] = defaults()[k];

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, BACKUP_FILE);
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) { console.error('[DB]', e.message); }
  }, 100);
}
function guildData(id) {
  db.guilds[id] ??= {
    ticketCounter: 0, settings: {}, lockedChannels: {}, raidMode: false,
    protectionActors: {}, scheduled: [], giveaways: {}
  };
  return db.guilds[id];
}
function warningsKey(g, u) { return g + ':' + u; }
function warnList(g, u) { const k = warningsKey(g, u); db.warnings[k] ??= []; return db.warnings[k]; }
function embed(title, description, color = config.colors.primary) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp();
}
function owner(id) { return config.bot.owners.includes(id); }
function isStaff(member) {
  return !!member && (owner(member.id) || member.permissions.has(PermissionFlagsBits.Administrator) ||
    (config.tickets.staffRoleId && member.roles.cache.has(config.tickets.staffRoleId)));
}
function whitelisted(member) {
  if (!member) return false;
  if (owner(member.id)) return true;
  const guildSettings = guildData(member.guild.id).settings;
  const users = [...config.protection.whitelistUserIds, ...(guildSettings.protectionWhitelist || [])];
  const roles = [...config.protection.whitelistRoleIds, ...(guildSettings.protectionWhitelistRoles || [])];
  if (users.includes(member.id)) return true;
  return roles.some(id => member.roles.cache.has(id));
}
function canTarget(actor, target) {
  if (!target || !actor) return false;
  if (target.id === actor.id || target.user.bot && target.id === actor.id) return false;
  if (target.id === target.guild.ownerId) return false;
  if (!config.permissions.enforceHierarchy) return true;
  return actor.id === target.guild.ownerId || target.roles.highest.position < actor.roles.highest.position;
}
async function fetchMember(guild, id) {
  return guild.members.fetch(String(id).replace(/[<@!>]/g, '')).catch(() => null);
}
async function sendLog(guild, event, text, color = config.colors.info) {
  if (!config.logs.enabled || !config.logs.events[event]) return;
  const channelId = guildData(guild.id).settings.logChannelId || config.logs.channelId;
  if (!channelId) return;
  const c = guild.channels.cache.get(channelId);
  if (c?.isTextBased()) await c.send({ embeds: [embed('Audit Log', text, color)] }).catch(() => {});
}
const cooldowns = new Map();
function commandCooldown(userId, name, ms=1500) { const k=userId+':'+name,n=Date.now(),last=cooldowns.get(k)||0; if(n-last<ms)return Math.ceil((ms-(n-last))/1000); cooldowns.set(k,n); return 0; }
function safeText(v,max=1900){return String(v??'').slice(0,max);}
function hasGuildPermission(member, permission){ return !!member && (owner(member.id) || member.permissions.has(permission)); }
function ticketTopic(d){ return 'ticket-owner:'+d.ownerId+';ticket-type:'+d.type+';ticket-status:'+d.status+';ticket-number:'+d.number; }
function isTicketStaff(i){ return isStaff(i.member) || hasGuildPermission(i.member, PermissionFlagsBits.ManageChannels); }
function ticketAccess(i,d){ return i.user.id===d.ownerId || isTicketStaff(i); }
function commandError(i, text) {
  return i.replied || i.deferred ? i.followUp({ content: text, ephemeral: true }) : i.reply({ content: text, ephemeral: true });
}
async function punish(member, action, reason) {
  if (!member) return false;
  if (action === 'ban' && member.bannable) { await member.ban({ reason }); return true; }
  if (action === 'kick' && member.kickable) { await member.kick(reason); return true; }
  if (action === 'timeout' && member.moderatable) { await member.timeout(config.moderation.warnTimeoutMs, reason); return true; }
  return false;
}

const commands = [];
const add = (data, run) => commands.push({ data, run });

add(new SlashCommandBuilder().setName('ping').setDescription('Show bot latency'), async i => i.reply('Pong! ' + i.client.ws.ping + 'ms'));
add(new SlashCommandBuilder().setName('help').setDescription('Interactive command center'), async i => i.reply({ embeds: [embed('Project One — Command Center', [
  '**Moderation:** ban, kick, unban, timeout, untimeout, warn, warnings, clear, lock, unlock, slowmode',
  '**Protection:** lockdown, protection',
  '**Tickets:** ticket-panel',
  '**Admin:** welcome, autorole, autoreply, announce, remind',
  '**Community:** suggest, giveaway, level, balance, daily, afk',
  '**Utility:** ping, help, server, user, role, member'
].join('\n'))], components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('help:category').setPlaceholder('اختر قسم الأوامر').addOptions([{label:'Moderation',value:'moderation',emoji:'🛡️'},{label:'Protection',value:'protection',emoji:'🔐'},{label:'Tickets',value:'tickets',emoji:'🎫'},{label:'Community',value:'community',emoji:'🎮'},{label:'Utility',value:'utility',emoji:'⚙️'}]))] }));
add(new SlashCommandBuilder().setName('server').setDescription('Server information'), async i => i.reply({ embeds: [embed('Server Information',
  '**Name:** ' + i.guild.name + '\n**Owner:** <@' + i.guild.ownerId + '>\n**Members:** ' + i.guild.memberCount +
  '\n**Channels:** ' + i.guild.channels.cache.size + '\n**Roles:** ' + i.guild.roles.cache.size)] }));
add(new SlashCommandBuilder().setName('user').setDescription('User information').addUserOption(o => o.setName('user').setDescription('Target')), async i => {
  const u = i.options.getUser('user') || i.user;
  const m = await fetchMember(i.guild, u.id);
  return i.reply({ embeds: [embed('User Information', '**User:** ' + u + '\n**ID:** ' + u.id +
    '\n**Joined:** ' + (m?.joinedAt ? '<t:' + Math.floor(m.joinedAt.getTime()/1000) + ':R>' : 'Unknown'))] });
});

function modCommand(name, perm, action) {
  add(new SlashCommandBuilder().setName(name).setDescription(name + ' a member').setDefaultMemberPermissions(perm)
    .addUserOption(o => o.setName('user').setDescription('Target').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason')), async i => {
      const target = await fetchMember(i.guild, i.options.getUser('user').id);
      if (!target || !canTarget(i.member, target)) return commandError(i, 'لا يمكن تنفيذ الإجراء على هذا العضو بسبب الصلاحيات أو التسلسل الإداري.');
      const reason = i.options.getString('reason') || config.moderation.defaultReason;
      try { await action(target, reason); await i.reply({ embeds: [embed(name.toUpperCase(), 'تم تنفيذ الإجراء على ' + target.user.tag + '\n**السبب:** ' + reason, config.colors.danger)] }); await sendLog(i.guild, 'moderation', i.user.tag + ' used ' + name + ' on ' + target.user.tag + ': ' + reason, config.colors.danger); }
      catch (e) { return commandError(i, 'تعذر تنفيذ العملية. تأكد من رتبة البوت وصلاحياته.'); }
    });
}
modCommand('ban', PermissionFlagsBits.BanMembers, (m,r)=>m.ban({reason:r}));
modCommand('kick', PermissionFlagsBits.KickMembers, (m,r)=>m.kick(r));

add(new SlashCommandBuilder().setName('unban').setDescription('Unban a user').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addStringOption(o=>o.setName('user_id').setDescription('User ID').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason')), async i=>{
    try { const r=i.options.getString('reason')||config.moderation.defaultReason; await i.guild.members.unban(i.options.getString('user_id'),r); await i.reply('تم إلغاء الحظر.'); await sendLog(i.guild,'moderation',i.user.tag+' unbanned '+i.options.getString('user_id')); } catch { return commandError(i,'تعذر إلغاء الحظر.'); }
  });
add(new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption(o=>o.setName('user').setDescription('Target').setRequired(true)).addIntegerOption(o=>o.setName('minutes').setDescription('1-40320').setMinValue(1).setMaxValue(40320).setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason')), async i=>{
    const m=await fetchMember(i.guild,i.options.getUser('user').id); if(!m||!canTarget(i.member,m)||!m.moderatable)return commandError(i,'لا يمكن تطبيق الـ timeout.');
    const n=i.options.getInteger('minutes'),r=i.options.getString('reason')||config.moderation.defaultReason; await m.timeout(n*60000,r); await i.reply('تم تقييد '+m.user.tag+' لمدة '+n+' دقيقة.'); await sendLog(i.guild,'moderation',i.user.tag+' timed out '+m.user.tag);
  });
add(new SlashCommandBuilder().setName('untimeout').setDescription('Remove timeout').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption(o=>o.setName('user').setDescription('Target').setRequired(true)), async i=>{
    const m=await fetchMember(i.guild,i.options.getUser('user').id); if(!m||!canTarget(i.member,m)||!m.moderatable)return commandError(i,'لا يمكن إزالة الـ timeout.');
    await m.timeout(null,'Timeout removed'); await i.reply('تمت إزالة الـ timeout.');
  });
add(new SlashCommandBuilder().setName('warn').setDescription('Warn a member').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption(o=>o.setName('user').setDescription('Target').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)), async i=>{
    const u=i.options.getUser('user'),m=await fetchMember(i.guild,u.id); if(!m||!canTarget(i.member,m))return commandError(i,'لا يمكن تحذير هذا العضو.');
    const list=warnList(i.guild.id,u.id),reason=i.options.getString('reason'); list.push({id:Date.now().toString(36),by:i.user.id,reason,at:Date.now()}); save();
    if(list.length>=config.moderation.maxWarnsBeforeTimeout) await m.timeout(config.moderation.warnTimeoutMs,'Automatic warning escalation').catch(()=>{});
    await i.reply({embeds:[embed('Warning','تم تحذير '+u+'\n**السبب:** '+reason+'\n**العدد:** '+list.length,config.colors.warning)]}); await sendLog(i.guild,'moderation',i.user.tag+' warned '+u.tag+': '+reason,config.colors.warning);
  });
add(new SlashCommandBuilder().setName('warnings').setDescription('Show member warnings').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o=>o.setName('user').setDescription('Target').setRequired(true)), async i=>{
  const u=i.options.getUser('user'),list=warnList(i.guild.id,u.id); const text=list.length?list.slice(-15).map((w,n)=>'**'+(n+1)+'.** '+w.reason+' — <@'+w.by+'>').join('\n'):'لا توجد تحذيرات.'; await i.reply({embeds:[embed('Warnings for '+u.tag,text,config.colors.warning)]});
});
add(new SlashCommandBuilder().setName('clear').setDescription('Delete messages').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).addIntegerOption(o=>o.setName('amount').setDescription('1-100').setMinValue(1).setMaxValue(100).setRequired(true)), async i=>{
  const n=i.options.getInteger('amount'); const r=await i.channel.bulkDelete(n,true); await i.reply({content:'تم حذف '+r.size+' رسالة.',ephemeral:true}); await sendLog(i.guild,'moderation',i.user.tag+' deleted '+r.size+' messages in #'+i.channel.name);
});
for (const [name, locked] of [['lock',true],['unlock',false]]) add(new SlashCommandBuilder().setName(name).setDescription(name+' channel').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels), async i=>{
  await i.channel.permissionOverwrites.edit(i.guild.roles.everyone,{SendMessages:locked?false:null}); guildData(i.guild.id).lockedChannels[i.channel.id]=locked; save(); await i.reply(locked?'تم قفل القناة.':'تم فتح القناة.'); await sendLog(i.guild,'channel',i.user.tag+' '+name+'ed #'+i.channel.name);
});
add(new SlashCommandBuilder().setName('slowmode').setDescription('Set slowmode').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels).addIntegerOption(o=>o.setName('seconds').setDescription('0-21600').setMinValue(0).setMaxValue(21600).setRequired(true)), async i=>{await i.channel.setRateLimitPerUser(i.options.getInteger('seconds'));await i.reply('تم ضبط الـ slowmode.');});
add(new SlashCommandBuilder().setName('role').setDescription('Add or remove a role').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addStringOption(o=>o.setName('action').setDescription('add/remove').setRequired(true).addChoices({name:'add',value:'add'},{name:'remove',value:'remove'}))
  .addUserOption(o=>o.setName('user').setDescription('Target').setRequired(true)).addRoleOption(o=>o.setName('role').setDescription('Role').setRequired(true)), async i=>{
    const m=await fetchMember(i.guild,i.options.getUser('user').id),r=i.options.getRole('role'); if(!m||r.position>=i.member.roles.highest.position||!r.editable)return commandError(i,'لا يمكن تعديل هذه الرتبة.');
    const action=i.options.getString('action'); await m.roles[action](r); await i.reply('تم '+action+' الرتبة.'); await sendLog(i.guild,'role',i.user.tag+' '+action+' '+r.name+' for '+m.user.tag);
});
add(new SlashCommandBuilder().setName('member').setDescription('Member moderation information').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o=>o.setName('user').setDescription('Target').setRequired(true)), async i=>{
  const m=await fetchMember(i.guild,i.options.getUser('user').id); if(!m)return commandError(i,'العضو غير موجود.'); await i.reply({embeds:[embed('Member',m.user.tag+'\n**Roles:** '+Math.max(0,m.roles.cache.size-1)+'\n**Warnings:** '+warnList(i.guild.id,m.id).length)]});
});

add(new SlashCommandBuilder().setName('lockdown').setDescription('Lock or unlock all text channels').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addBooleanOption(o=>o.setName('enabled').setDescription('Enable lockdown').setRequired(true)), async i=>{
    const enabled=i.options.getBoolean('enabled'),gd=guildData(i.guild.id); for(const c of i.guild.channels.cache.values()) if(c.type===ChannelType.GuildText) await c.permissionOverwrites.edit(i.guild.roles.everyone,{SendMessages:enabled?false:null}).catch(()=>{}); gd.settings.lockdown=enabled; save(); await i.reply(enabled?'تم تفعيل الإغلاق العام.':'تم إلغاء الإغلاق العام.'); await sendLog(i.guild,'protection',i.user.tag+' set lockdown='+enabled,config.colors.warning);
});
add(new SlashCommandBuilder().setName('settings').setDescription('Show server bot settings').setDefaultMemberPermissions(PermissionFlagsBits.Administrator), async i=>{
  const s=guildData(i.guild.id).settings;
  await i.reply({embeds:[embed('Server Settings','**Log Channel:** '+(s.logChannelId?'<#'+s.logChannelId+'>':'Not set')+'\n**Welcome:** '+(s.welcomeEnabled??config.welcome.enabled?'ON':'OFF')+'\n**Autorole:** '+(s.autoroleEnabled??config.autorole.enabled?'ON':'OFF')+'\n**Lockdown:** '+(s.lockdown?'ON':'OFF')+'\n**Ticket Counter:** '+guildData(i.guild.id).ticketCounter)]});
});
add(new SlashCommandBuilder().setName('log-channel').setDescription('Set the audit log channel').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addChannelOption(o=>o.setName('channel').setDescription('Log channel').addChannelTypes(ChannelType.GuildText).setRequired(true)), async i=>{
  guildData(i.guild.id).settings.logChannelId=i.options.getChannel('channel').id;save();await i.reply('تم تعيين قناة اللوق.');
});
add(new SlashCommandBuilder().setName('suggest-channel').setDescription('Set the suggestions channel').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addChannelOption(o=>o.setName('channel').setDescription('Suggestions channel').addChannelTypes(ChannelType.GuildText).setRequired(true)), async i=>{
  guildData(i.guild.id).settings.suggestionChannelId=i.options.getChannel('channel').id;save();await i.reply('تم تعيين قناة الاقتراحات.');
});
add(new SlashCommandBuilder().setName('goodbye').setDescription('Configure goodbye messages').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addChannelOption(o=>o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText)).addBooleanOption(o=>o.setName('enabled').setDescription('Enabled').setRequired(true)).addStringOption(o=>o.setName('message').setDescription('Message')), async i=>{
  const s=guildData(i.guild.id).settings;s.goodbyeEnabled=i.options.getBoolean('enabled');s.goodbyeChannelId=i.options.getChannel('channel')?.id||s.goodbyeChannelId;s.goodbyeMessage=i.options.getString('message')||config.goodbye.message;save();await i.reply('تم حفظ إعدادات المغادرة.');
});
add(new SlashCommandBuilder().setName('autorole-remove').setDescription('Disable autorole').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles), async i=>{
  const s=guildData(i.guild.id).settings;s.autoroleEnabled=false;save();await i.reply('تم تعطيل الرتبة التلقائية.');
});
add(new SlashCommandBuilder().setName('protection').setDescription('Show protection status').setDefaultMemberPermissions(PermissionFlagsBits.Administrator), async i=>{
  const p=config.protection; await i.reply({embeds:[embed('Protection Status','**Global:** '+(p.enabled?'ON':'OFF')+'\n**Anti-Spam:** '+(p.spam.enabled?'ON':'OFF')+'\n**Anti-Raid:** '+(p.raid.enabled?'ON':'OFF')+'\n**Anti-Nuke:** '+(p.antiNuke.enabled?'ON':'OFF')+'\n**Anti-Bot:** '+(p.antiBot.enabled?'ON':'OFF')+'\n**Invite Filter:** '+(p.links.enabled?'ON':'OFF'))]});
});


function protectionFor(guild) {
  const base=config.protection;
  const override=guildData(guild.id).settings.protection || {};
  return {
    ...base, ...override,
    spam:{...base.spam,...(override.spam||{})},
    mentions:{...base.mentions,...(override.mentions||{})},
    links:{...base.links,...(override.links||{})},
    caps:{...base.caps,...(override.caps||{})},
    raid:{...base.raid,...(override.raid||{})},
    antiBot:{...base.antiBot,...(override.antiBot||{})},
    antiNuke:{...base.antiNuke,...(override.antiNuke||{})},
    restore:{...base.restore,...(override.restore||{})}
  };
}
function automodFor(guild){ const a=guildData(guild.id).settings.automod||{}; return {...config.automod,...a,duplicate:{...config.automod.duplicate,...(a.duplicate||{})},mentions:{...config.automod.mentions,...(a.mentions||{})},invites:{...config.automod.invites,...(a.invites||{})},links:{...config.automod.links,...(a.links||{})},exceptions:{...config.automod.exceptions,...(a.exceptions||{})}}; }
function economyFor(guild){ return {...config.economy,...(guildData(guild.id).settings.economy||{})}; }
function levelFor(guild){ return {...config.levels,...(guildData(guild.id).settings.levels||{})}; }

const mutationLocks=new Map();
async function withLock(key,fn){
  while(mutationLocks.has(key)) await mutationLocks.get(key);
  let release; const p=new Promise(r=>{release=r}); mutationLocks.set(key,p);
  try{return await fn();} finally{mutationLocks.delete(key);release();}
}

function snapshotState(guild){
  return {
    id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),
    at:Date.now(),
    channels:guild.channels.cache.map(c=>({id:c.id,name:c.name,type:c.type,parentId:c.parentId,position:c.rawPosition,topic:c.topic||null,nsfw:!!c.nsfw,rateLimitPerUser:c.rateLimitPerUser||0})),
    roles:guild.roles.cache.filter(r=>r.id!==guild.id).map(r=>({id:r.id,name:r.name,color:r.color,hoist:r.hoist,mentionable:r.mentionable,permissions:r.permissions.bitfield.toString(),position:r.position}))
  };
}
async function takeSnapshot(guild){
  const p=protectionFor(guild);
  if(!p.restore.enabled)return;
  const gd=guildData(guild.id); gd.snapshots??=[];
  gd.snapshots.push(snapshotState(guild));
  while(gd.snapshots.length>p.restore.maxSnapshots)gd.snapshots.shift();
  save();
}
async function restoreSnapshot(guild){
  const gd=guildData(guild.id),snap=(gd.snapshots||[]).at(-1);
  if(!snap)return {restored:0,missing:0};
  const p=protectionFor(guild); let restored=0,missing=0;
  for(const r of snap.roles) if(!guild.roles.cache.has(r.id)){
    if(!p.restore.autoRestoreDeletedRoles){missing++;continue;}
    const created=await guild.roles.create({name:r.name,color:r.color,hoist:r.hoist,mentionable:r.mentionable,permissions:r.permissions}).catch(()=>null);
    if(created)restored++;
  }
  for(const c of snap.channels) if(!guild.channels.cache.has(c.id)){
    if(!p.restore.autoRestoreDeletedChannels){missing++;continue;}
    const created=await guild.channels.create({name:c.name,type:c.type,parent:c.parentId||undefined,topic:c.topic||undefined,nsfw:c.nsfw,rateLimitPerUser:c.rateLimitPerUser}).catch(()=>null);
    if(created)restored++;
  }
  return {restored,missing};
}


add(new SlashCommandBuilder().setName('protection-restore').setDescription('Restore the latest protection snapshot').setDefaultMemberPermissions(PermissionFlagsBits.Administrator), async i=>{
  const result=await restoreSnapshot(i.guild);
  await i.reply({content:'تمت محاولة الاستعادة. المستعاد: '+result.restored+' | غير المستعاد: '+result.missing,ephemeral:true});
});

add(new SlashCommandBuilder().setName('economy-transfer').setDescription('Transfer credits')
  .addUserOption(o=>o.setName('user').setDescription('Recipient').setRequired(true))
  .addIntegerOption(o=>o.setName('amount').setDescription('Amount').setMinValue(1).setRequired(true)), async i=>{
    const recipient=i.options.getUser('user'),amount=i.options.getInteger('amount'),eco=economyFor(i.guild);
    if(recipient.bot||recipient.id===i.user.id||amount>eco.maxTransfer)return commandError(i,'التحويل غير صالح.');
    try{
      await withLock('eco:'+i.guild.id,async()=>{
        const aKey=i.guild.id+':'+i.user.id,bKey=i.guild.id+':'+recipient.id;
        const a=db.economy[aKey]??{balance:eco.startingBalance,lastDaily:0,transactions:[]};
        const b=db.economy[bKey]??{balance:eco.startingBalance,lastDaily:0,transactions:[]};
        if(a.balance<amount)throw new Error('INSUFFICIENT');
        a.balance-=amount;b.balance+=amount;
        const tx={id:Date.now().toString(36),at:Date.now(),from:i.user.id,to:recipient.id,amount};
        a.transactions=[...(a.transactions||[]),tx].slice(-50);b.transactions=[...(b.transactions||[]),tx].slice(-50);
        db.economy[aKey]=a;db.economy[bKey]=b;save();
      });
      await i.reply('تم تحويل **'+amount+'** '+eco.currency+' إلى '+recipient+'.');
    }catch(e){await commandError(i,e.message==='INSUFFICIENT'?'رصيدك غير كافٍ.':'تعذر تنفيذ التحويل.');}
});

add(new SlashCommandBuilder().setName('economy-transactions').setDescription('Show recent transactions'), async i=>{
  const d=db.economy[i.guild.id+':'+i.user.id]??{transactions:[]};
  const rows=(d.transactions||[]).slice(-10).reverse();
  await i.reply({embeds:[embed('Transactions',rows.length?rows.map(x=>new Date(x.at).toISOString()+' — '+(x.from===i.user.id?'إرسال':'استلام')+' '+x.amount).join('\n'):'لا توجد معاملات.')]});
});

add(new SlashCommandBuilder().setName('level-set').setDescription('Set member XP').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true))
  .addIntegerOption(o=>o.setName('xp').setDescription('XP').setMinValue(0).setRequired(true)), async i=>{
    const u=i.options.getUser('user'),xp=i.options.getInteger('xp'),l=levelFor(i.guild);
    db.levels[i.guild.id+':'+u.id]={xp,level:Math.floor(xp/(l.xpPerLevel||100)),last:0};save();
    await i.reply('تم ضبط XP للعضو.');
});

add(new SlashCommandBuilder().setName('level-reset').setDescription('Reset member level').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)), async i=>{
    delete db.levels[i.guild.id+':'+i.options.getUser('user').id];save();await i.reply('تم تصفير مستوى العضو.');
});

add(new SlashCommandBuilder().setName('suggestions-stats').setDescription('Suggestion statistics').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild), async i=>{
  const all=Object.values(db.suggestions||{}).filter(x=>x.guildId===i.guild.id);
  const counts=all.reduce((a,x)=>(a[x.status||'pending']=(a[x.status||'pending']||0)+1,a),{}); const up=all.reduce((n,x)=>n+(x.votes?.up?.length||0),0),down=all.reduce((n,x)=>n+(x.votes?.down?.length||0),0);
  await i.reply({embeds:[embed('Suggestion Statistics','Total: '+all.length+'\nPending: '+(counts.pending||0)+'\nApproved: '+(counts.approved||0)+'\nRejected: '+(counts.rejected||0)+'\n👍 Votes: '+up+'\n👎 Votes: '+down)]});
});


add(new SlashCommandBuilder().setName('giveaway-reroll').setDescription('Reroll a finished giveaway').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o=>o.setName('message_id').setDescription('Finished giveaway message ID').setRequired(true)), async i=>{
    const id=i.options.getString('message_id'),g=db.finishedGiveaways?.[id];
    if(!g||g.guildId!==i.guild.id)return commandError(i,'السحب المنتهي غير موجود.');
    const previous=new Set(g.winners||[]),pool=[...new Set(g.entries||[])].filter(x=>!previous.has(x));
    if(!pool.length)return commandError(i,'لا يوجد مشاركون جدد لإعادة السحب.');
    const winner=pool[Math.floor(Math.random()*pool.length)];g.rerolls??=[];g.rerolls.push({winner,at:Date.now(),by:i.user.id});g.winners=[...(g.winners||[]),winner];save();
    const c=client.channels.cache.get(g.channelId);if(c?.isTextBased())await c.send({embeds:[embed('Giveaway Reroll','الفائز الجديد: <@'+winner+'>',config.colors.success)]}).catch(()=>{});
    await i.reply('تمت إعادة السحب.');
});

add(new SlashCommandBuilder().setName('giveaway-cancel').setDescription('Cancel an active giveaway').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o=>o.setName('message_id').setDescription('Giveaway message ID').setRequired(true)), async i=>{
    const id=i.options.getString('message_id'),g=db.giveaways[id];
    if(!g||g.guildId!==i.guild.id)return commandError(i,'السحب غير موجود.');
    g.cancelledAt=Date.now();g.cancelledBy=i.user.id;db.finishedGiveaways??={};db.finishedGiveaways[id]={...g,status:'cancelled'};delete db.giveaways[id];save();
    const c=client.channels.cache.get(g.channelId);if(c?.isTextBased())await c.messages.fetch(id).then(m=>m.edit({components:[],embeds:[embed('Giveaway Cancelled','تم إلغاء السحب.',config.colors.warning)]})).catch(()=>{});
    await i.reply('تم إلغاء السحب.');
});

add(new SlashCommandBuilder().setName('automod').setDescription('Configure AutoMod').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addBooleanOption(o=>o.setName('enabled').setDescription('Enabled').setRequired(true))
  .addStringOption(o=>o.setName('words').setDescription('Comma-separated blocked words')), async i=>{
    const s=guildData(i.guild.id).settings;s.automod??={};s.automod.enabled=i.options.getBoolean('enabled');
    const words=i.options.getString('words');if(words!==null)s.automod.badWords=words.split(',').map(x=>x.trim()).filter(Boolean);
    save();await i.reply('تم حفظ إعدادات AutoMod.');
});

add(new SlashCommandBuilder().setName('automod-rule').setDescription('Manage AutoMod rules').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o=>o.setName('action').setDescription('add/remove/list').setRequired(true).addChoices({name:'add',value:'add'},{name:'remove',value:'remove'},{name:'list',value:'list'}))
  .addStringOption(o=>o.setName('pattern').setDescription('Word or domain pattern'))
  .addStringOption(o=>o.setName('type').setDescription('word/domain').addChoices({name:'word',value:'word'},{name:'domain',value:'domain'})), async i=>{
    const s=guildData(i.guild.id).settings;s.automod??={};s.automod.rules??=[];const action=i.options.getString('action');
    if(action==='list')return i.reply({embeds:[embed('AutoMod Rules',s.automod.rules.length?s.automod.rules.map((r,n)=>'**'+(n+1)+'** '+r.type+': '+r.pattern).join('\n'):'لا توجد قواعد.') ]});
    const pattern=i.options.getString('pattern')?.trim(),type=i.options.getString('type')||'word';if(!pattern)return commandError(i,'حدد pattern.');
    if(action==='add'){if(!s.automod.rules.some(r=>r.type===type&&r.pattern.toLowerCase()===pattern.toLowerCase()))s.automod.rules.push({id:Date.now().toString(36),type,pattern,enabled:true});}
    else s.automod.rules=s.automod.rules.filter(r=>r.pattern.toLowerCase()!==pattern.toLowerCase());
    save();await i.reply('تم تحديث قواعد AutoMod.');
});
add(new SlashCommandBuilder().setName('autoreply-remove').setDescription('Remove an autoreply').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o=>o.setName('trigger').setDescription('Trigger').setRequired(true)), async i=>{
    const s=guildData(i.guild.id).settings;s.autoreplies??=[];const before=s.autoreplies.length;s.autoreplies=s.autoreplies.filter(x=>x.trigger!==i.options.getString('trigger'));
    save();await i.reply(before===s.autoreplies.length?'الرد غير موجود.':'تم حذف الرد.');
});
add(new SlashCommandBuilder().setName('autoreply-list').setDescription('List autoreplies').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild), async i=>{
  const rows=guildData(i.guild.id).settings.autoreplies||[];await i.reply({embeds:[embed('Auto Replies',rows.length?rows.map(x=>x.trigger+' -> '+x.reply).join('\n'):'لا توجد ردود.') ]});
});

add(new SlashCommandBuilder().setName('remind-cancel').setDescription('Cancel a reminder')
  .addStringOption(o=>o.setName('id').setDescription('Reminder ID').setRequired(true)), async i=>{
    const id=i.options.getString('id'),before=db.reminders.length;db.reminders=db.reminders.filter(r=>!(r.id===id&&r.guildId===i.guild.id&&r.userId===i.user.id));save();
    await i.reply(before===db.reminders.length?'التذكير غير موجود.':'تم إلغاء التذكير.');
});

add(new SlashCommandBuilder().setName('schedule').setDescription('Schedule a message').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addIntegerOption(o=>o.setName('minutes').setDescription('Minutes from now').setMinValue(1).setMaxValue(525600).setRequired(true))
  .addStringOption(o=>o.setName('message').setDescription('Message').setRequired(true)), async i=>{
    const gd=guildData(i.guild.id);gd.scheduled??=[];const job={id:Date.now().toString(36),guildId:i.guild.id,channelId:i.channel.id,userId:i.user.id,at:Date.now()+i.options.getInteger('minutes')*60000,message:i.options.getString('message'),running:false};
    gd.scheduled.push(job);save();await i.reply('تمت جدولة الرسالة.');
});
add(new SlashCommandBuilder().setName('scheduled').setDescription('List scheduled messages').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages), async i=>{
  const rows=guildData(i.guild.id).scheduled||[];await i.reply({embeds:[embed('Scheduled',rows.length?rows.map(x=>x.id+' — <t:'+Math.floor(x.at/1000)+':R> — '+x.message).join('\n'):'لا توجد رسائل مجدولة.')]});
});
add(new SlashCommandBuilder().setName('schedule-cancel').setDescription('Cancel scheduled message').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addStringOption(o=>o.setName('id').setDescription('Job ID').setRequired(true)), async i=>{
    const gd=guildData(i.guild.id),before=gd.scheduled.length;gd.scheduled=gd.scheduled.filter(x=>x.id!==i.options.getString('id'));save();
    await i.reply(before===gd.scheduled.length?'الجدولة غير موجودة.':'تم إلغاء الجدولة.');
});

add(new SlashCommandBuilder().setName('level-reward-remove').setDescription('Remove a level reward').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addIntegerOption(o=>o.setName('level').setDescription('Level').setMinValue(1).setMaxValue(1000).setRequired(true)), async i=>{
    const gd=guildData(i.guild.id);gd.levelRewards??={};delete gd.levelRewards[String(i.options.getInteger('level'))];save();await i.reply('تم حذف مكافأة المستوى.');
});
add(new SlashCommandBuilder().setName('economy-admin').setDescription('Manage member balance').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o=>o.setName('action').setDescription('set/add/remove').setRequired(true).addChoices({name:'set',value:'set'},{name:'add',value:'add'},{name:'remove',value:'remove'}))
  .addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addIntegerOption(o=>o.setName('amount').setDescription('Amount').setMinValue(0).setRequired(true)), async i=>{
    const eco=economyFor(i.guild),u=i.options.getUser('user'),amount=i.options.getInteger('amount'),k=i.guild.id+':'+u.id;
    await withLock('eco:'+i.guild.id,async()=>{db.economy[k]??={balance:eco.startingBalance,lastDaily:0,transactions:[]};const d=db.economy[k];const a=i.options.getString('action');if(a==='set')d.balance=amount;else if(a==='add')d.balance+=amount;else d.balance=Math.max(0,d.balance-amount);d.transactions??=[];d.transactions.push({id:Date.now().toString(36),at:Date.now(),admin:i.user.id,action:a,amount});d.transactions=d.transactions.slice(-50);save();});
    await i.reply('تم تحديث الرصيد.');
});
add(new SlashCommandBuilder().setName('level-reward').setDescription('Set a level reward role').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addIntegerOption(o=>o.setName('level').setDescription('Level').setMinValue(1).setMaxValue(1000).setRequired(true))
  .addRoleOption(o=>o.setName('role').setDescription('Reward role').setRequired(true)), async i=>{
    const gd=guildData(i.guild.id);gd.levelRewards??={};gd.levelRewards[String(i.options.getInteger('level'))]=i.options.getRole('role').id;save();await i.reply('تم حفظ مكافأة المستوى.');
});

const ticketButtons = type => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('ticket:create:'+type).setLabel({support:'Support',bug:'Bug Report',partnership:'Partnership',developer:'Developer Support'}[type]).setEmoji({support:'🎫',bug:'🐛',partnership:'🤝',developer:'🛠️'}[type]).setStyle(ButtonStyle.Primary)
);
add(new SlashCommandBuilder().setName('ticket-add').setDescription('Add a member to the current ticket').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels).addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)), async i=>{
  const d=db.tickets[i.channel.id]; if(!d||d.status!=='open')return commandError(i,'هذه ليست تذكرة مفتوحة.');
  const m=await fetchMember(i.guild,i.options.getUser('user').id); if(!m)return commandError(i,'العضو غير موجود.');
  await i.channel.permissionOverwrites.edit(m,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true}); await i.reply('تمت إضافة العضو للتذكرة.'); await sendLog(i.guild,'ticket',i.user.tag+' added '+m.user.tag+' to '+i.channel.name);
});
add(new SlashCommandBuilder().setName('ticket-remove').setDescription('Remove a member from the current ticket').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels).addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)), async i=>{
  const d=db.tickets[i.channel.id]; if(!d)return commandError(i,'هذه ليست تذكرة مسجلة.');
  const m=await fetchMember(i.guild,i.options.getUser('user').id); if(!m)return commandError(i,'العضو غير موجود.');
  if(m.id===d.ownerId)return commandError(i,'لا يمكن إزالة صاحب التذكرة.');
  await i.channel.permissionOverwrites.delete(m).catch(()=>{}); await i.reply('تمت إزالة العضو من التذكرة.'); await sendLog(i.guild,'ticket',i.user.tag+' removed '+m.user.tag+' from '+i.channel.name);
});
add(new SlashCommandBuilder().setName('ticket-transfer').setDescription('Transfer ticket ownership').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels).addUserOption(o=>o.setName('user').setDescription('New owner').setRequired(true)), async i=>{
  const d=db.tickets[i.channel.id]; if(!d)return commandError(i,'هذه ليست تذكرة مسجلة.');
  const m=await fetchMember(i.guild,i.options.getUser('user').id); if(!m)return commandError(i,'العضو غير موجود.');
  const oldOwner=await fetchMember(i.guild,d.ownerId); if(oldOwner)await i.channel.permissionOverwrites.edit(oldOwner,{ViewChannel:false,SendMessages:false}).catch(()=>{});
  d.ownerId=m.id; await i.channel.permissionOverwrites.edit(m,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true}); save(); await i.reply('تم نقل ملكية التذكرة إلى '+m+'.'); await sendLog(i.guild,'ticket',i.user.tag+' transferred '+i.channel.name+' to '+m.user.tag);
});
add(new SlashCommandBuilder().setName('ticket-stats').setDescription('Show ticket statistics').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels), async i=>{
  const all=Object.values(db.tickets).filter(x=>x.guildId===i.guild.id),open=all.filter(x=>x.status==='open').length,closed=all.filter(x=>x.status==='closed').length;
  await i.reply({embeds:[embed('Ticket Statistics','**Total:** '+all.length+'\n**Open:** '+open+'\n**Closed:** '+closed)]});
});
add(new SlashCommandBuilder().setName('ticket-panel').setDescription('Send the ticket panel').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels), async i=>{
  if(!config.tickets.enabled)return commandError(i,'نظام التذاكر معطل.');
  const rows=[ticketButtons('support'),ticketButtons('bug'),ticketButtons('partnership'),ticketButtons('developer')];
  await i.channel.send({embeds:[embed(config.tickets.panelTitle,config.tickets.panelDescription)],components:rows}); await i.reply({content:'تم إرسال لوحة التذاكر.',ephemeral:true});
});

add(new SlashCommandBuilder().setName('welcome').setDescription('Configure welcome channel').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption(o=>o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText)).addBooleanOption(o=>o.setName('enabled').setDescription('Enabled').setRequired(true)).addStringOption(o=>o.setName('message').setDescription('Message')), async i=>{
    const s=guildData(i.guild.id).settings;s.welcomeEnabled=i.options.getBoolean('enabled');s.welcomeChannelId=i.options.getChannel('channel')?.id||s.welcomeChannelId;s.welcomeMessage=i.options.getString('message')||config.welcome.message;save();await i.reply('تم حفظ إعدادات الترحيب.');
});
add(new SlashCommandBuilder().setName('autorole').setDescription('Configure autorole').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addRoleOption(o=>o.setName('role').setDescription('Role')).addBooleanOption(o=>o.setName('enabled').setDescription('Enabled').setRequired(true)), async i=>{
    const s=guildData(i.guild.id).settings;s.autoroleEnabled=i.options.getBoolean('enabled');s.autoroleRoleId=i.options.getRole('role')?.id||s.autoroleRoleId;save();await i.reply('تم حفظ إعدادات الرتبة التلقائية.');
});
add(new SlashCommandBuilder().setName('autoreply').setDescription('Add an automatic reply').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(o=>o.setName('trigger').setDescription('Trigger').setRequired(true)).addStringOption(o=>o.setName('reply').setDescription('Reply').setRequired(true)), async i=>{
    const s=guildData(i.guild.id);s.settings.autoreplies??=[];s.settings.autoreplies.push({trigger:i.options.getString('trigger').toLowerCase(),reply:i.options.getString('reply')});save();await i.reply('تمت إضافة الرد التلقائي.');
});
add(new SlashCommandBuilder().setName('announce').setDescription('Send an announcement').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addChannelOption(o=>o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)).addStringOption(o=>o.setName('message').setDescription('Message').setRequired(true)), async i=>{
    const c=i.options.getChannel('channel');await c.send({embeds:[embed('Announcement',i.options.getString('message'),config.colors.info)]});await i.reply({content:'تم إرسال الإعلان.',ephemeral:true});
});
add(new SlashCommandBuilder().setName('remind').setDescription('Create a reminder').addIntegerOption(o=>o.setName('minutes').setDescription('Minutes').setMinValue(1).setMaxValue(525600).setRequired(true)).addStringOption(o=>o.setName('text').setDescription('Reminder').setRequired(true)), async i=>{
  db.reminders.push({id:Date.now().toString(36),guildId:i.guild.id,userId:i.user.id,channelId:i.channel.id,at:Date.now()+i.options.getInteger('minutes')*60000,text:i.options.getString('text')});save();await i.reply('تم ضبط التذكير.');
});
add(new SlashCommandBuilder().setName('suggest').setDescription('Send a suggestion').addStringOption(o=>o.setName('text').setDescription('Suggestion').setRequired(true)), async i=>{
  const c=i.guild.channels.cache.get(guildData(i.guild.id).settings.suggestionChannelId||config.suggestions.channelId); if(!config.suggestions.enabled||!c?.isTextBased())return commandError(i,'قناة الاقتراحات غير مهيأة.');
  db.suggestions??={};
  const id=Date.now().toString(36)+Math.random().toString(36).slice(2,8);
  db.suggestions[id]={id,guildId:i.guild.id,channelId:c.id,authorId:i.user.id,text:i.options.getString('text'),status:'pending',votes:{up:[],down:[]},voters:{}};
  const row=[new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('suggest:vote-up:'+id).setLabel('👍 0').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('suggest:vote-down:'+id).setLabel('👎 0').setStyle(ButtonStyle.Secondary),
    ...(config.suggestions.approvalButtons?[new ButtonBuilder().setCustomId('suggest:approve:'+id).setLabel('Approve').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId('suggest:reject:'+id).setLabel('Reject').setStyle(ButtonStyle.Danger)]:[])
  )];
  const msg=await c.send({embeds:[embed('New Suggestion','**From:** '+i.user+'\n\n'+i.options.getString('text'))],components:row});
  db.suggestions[id].messageId=msg.id;save();await i.reply({content:'تم إرسال الاقتراح.',ephemeral:true});
});

add(new SlashCommandBuilder().setName('giveaway').setDescription('Start a giveaway').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addIntegerOption(o=>o.setName('minutes').setDescription('Duration').setMinValue(1).setMaxValue(10080).setRequired(true))
  .addIntegerOption(o=>o.setName('winners').setDescription('Winners').setMinValue(1).setMaxValue(20).setRequired(true))
  .addStringOption(o=>o.setName('prize').setDescription('Prize').setRequired(true)), async i=>{
    const duration=i.options.getInteger('minutes')*60000,winners=i.options.getInteger('winners'),prize=i.options.getString('prize');
    const msg=await i.channel.send({embeds:[embed('Giveaway','**Prize:** '+prize+'\n**Winners:** '+winners+'\n**Ends:** <t:'+Math.floor((Date.now()+duration)/1000)+':R>')],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('giveaway:join').setLabel('Enter').setEmoji('🎉').setStyle(ButtonStyle.Primary))]});
    db.giveaways[msg.id]={channelId:i.channel.id,guildId:i.guild.id,ends:Date.now()+duration,winners,prize,entries:[]};save();await i.reply({content:'تم إنشاء السحب.',ephemeral:true});
});
add(new SlashCommandBuilder().setName('level').setDescription('Show your level').addUserOption(o=>o.setName('user').setDescription('User')), async i=>{
  const u=i.options.getUser('user')||i.user,k=i.guild.id+':'+u.id,d=db.levels[k]||{xp:0,level:0};await i.reply({embeds:[embed('Level',u+'\n**Level:** '+d.level+'\n**XP:** '+d.xp)]});
});
add(new SlashCommandBuilder().setName('balance').setDescription('Show balance').addUserOption(o=>o.setName('user').setDescription('User')), async i=>{
  const u=i.options.getUser('user')||i.user,k=i.guild.id+':'+u.id;db.economy[k]??={balance:0,lastDaily:0};save();const eco=economyFor(i.guild); db.economy[k]??={balance:eco.startingBalance,lastDaily:0,transactions:[]}; await i.reply('**'+u.tag+'** has **'+db.economy[k].balance+' '+eco.currency+'**.');
});
add(new SlashCommandBuilder().setName('daily').setDescription('Claim daily credits'), async i=>{
  const k=i.guild.id+':'+i.user.id,eco=economyFor(i.guild);db.economy[k]??={balance:eco.startingBalance,lastDaily:0,transactions:[]};if(Date.now()-db.economy[k].lastDaily<eco.dailyCooldownMs)return commandError(i,'استلمت مكافأتك اليومية مسبقًا.');db.economy[k].balance+=eco.dailyAmount;db.economy[k].lastDaily=Date.now();save();await i.reply('تمت إضافة **'+eco.dailyAmount+' '+eco.currency+'** إلى رصيدك.');
});
add(new SlashCommandBuilder().setName('afk').setDescription('Set or clear AFK').addStringOption(o=>o.setName('reason').setDescription('Reason')), async i=>{
  db.afk[i.guild.id+':'+i.user.id]={reason:i.options.getString('reason')||'AFK',at:Date.now()};save();await i.reply('تم تفعيل AFK.');
});


add(new SlashCommandBuilder().setName('bot-info').setDescription('Show bot status and system information'), async i=>{await i.reply({embeds:[embed('Project One — System Status','**Servers:** '+i.client.guilds.cache.size+'\\n**Commands:** '+commands.length+'\\n**Latency:** '+i.client.ws.ping+'ms\\n**Node:** '+process.version+'\\n**Uptime:** '+Math.floor(process.uptime()/60)+' minutes',config.colors.info)]});});
add(new SlashCommandBuilder().setName('protection-whitelist').setDescription('Manage protection whitelist').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o=>o.setName('action').setDescription('add/remove').setRequired(true).addChoices({name:'add',value:'add'},{name:'remove',value:'remove'})).addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)), async i=>{const u=i.options.getUser('user'),a=i.options.getString('action'),s=guildData(i.guild.id).settings;s.protectionWhitelist??=[];if(a==='add'&&!s.protectionWhitelist.includes(u.id))s.protectionWhitelist.push(u.id);if(a==='remove')s.protectionWhitelist=s.protectionWhitelist.filter(x=>x!==u.id);save();await i.reply('تم تحديث قائمة الحماية.');});
add(new SlashCommandBuilder().setName('reminders').setDescription('List your reminders'), async i=>{const x=db.reminders.filter(r=>r.guildId===i.guild.id&&r.userId===i.user.id);await i.reply({embeds:[embed('Reminders',x.length?x.map(r=>'• '+r.text+' — <t:'+Math.floor(r.at/1000)+':R>').join('\\n'):'لا توجد تذكيرات.')]});});
add(new SlashCommandBuilder().setName('giveaway-end').setDescription('End a giveaway').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addStringOption(o=>o.setName('message_id').setDescription('Giveaway message ID').setRequired(true)), async i=>{const id=i.options.getString('message_id'),g=db.giveaways[id];if(!g)return commandError(i,'السحب غير موجود.');g.ends=0;save();await i.reply('تم إنهاء السحب، وستظهر النتيجة قريبًا.');});
\nconst aliases={
  'مساعدة':'help','اوامر':'help','بنج':'ping','معلومات':'server','باند':'ban','حظر':'ban','كيك':'kick','طرد':'kick',
  'تحذير':'warn','تحذيرات':'warnings','مسح':'clear','قفل':'lock','فتح':'unlock','سلو':'slowmode','تكت':'ticket-panel',
  'اقتراح':'suggest','تكت-اضافة':'ticket-add','تكت-حذف':'ticket-remove','تكت-نقل':'ticket-transfer','تكت-احصائيات':'ticket-stats','اعدادات':'settings','معلومات-البوت':'bot-info','قائمة-التذكيرات':'reminders','الغاء-التذكير':'remind-cancel','انهاء-السحب':'giveaway-end','اعادة-السحب':'giveaway-reroll','الغاء-السحب':'giveaway-cancel','لوق':'log-channel','اقتراحات':'suggest-channel','وداع':'goodbye','سحب':'giveaway','لفل':'level','رصيد':'balance','يومي':'daily','اي اف كي':'afk','اي اف كي':'afk',
  'قفل عام':'lockdown','حماية':'protection','اعلان':'announce','تذكير':'remind','رتبة':'role','توب':'leaderboard','توب-فلوس':'economy-top','اوتومود':'automod','حذف-رد':'autoreply-remove','ردود':'autoreply-list','حماية-اعدادات':'protection-config','جدولة':'schedule','المجدول':'scheduled','الغاء-جدولة':'schedule-cancel','مكافاة-لفل':'level-reward','حذف-مكافاة-لفل':'level-reward-remove','اقتصاد-ادمن':'economy-admin','قاعدة-اوتومود':'automod-rule'
};

const client=new Client({
  intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.GuildModeration,GatewayIntentBits.GuildPresences],
  partials:[Partials.Channel,Partials.Message,Partials.GuildMember]
});

const spam=new Map(), joins=new Map(), auditActors=new Map(), ticketBusy=new Set();

async function actorFromAudit(guild,type,targetId){
  try {
    const logs=await guild.fetchAuditLogs({type,limit:5});
    const entry=logs.entries.find(e=>(!targetId||e.target?.id===targetId)&&(Date.now()-e.createdTimestamp<15000));
    return entry?.executor||null;
  } catch { return null; }
}
function actorAllowed(member){ return !member || whitelisted(member); }

async function antiNuke(guild,type,targetId,label){
  const p=protectionFor(guild); if(!p.enabled||!p.antiNuke.enabled||!p.antiNuke.events.includes(label))return;
  const actor=await actorFromAudit(guild,type,targetId); if(!actor||actor.id===client.user.id)return;
  const m=await fetchMember(guild,actor.id); if(actorAllowed(m))return;
  const key=guild.id+':'+actor.id+':'+label,now=Date.now(),arr=(auditActors.get(key)||[]).filter(t=>now-t<p.antiNuke.windowMs);arr.push(now);auditActors.set(key,arr);
  if(arr.length<p.antiNuke.maxActions)return;
  const action=p.antiNuke.action; await punish(m,action,'Anti-Nuke: '+label).catch(()=>{}); auditActors.delete(key);
  await sendLog(guild,'protection','Anti-Nuke triggered against '+actor.tag+' for '+label,config.colors.danger);
}

client.once('ready',async()=>{
  client.user.setActivity(config.bot.activity);
  console.log('[Project One] Ready as '+client.user.tag+' | '+client.guilds.cache.size+' guild(s)');
  if(process.env.CLIENT_ID){try{const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);await rest.put(Routes.applicationCommands(process.env.CLIENT_ID),{body:commands.map(c=>c.data.toJSON())});console.log('[Project One] Registered '+commands.length+' slash commands.')}catch(e){console.error('[Commands]',e.message)}}
});

client.on('guildMemberAdd',async m=>{
  const s=guildData(m.guild.id).settings;
  if(config.protection.antiBot.enabled&&m.user.bot&&!whitelisted(m)){await m.kick('Anti-Bot').catch(()=>{});await sendLog(m.guild,'protection','Anti-Bot removed '+m.user.tag,config.colors.warning);return;}
  if((s.autoroleEnabled??config.autorole.enabled)&& (s.autoroleRoleId||config.autorole.roleId))await m.roles.add(s.autoroleRoleId||config.autorole.roleId).catch(()=>{});
  if(s.welcomeEnabled??config.welcome.enabled){const c=m.guild.channels.cache.get(s.welcomeChannelId||config.welcome.channelId);if(c?.isTextBased())await c.send((s.welcomeMessage||config.welcome.message).replaceAll('{user}',m.toString()).replaceAll('{server}',m.guild.name)).catch(()=>{});}
  if(config.protection.raid.enabled){const now=Date.now(),a=(joins.get(m.guild.id)||[]).filter(t=>now-t<config.protection.raid.windowMs);a.push(now);joins.set(m.guild.id,a);if(a.length>=config.protection.raid.joins){guildData(m.guild.id).settings.raidMode=true;if(config.protection.raid.lockdown)for(const c of m.guild.channels.cache.values())if(c.type===ChannelType.GuildText)await c.permissionOverwrites.edit(m.guild.roles.everyone,{SendMessages:false}).catch(()=>{});await m.timeout(config.protection.raid.timeoutMs,'Anti-Raid').catch(()=>{});await sendLog(m.guild,'protection','Anti-Raid threshold reached: '+a.length+' joins.',config.colors.danger);}}
  await sendLog(m.guild,'memberJoin','Member joined: '+m.user.tag);
});
client.on('guildMemberRemove',async m=>{const s=guildData(m.guild.id).settings;if(s.goodbyeEnabled??config.goodbye.enabled){const c=m.guild.channels.cache.get(s.goodbyeChannelId||config.goodbye.channelId);if(c?.isTextBased())await c.send((s.goodbyeMessage||config.goodbye.message).replaceAll('{user}',m.user.toString()).replaceAll('{server}',m.guild.name)).catch(()=>{});}await sendLog(m.guild,'memberLeave','Member left: '+m.user.tag);});
client.on('guildMemberUpdate',async(a,b)=>{
  if(a.roles.cache.size!==b.roles.cache.size)await sendLog(b.guild,'memberUpdate','Roles changed for '+b.user.tag);
  const added=b.roles.cache.filter(r=>!a.roles.cache.has(r.id));
  const dangerous=added.some(r=>r.permissions.has(PermissionFlagsBits.Administrator)||r.permissions.has(PermissionFlagsBits.ManageGuild)||r.permissions.has(PermissionFlagsBits.ManageChannels)||r.permissions.has(PermissionFlagsBits.ManageRoles));
  if(dangerous)await antiNuke(b.guild,25,b.id,'MEMBER_ROLE_UPDATE');
});
client.on('channelCreate',async c=>{if(c.guild){await antiNuke(c.guild,10,c.id,'CHANNEL_CREATE');await sendLog(c.guild,'channel','Channel created: #'+c.name);}});
client.on('channelDelete',c=>{if(c.guild){antiNuke(c.guild,12,c.id,'CHANNEL_DELETE');sendLog(c.guild,'channel','Channel deleted: #'+c.name,config.colors.warning);}});
client.on('roleCreate',async r=>{if(r.guild){await antiNuke(r.guild,30,r.id,'ROLE_CREATE');await sendLog(r.guild,'role','Role created: '+r.name);}});
client.on('roleUpdate',async(oldRole,newRole)=>{
  const escalated=!oldRole.permissions.has(PermissionFlagsBits.Administrator)&&newRole.permissions.has(PermissionFlagsBits.Administrator);
  if(escalated)await antiNuke(newRole.guild,31,newRole.id,'ROLE_UPDATE');
  await sendLog(newRole.guild,'role','Role updated: '+newRole.name);
});
client.on('roleDelete',r=>{if(r.guild){antiNuke(r.guild,32,r.id,'ROLE_DELETE');sendLog(r.guild,'role','Role deleted: '+r.name,config.colors.warning);}});
client.on('channelUpdate',async(a,b)=>{if(!b.guild)return; if(a.name!==b.name||a.topic!==b.topic)await antiNuke(b.guild,11,b.id,'CHANNEL_UPDATE');await sendLog(b.guild,'channel','Channel updated: #'+b.name);});
client.on('guildUpdate',async(a,b)=>{await antiNuke(b,1,b.id,'GUILD_UPDATE');await sendLog(b,'server','Server settings/name updated.',config.colors.warning);});
client.on('guildAuditLogEntryCreate',async(entry,guild)=>{
  const map={50:'WEBHOOK_CREATE',52:'WEBHOOK_DELETE'};
  const label=map[entry.actionType];
  if(label){await antiNuke(guild,entry.actionType,entry.targetId,label);await sendLog(guild,'webhook','Webhook audit event: '+label,config.colors.warning);}
});
client.on('guildMemberRemove',async m=>{if(!m.guild)return;const gd=guildData(m.guild.id),p=protectionFor(m.guild),key=m.guild.id+':'+m.user.id+':MEMBER_KICK',now=Date.now();const arr=(auditActors.get(key)||[]).filter(t=>now-t<p.antiNuke.windowMs);const actor=await actorFromAudit(m.guild,20,m.user.id);if(actor&&actor.id!==client.user.id){const am=await fetchMember(m.guild,actor.id);if(!actorAllowed(am)){arr.push(now);auditActors.set(key,arr);if(arr.length>=p.antiNuke.maxActions){await punish(am,p.antiNuke.action,'Anti-Nuke: MEMBER_KICK').catch(()=>{});auditActors.delete(key);await sendLog(m.guild,'protection','Anti-Nuke triggered against '+actor.tag+' for MEMBER_KICK',config.colors.danger);}}}});
client.on('webhooksUpdate',async c=>{if(c.guild)await sendLog(c.guild,'webhook','Webhook configuration changed in #'+c.name,config.colors.warning);});
client.on('guildBanAdd',async b=>{await antiNuke(b.guild,22,b.user.id,'MEMBER_BAN_ADD');});
client.on('messageDelete',async m=>{if(m.guild)await sendLog(m.guild,'messageDelete','Message deleted in #'+(m.channel?.name||'unknown')+(m.author?' by '+m.author.tag:''),config.colors.warning);});
client.on('messageUpdate',async(a,b)=>{if(b.guild&&a.content!==b.content)await sendLog(b.guild,'messageUpdate','Message edited in #'+(b.channel?.name||'unknown'),config.colors.warning);});
client.on('voiceStateUpdate',async(a,b)=>{if(b.guild&&a.channelId!==b.channelId)await sendLog(b.guild,'voice','Voice state changed for '+b.member.user.tag);});

client.on('messageCreate',async m=>{
  if(!m.guild||m.author.bot)return;
  for(const d of Object.values(db.tickets||{}))if(d.guildId===m.guild.id&&d.status==='open'&&d.channelId===m.channel.id)d.lastActivity=Date.now();
  const now=Date.now(),key=m.guild.id+':'+m.author.id;
  if(db.afk[m.guild.id+':'+m.author.id]){delete db.afk[m.guild.id+':'+m.author.id];save();await m.reply('تم إلغاء AFK تلقائيًا.').catch(()=>{});}
  for(const mentioned of m.mentions.users.values()){const a=db.afk[m.guild.id+':'+mentioned.id];if(a)await m.reply(mentioned.tag+' حالياً AFK: '+a.reason).catch(()=>{});}
  const s=guildData(m.guild.id).settings;
  const rules=s.autoreplies||config.autoreply.rules;
  const hit=rules.find(x=>m.content.toLowerCase().includes(String(x.trigger).toLowerCase()));if(hit)await m.reply(hit.reply).catch(()=>{});
  const protection=protectionFor(m.guild);
  if(protection.enabled&&protection.spam.enabled&&!whitelisted(m.member)){
    const a=(spam.get(key)||[]).filter(t=>now-t<protection.spam.windowMs);a.push(now);spam.set(key,a);
    if(a.length>=protection.spam.maxMessages){await m.member.timeout(protection.spam.timeoutMs,'Anti-Spam').catch(()=>{});await m.delete().catch(()=>{});spam.delete(key);await sendLog(m.guild,'protection','Anti-Spam action against '+m.author.tag,config.colors.warning);return;}
  }
  if(protection.enabled&&!whitelisted(m.member)){
    if(protection.mentions.enabled&&m.mentions.users.size>protection.mentions.maxMentions){await m.delete().catch(()=>{});await sendLog(m.guild,'protection','Mass mention blocked from '+m.author.tag,config.colors.warning);return;}
    if(protection.links.enabled&&protection.links.blockInvites&&/discord\.gg\/|discord\.com\/invite\//i.test(m.content)){await m.delete().catch(()=>{});await sendLog(m.guild,'protection','Discord invite blocked from '+m.author.tag,config.colors.warning);return;}
    if(protection.caps.enabled&&m.content.length>=protection.caps.minimumLength){const letters=m.content.replace(/[^A-Za-z]/g,''),upper=letters.replace(/[^A-Z]/g,'');if(letters.length&&upper.length/letters.length>=protection.caps.threshold){await m.delete().catch(()=>{});await sendLog(m.guild,'protection','Excessive caps blocked from '+m.author.tag,config.colors.warning);return;}}
  }
  const am=automodFor(m.guild);
  const ex=am.exceptions||{};
  const exempt=ex.userIds?.includes(m.author.id)||ex.roleIds?.some(id=>m.member.roles.cache.has(id))||ex.channelIds?.includes(m.channel.id);
  if(am.enabled&&!exempt&&!whitelisted(m.member)){
    const rules=[...(am.badWords||[]),...(am.rules||[]).filter(r=>r.enabled!==false&&r.type==='word').map(r=>r.pattern)].filter(Boolean);
    const dupKey='dup:'+m.guild.id+':'+m.author.id;
    const recent=(spam.get(dupKey)||[]).filter(x=>now-x.at<(am.duplicate?.windowMs||10000));
    recent.push({at:now,content:m.content.trim().toLowerCase()}); spam.set(dupKey,recent);
    const same=recent.filter(x=>x.content===m.content.trim().toLowerCase()).length;
    const lower=m.content.toLowerCase();
    const blockedDomain=(am.links?.enabled&&Array.isArray(am.links.blockedDomains)&&am.links.blockedDomains.some(d=>lower.includes(String(d).toLowerCase())));
    const hit=rules.some(w=>lower.includes(String(w).toLowerCase()))
      || (am.duplicate?.enabled&&same>=(am.duplicate.max||3))
      || (am.mentions?.enabled&&m.mentions.users.size>(am.mentions.max||8))
      || (am.invites?.enabled&&/discord\.gg\/|discord\.com\/invite\//i.test(m.content))
      || blockedDomain;
    if(hit){
      if(am.deleteMessages!==false)await m.delete().catch(()=>{});
      if(am.warnOnViolation){
        const list=warnList(m.guild.id,m.author.id);
        list.push({id:Date.now().toString(36),by:client.user.id,reason:'AutoMod violation',at:Date.now()});
        if(list.length>=(am.maxWarnings||3))await m.member.timeout(am.timeoutMs||600000,'AutoMod escalation').catch(()=>{});
        save();
      }
      await sendLog(m.guild,'automod','AutoMod blocked content from '+m.author.tag,config.colors.warning);return;
    }
  }
  const levels=levelFor(m.guild);
  if(levels.enabled){const k=m.guild.id+':'+m.author.id,d=db.levels[k]??{xp:0,level:0,last:0};if(now-d.last>=levels.cooldownMs){const oldLevel=d.level;d.xp+=levels.xpPerMessage;d.last=now;while(d.xp>=(d.level+1)*(levels.xpPerLevel||100))d.level++;db.levels[k]=d;save();if(d.level>oldLevel){const rewards=guildData(m.guild.id).levelRewards||{};const roleId=rewards[String(d.level)]||levels.rewards?.[String(d.level)];if(roleId)await m.member.roles.add(roleId).catch(()=>{});}}}
  if(!m.content.startsWith(config.bot.prefix))return;
  const parts=m.content.slice(config.bot.prefix.length).trim().split(/\s+/),raw=(parts.shift()||'').toLowerCase(),name=aliases[raw]||raw,c=commands.find(x=>x.data.name===name);if(!c)return;
  const required={settings:'Administrator','log-channel':'ManageGuild','suggest-channel':'ManageGuild',goodbye:'ManageGuild','autorole-remove':'ManageRoles','bot-info':null,reminders:null,'giveaway-end':'ManageGuild','giveaway-reroll':'ManageGuild','giveaway-cancel':'ManageGuild','automod':'ManageGuild','autoreply-remove':'ManageGuild','autoreply-list':'ManageGuild','remind-cancel':null,'leaderboard':null,'economy-top':null,'protection-config':'Administrator','protection-restore':'Administrator','schedule':'ManageMessages','scheduled':'ManageMessages','schedule-cancel':'ManageMessages','level-reward':'ManageRoles','level-reward-remove':'ManageRoles','economy-admin':'ManageGuild','automod-rule':'ManageGuild','protection-whitelist':'Administrator',ban:'BanMembers',kick:'KickMembers',unban:'BanMembers',timeout:'ModerateMembers',untimeout:'ModerateMembers',warn:'ModerateMembers',warnings:'ModerateMembers',clear:'ManageMessages',lock:'ManageChannels',unlock:'ManageChannels',slowmode:'ManageChannels',role:'ManageRoles','ticket-panel':'ManageChannels',welcome:'ManageGuild',autorole:'ManageRoles',autoreply:'ManageGuild',announce:'ManageMessages',giveaway:'ManageGuild',lockdown:'Administrator',protection:'Administrator'};
  const custom=config.commands.customPermissions?.[name]; if(custom&&!m.member.permissions.has(custom)&&!owner(m.author.id))return m.reply('ما عندك الصلاحية المطلوبة.'); if(required[name]&&!m.member.permissions.has(PermissionFlagsBits[required[name]])&&!owner(m.author.id))return m.reply('ما عندك الصلاحية المطلوبة.');
  const target=parts[0]?await fetchMember(m.guild,parts[0]):null;
  const fake={guild:m.guild,channel:m.channel,user:m.author,member:m.member,client,options:{
    getUser:()=>target?.user||null,getString:(n)=>{if(name==='suggest')return parts.join(' ');if(name==='ban'||name==='kick'||name==='warn')return parts.slice(1).join(' ')||null;return parts.join(' ')||null;},
    getInteger:(n)=>name==='timeout'?Number(parts[1])||0:Number(parts[0])||0,getBoolean:()=>parts[0]==='true',getRole:()=>null,getChannel:()=>m.channel
  },reply:p=>m.reply(p),followUp:p=>m.reply(p)};
  try{await c.run(fake);await sendLog(m.guild,'command',m.author.tag+' used !'+raw);}catch(e){console.error('[Prefix]',e);await m.reply('حدث خطأ أثناء تنفيذ الأمر.').catch(()=>{});}
});

async function createTicket(i,type){ if(!ticketConfiguredType(type))return commandError(i,'نوع التذكرة غير مفعّل.');
  const busyKey=i.guild.id+':'+i.user.id;if(ticketBusy.has(busyKey))return commandError(i,'جاري إنشاء تذكرتك، انتظر لحظة.');ticketBusy.add(busyKey);try{
  const gd=guildData(i.guild.id);const openCount=i.guild.channels.cache.filter(c=>c.topic?.includes('ticket-owner:'+i.user.id)&&c.topic?.includes('ticket-status:open')).size;if(openCount>=(config.tickets.maxOpenPerUser||1))return commandError(i,'عندك الحد الأقصى من التذاكر المفتوحة.');
  gd.ticketCounter++;const name=config.tickets.naming.replace('{number}',String(gd.ticketCounter)).replace('{user}',i.user.username).replace('{type}',type).slice(0,90);
  const ow=[{id:i.guild.roles.everyone.id,deny:['ViewChannel']},{id:i.user.id,allow:['ViewChannel','SendMessages','ReadMessageHistory','AttachFiles']}];if(config.tickets.staffRoleId)ow.push({id:config.tickets.staffRoleId,allow:['ViewChannel','SendMessages','ReadMessageHistory','ManageMessages']});
  const ch=await i.guild.channels.create({name,type:ChannelType.GuildText,parent:config.tickets.categoryId||undefined,topic:'ticket-owner:'+i.user.id+';ticket-type:'+type+';ticket-status:open;ticket-number:'+gd.ticketCounter,permissionOverwrites:ow});db.tickets[ch.id]={guildId:i.guild.id,channelId:ch.id,ownerId:i.user.id,type,status:'open',number:gd.ticketCounter,created:Date.now(),lastActivity:Date.now(),claimedBy:null};save();
  const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:close').setLabel('إغلاق').setEmoji('🔒').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('ticket:claim').setLabel('استلام').setEmoji('👤').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId('ticket:delete').setLabel('حذف').setEmoji('🗑️').setStyle(ButtonStyle.Danger));
  await ch.send({content:i.user.toString(),embeds:[embed('Ticket — '+type,'تم إنشاء التذكرة. اكتب تفاصيل طلبك هنا.')],components:[row]});await i.reply({content:'تم إنشاء التذكرة: '+ch,ephemeral:true});await sendLog(i.guild,'ticket','Ticket #'+gd.ticketCounter+' created by '+i.user.tag);
  } finally { ticketBusy.delete(busyKey); }
}
async function transcript(ch){
  if(!config.tickets.transcript)return null;
  const rows=[];let before;
  for(let page=0;page<100;page++){
    const opts={limit:100};if(before)opts.before=before;
    const msgs=await ch.messages.fetch(opts).catch(()=>null);if(!msgs||!msgs.size)break;
    rows.push(...msgs.values());before=msgs.last().id;if(msgs.size<100)break;
  }
  rows.sort((a,b)=>a.createdTimestamp-b.createdTimestamp);
  return rows.map(m=>'['+new Date(m.createdTimestamp).toISOString()+'] '+m.author.tag+': '+(m.content||'[embed/attachment]')).join('\n');
}
async function sendTranscriptLog(guild,name,text){
  if(!text||!config.logs.enabled||!config.logs.events.ticket)return;
  const id=guildData(guild.id).settings.logChannelId||config.logs.channelId,c=guild.channels.cache.get(id);
  if(c?.isTextBased())await c.send({content:'Transcript: '+name,files:[new AttachmentBuilder(Buffer.from(text,'utf8'),{name:name.replace(/[^a-z0-9._-]/gi,'_')+'.txt'})]}).catch(()=>{});
}

client.on('interactionCreate',async i=>{
  try{
    if(i.isChatInputCommand()){const c=commands.find(x=>x.data.name===i.commandName);if(!c)return;const wait=commandCooldown(i.user.id,i.commandName);if(wait)return commandError(i,'انتظر '+wait+' ثانية قبل تكرار الأمر.');await c.run(i);return;}
    if(i.isStringSelectMenu()&&i.customId==='help:category'){const map={moderation:'ban, kick, timeout, warn, warnings, clear, lock, unlock, slowmode, role',protection:'protection, lockdown, protection-whitelist',tickets:'ticket-panel, ticket-add, ticket-remove, ticket-transfer, ticket-stats',community:'suggest, giveaway, giveaway-end, level, balance, daily, afk',utility:'ping, server, user, member, bot-info, settings'};return i.update({embeds:[embed('Command Center — '+i.values[0],map[i.values[0]])],components:i.message.components});} if(!i.isButton())return;
    if(i.customId.startsWith('ticket:create:'))return createTicket(i,i.customId.split(':')[2]);
    if(i.customId==='ticket:close'){const d=db.tickets[i.channel.id];if(!d||!ticketAccess(i,d))return commandError(i,'ليس لديك صلاحية على هذه التذكرة.');const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:confirm-close').setLabel('تأكيد الإغلاق').setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId('ticket:cancel-close').setLabel('إلغاء').setStyle(ButtonStyle.Secondary));return i.reply({content:'تأكيد إغلاق التذكرة؟',components:[row],ephemeral:true});}
    if(i.customId==='ticket:cancel-close')return i.update({content:'تم إلغاء الإغلاق.',components:[]});
    if(i.customId==='ticket:confirm-close'){const d=db.tickets[i.channel.id];if(!d)return commandError(i,'بيانات التذكرة غير موجودة.');d.status='closed';d.closedAt=Date.now();await i.channel.setTopic(ticketTopic(d)).catch(()=>{});const m=await fetchMember(i.guild,d.ownerId);if(m)await i.channel.permissionOverwrites.edit(m,{ViewChannel:false,SendMessages:false}).catch(()=>{});save();const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:reopen').setLabel('إعادة فتح').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId('ticket:delete').setLabel('حذف').setStyle(ButtonStyle.Danger));await i.channel.send({embeds:[embed('Ticket Closed','تم إغلاق التذكرة بواسطة '+i.user+'.',config.colors.warning)],components:[row]});return i.update({content:'تم إغلاق التذكرة.',components:[]});}
    if(i.customId==='ticket:reopen'){const d=db.tickets[i.channel.id];if(!d)return commandError(i,'بيانات التذكرة غير موجودة.');const m=await fetchMember(i.guild,d.ownerId);if(m)await i.channel.permissionOverwrites.edit(m,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true}).catch(()=>{});d.status='open';await i.channel.setTopic(ticketTopic(d)).catch(()=>{});save();return i.reply({embeds:[embed('Ticket Reopened','تمت إعادة فتح التذكرة.',config.colors.success)]});}
    if(i.customId==='ticket:claim'){const d=db.tickets[i.channel.id];if(!d||!isTicketStaff(i))return commandError(i,'استلام التذكرة متاح للستاف فقط.');d.claimedBy=i.user.id;save();return i.reply({embeds:[embed('Ticket Claimed','تم استلام التذكرة بواسطة '+i.user+'.',config.colors.success)]});}
    if(i.customId==='ticket:delete'){if(!db.tickets[i.channel.id])return commandError(i,'هذه ليست تذكرة مسجلة.');if(!i.member.permissions.has(PermissionFlagsBits.ManageChannels)&&!owner(i.user.id))return commandError(i,'حذف التذكرة متاح للإدارة فقط.');const t=await transcript(i.channel);if(t)await sendTranscriptLog(i.guild,i.channel.name,t);await i.reply('سيتم حذف التذكرة...');setTimeout(()=>i.channel.delete().catch(()=>{}),800);return;}
    if(i.customId==='giveaway:join'){
  const msg=db.giveaways[i.message.id];
  if(!msg)return commandError(i,'السحب غير موجود.');
  if(msg.ends<=Date.now())return commandError(i,'انتهى السحب.');
  const age=config.giveaways.minAccountAgeMs||0;
  if(age>0 && Date.now()-i.user.createdTimestamp<age)return commandError(i,'حسابك لا يحقق الحد الأدنى لعمر الحساب.');
  if(config.giveaways.minMembers>0 && i.guild.memberCount<config.giveaways.minMembers)return commandError(i,'السيرفر لا يحقق الحد الأدنى المطلوب.');
  msg.entries??=[];
  if(msg.entries.includes(i.user.id))return commandError(i,'أنت مسجل بالفعل في السحب.');
  msg.entries.push(i.user.id);save();
  return i.reply({content:'تم تسجيل دخولك في السحب.',ephemeral:true});
}
    if(i.customId.startsWith('suggest:')){
      const [,action,id]=i.customId.split(':');db.suggestions??={};const d=db.suggestions[id];
      if(!d)return commandError(i,'الاقتراح غير موجود.');
      if(action==='vote-up'||action==='vote-down'){
        if(d.status!=='pending')return commandError(i,'الاقتراح مغلق.');
        d.voters??={}; if(d.voters[i.user.id])return commandError(i,'سبق لك التصويت.');
        d.voters[i.user.id]=action==='vote-up'?'up':'down';d.votes??={up:[],down:[]};
        d.votes[action==='vote-up'?'up':'down'].push(i.user.id);save();
        const row=new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('suggest:vote-up:'+id).setLabel('👍 '+d.votes.up.length).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('suggest:vote-down:'+id).setLabel('👎 '+d.votes.down.length).setStyle(ButtonStyle.Secondary),
          ...(config.suggestions.approvalButtons?[new ButtonBuilder().setCustomId('suggest:approve:'+id).setLabel('Approve').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId('suggest:reject:'+id).setLabel('Reject').setStyle(ButtonStyle.Danger)]:[])
        );
        await i.message.edit({components:[row]}).catch(()=>{});
        return i.reply({content:'تم تسجيل تصويتك.',ephemeral:true});
      }
      if(action==='approve'||action==='reject'){
        const staff=hasGuildPermission(i.member,PermissionFlagsBits.ManageGuild)||(config.suggestions.staffRoleId&&i.member.roles.cache.has(config.suggestions.staffRoleId));
        if(!staff)return commandError(i,'هذا الإجراء متاح للإدارة فقط.');
        if(d.status!=='pending')return commandError(i,'الاقتراح مغلق.');
        d.status=action==='approve'?'approved':'rejected';d.reviewedBy=i.user.id;d.reviewedAt=Date.now();save();
        const row=new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('suggest:vote-up:'+id).setLabel('👍 '+(d.votes?.up?.length||0)).setStyle(ButtonStyle.Primary).setDisabled(true),
          new ButtonBuilder().setCustomId('suggest:vote-down:'+id).setLabel('👎 '+(d.votes?.down?.length||0)).setStyle(ButtonStyle.Secondary).setDisabled(true)
        );
        await i.message.edit({components:[row]}).catch(()=>{});
        return i.reply({content:'تم تحديث حالة الاقتراح.',ephemeral:true});
      }
    }
  }catch(e){console.error('[Interaction]',e);await commandError(i,'حدث خطأ أثناء تنفيذ العملية.').catch(()=>{});}
});

setInterval(()=>Promise.all(client.guilds.cache.map(g=>takeSnapshot(g))),60000);

setInterval(async()=>{
  const now=Date.now();
  for(const [id,d] of Object.entries(db.tickets||{})){
    if(d.status!=='open'||!config.tickets.inactivityMs||now-(d.lastActivity||d.created)>config.tickets.inactivityMs)continue;
    const ch=client.channels.cache.get(d.channelId);
    if(!ch?.isTextBased())continue;
    d.status='closed';d.closedAt=now;await ch.setTopic(ticketTopic(d)).catch(()=>{});
    const ownerMember=await fetchMember(ch.guild,d.ownerId);if(ownerMember)await ch.permissionOverwrites.edit(ownerMember,{ViewChannel:false,SendMessages:false}).catch(()=>{});
    await ch.send({embeds:[embed('Ticket Auto-Closed','تم إغلاق التذكرة تلقائيًا بسبب عدم النشاط.',config.colors.warning)]}).catch(()=>{});
    save();
  }
  for(const [gid,times] of joins){const p=protectionFor(client.guilds.cache.get(gid)||{id:gid});if(!times.length)continue;if(Date.now()-times[times.length-1]>(p.raid.windowMs||10000)){const gd=db.guilds[gid];if(gd?.settings?.raidMode){gd.settings.raidMode=false;save();}}}

  for(const gd of Object.values(db.guilds)){for(const s of [...(gd.scheduled||[])])if(s.at<=now&&!s.running){s.running=true;const c=client.channels.cache.get(s.channelId);if(c?.isTextBased())await c.send(s.message).catch(()=>{});gd.scheduled=gd.scheduled.filter(x=>x.id!==s.id);save();}}
  for(const r of [...db.reminders])if(r.at<=now){const g=client.guilds.cache.get(r.guildId),c=g?.channels.cache.get(r.channelId);if(c?.isTextBased())await c.send('<@'+r.userId+'> تذكير: '+r.text).catch(()=>{});db.reminders=db.reminders.filter(x=>x.id!==r.id);save();}
  for(const [id,g] of Object.entries(db.giveaways)){if(g.ends<=now){const c=client.channels.cache.get(g.channelId),entries=[...new Set(g.entries)];const winners=[];for(let n=0;n<Math.min(g.winners,entries.length);n++){const idx=Math.floor(Math.random()*entries.length);winners.push(entries.splice(idx,1)[0]);}if(c?.isTextBased())await c.send({embeds:[embed('Giveaway Ended','**Prize:** '+g.prize+'\n**Winners:** '+(winners.length?winners.map(x=>'<@'+x+'>').join(', '):'No valid entries'),config.colors.success)]}).catch(()=>{});db.finishedGiveaways??={};db.finishedGiveaways[id]={...g,winners,finishedAt:Date.now(),status:'finished'}; if(c?.isTextBased()){const original=await c.messages.fetch(id).catch(()=>null);if(original)await original.edit({components:[],embeds:[embed('Giveaway Ended','**Prize:** '+g.prize+'\n**Winners:** '+(winners.length?winners.map(x=>'<@'+x+'>').join(', '):'No valid entries'),config.colors.success)]}).catch(()=>{});} delete db.giveaways[id];save();}}
},15000);

async function shutdown(signal){
  try { save(); if(saveTimer) await new Promise(r=>setTimeout(r,150)); } finally { client.destroy(); process.exit(0); }
}
process.once('SIGINT',()=>shutdown('SIGINT'));
process.once('SIGTERM',()=>shutdown('SIGTERM'));

process.on('unhandledRejection',e=>console.error('[Unhandled]',e));
process.on('uncaughtException',e=>console.error('[Uncaught]',e));
if(!process.env.DISCORD_TOKEN){console.error('Missing DISCORD_TOKEN');process.exit(1);}

function dbValidate(){
  db.guilds??={};db.warnings??={};db.tickets??={};db.suggestions??={};db.giveaways??={};db.finishedGiveaways??={};
  db.reminders??=[];db.economy??={};db.levels??={};db.schemaVersion??=2;
  for(const [id,d] of Object.entries(db.tickets)) if(!d.guildId||!d.ownerId||!['open','closed'].includes(d.status)) delete db.tickets[id];
  for(const d of Object.values(db.tickets)) { d.lastActivity??=d.created||Date.now(); d.claimedBy??=null; }
  for(const d of Object.values(db.giveaways)) d.entries??=[];
  for(const d of Object.values(db.finishedGiveaways)) d.entries??=[];
  for(const d of Object.values(db.suggestions)) { d.votes??={up:[],down:[]}; d.voters??={}; }
}
dbValidate();

async function safeSave(){ try{ save(); return true; }catch(e){ console.error('Database save failed:',e); return false; } }

function ticketConfiguredType(type){
  return Array.isArray(config.tickets.types)&&config.tickets.types.includes(type);
}



client.login(process.env.DISCORD_TOKEN);
