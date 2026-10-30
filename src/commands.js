import { ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, RESTJSONErrorCodes, SlashCommandBuilder, escapeMarkdown } from 'discord.js';

const filters = (sub, { withPublic = false } = {}) => {
  sub.addChannelOption(opt => opt.setName('channel').setDescription('指定語音頻道；省略則查詢你可檢視的語音頻道').addChannelTypes(ChannelType.GuildVoice));
  if (withPublic) sub.addBooleanOption(opt => opt.setName('public').setDescription('是否公開到目前頻道；省略或選否時只有自己可見'));
  return sub.addIntegerOption(opt => opt.setName('days').setDescription('最近幾天（依接收時間）；省略為全部紀錄').setMinValue(1).setMaxValue(365));
};

export const command = new SlashCommandBuilder().setName('soundboard').setDescription('原生音效板使用統計及監測範圍').setDMPermission(false)
  .addSubcommand(sub => sub.setName('join').setDescription('開始監測你所在的語音房（管理伺服器權限）'))
  .addSubcommand(sub => sub.setName('leave').setDescription('停止監測並取消自動重連（管理伺服器權限）'))
  .addSubcommand(sub => filters(sub.setName('sounds').setDescription('已觀測音效播放次數排行榜'), { withPublic: true })
    .addBooleanOption(opt => opt.setName('show_unknown').setDescription('是否顯示未知／外部／已刪除音效；省略僅隱藏末尾未知項目')))
  .addSubcommand(sub => filters(sub.setName('users').setDescription('使用者排行或個人統計'), { withPublic: true })
    .addUserOption(opt => opt.setName('user').setDescription('指定使用者；省略則顯示排行')))
  .addSubcommand(sub => filters(sub.setName('status').setDescription('查詢監測範圍、期間及缺口')))
  .addSubcommand(sub => sub.setName('refresh').setDescription('更新音效名稱（管理伺服器權限）'));

export const scopeNotice = '僅統計收到的 Soundboard 事件；未監測房間與離線期間屬於未知，不代表零使用。時間為接收時間，重連補送的原始播放時間未知。';

export function queryFilter(interaction, now = Date.now()) {
  const channel = interaction.options.getChannel('channel');
  const visible = [...interaction.guild.channels.cache.values()].filter(c => c.type === ChannelType.GuildVoice
    && c.permissionsFor(interaction.member)?.has(PermissionFlagsBits.ViewChannel)).map(c => c.id);
  if (channel && !visible.includes(channel.id)) throw new Error('無法查詢你不能檢視的語音頻道。');
  const days = interaction.options.getInteger('days');
  return { guildId: interaction.guildId, channelIds: channel ? [channel.id] : visible,
    since: days ? now - days * 86_400_000 : 0, until: now };
}

const stamp = ms => `<t:${Math.floor(ms / 1000)}:f>`;
const label = row => row.name ? escapeMarkdown(row.name).slice(0, 70) : '未知／外部／已刪除音效';

async function trimMissingMembers(guild, rows) {
  let end = rows.length;
  while (end > 0) {
    try {
      // A missing or stale cache entry does not establish guild membership.
      await guild.members.fetch({ user: rows[end - 1].user_id, force: true, cache: false });
      break;
    } catch (error) {
      if (![RESTJSONErrorCodes.UnknownMember, RESTJSONErrorCodes.UnknownUser].includes(error?.code)) break;
      end--;
    }
  }
  return rows.slice(0, end);
}

export function report(store, filter, mode, userId = null, { showUnknown = null, stats } = {}) {
  stats ??= store.stats(filter, { userId, showUnknown: mode === 'sounds' ? showUnknown : null });
  const coverage = store.coverage(filter);
  const duration = Math.floor(coverage.reduce((sum, row) => sum + row.milliseconds, 0) / 1000);
  const coverageSummary = `已確認監測：${coverage.length} 個頻道，合計 ${duration} 秒。`;
  if (mode === 'sounds' || mode === 'users') {
    let rows = mode === 'sounds' ? stats.soundRows : stats.userRows;
    if (mode === 'sounds' && showUnknown !== true) {
      rows = showUnknown === false ? rows.filter(row => row.name)
        : rows.slice(0, rows.findLastIndex(row => row.name) + 1);
    }
    const ranking = stats.total === 0 ? ['此查詢範圍內尚無觀測紀錄。']
      : rows.length === 0 ? ['此查詢範圍內沒有可顯示的排行項目。']
      : mode === 'sounds'
        ? rows.map((row, i) => `${i + 1}. ${label(row)}：${row.count} 次`)
        : rows.map((row, i) => `${i + 1}. **<@${row.user_id}>**：${row.count} 次／${row.sounds} 個音效`);
    return [coverageSummary, '', ...ranking].join('\n');
  }
  const range = filter.since ? `${stamp(filter.since)} 至 ${stamp(filter.until)}` : `全部已儲存紀錄，截至 ${stamp(filter.until)}`;
  const lines = ['**監測狀態**',
    `查詢範圍：${filter.channelIds.length === 1 ? `<#${filter.channelIds[0]}>` : `${filter.channelIds.length} 個可檢視的語音頻道`}；${range}`,
    `已記錄 ${stats.total} 次；${stats.users} 位使用者；${stats.sounds} 個音效；其中 ${stats.replay} 次為重連補送。`,
    coverageSummary];
  lines.push('最近監測區段（最多 5 筆）：');
  for (const row of store.recentCoverage(filter)) {
    lines.push(`<#${row.channel_id}> ${stamp(row.started_at_ms)} → ${stamp(row.ended_at_ms ?? row.confirmed_at_ms)}；${row.ended_at_ms === null ? '監測中' : row.end_reason}`);
  }
  lines.push(scopeNotice);
  return lines.join('\n');
}

export async function refreshSounds(client, guild, store) {
  // Metadata is optional. Statistics remain usable by ID if either fetch fails.
  const results = await Promise.allSettled([client.fetchDefaultSoundboardSounds(), guild.soundboardSounds.fetch()]);
  const sounds = new Map();
  for (const result of results) if (result.status === 'fulfilled') {
    for (const sound of result.value.values()) {
      const id = String(sound.soundId);
      store.upsertSound(id, sound.name);
      sounds.set(id, { sound_id: id, name: sound.name });
    }
  }
  return { count: sounds.size, failures: results.filter(r => r.status === 'rejected').length, sounds: [...sounds.values()] };
}

export async function handleCommand(interaction, { client, voice, tracker, store, now = Date.now, refresh = refreshSounds }) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'soundboard') return;
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: '請在已就緒的伺服器中使用此指令。', flags: MessageFlags.Ephemeral });
    return;
  }
  const sub = interaction.options.getSubcommand();
  const isPublic = ['sounds', 'users'].includes(sub) && interaction.options.getBoolean('public') === true;
  await interaction.deferReply(isPublic ? {} : { flags: MessageFlags.Ephemeral });
  try {
    if (['join', 'leave', 'refresh'].includes(sub) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      throw new Error('此操作需要「管理伺服器」權限。');
    }
    let content;
    let files;
    let embeds;
    if (sub === 'join') {
      const channel = interaction.member.voice.channel;
      if (!channel) throw new Error('請先加入要監測的語音頻道。');
      await voice.connect(channel);
      const active = tracker.active.get(interaction.guildId);
      content = active?.channelId === channel.id ? `已開始監測 <#${channel.id}>。`
        : '語音連線已建立，正在等候 Gateway 與語音狀態確認；請用 /soundboard status 檢查。';
    } else if (sub === 'leave') {
      await voice.leave(interaction.guildId);
      content = '已停止監測，並取消此伺服器的自動重連。歷史紀錄已保留。';
    } else if (sub === 'refresh') {
      const result = await refresh(client, interaction.guild, store);
      const summary = `已更新 ${result.count} 筆音效名稱。${result.failures ? '音效清單讀取未全部成功；以下僅列出本次成功讀取的音效。' : ''}`;
      const rows = result.sounds.map((sound, i) => `${i + 1}. ${label(sound)}（ID ${sound.sound_id}）`);
      content = [summary, '', ...(rows.length ? rows : ['本次沒有可列出的音效。'])].join('\n');
      if (content.length > 2000) {
        files = [{ attachment: Buffer.from(content, 'utf8'), name: 'soundboard-sounds.txt' }];
        content = `${summary}\n完整音效名稱與 ID 清單請見附件。`;
      }
    } else {
      tracker.checkpoint();
      const filter = queryFilter(interaction, now());
      const userId = sub === 'users' ? interaction.options.getUser('user')?.id : null;
      const showUnknown = sub === 'sounds' ? interaction.options.getBoolean('show_unknown') : null;
      let stats;
      if (sub === 'users') {
        stats = store.stats(filter, { userId });
        stats = { ...stats, userRows: await trimMissingMembers(interaction.guild, stats.userRows) };
      }
      content = report(store, filter, sub, userId, { stats, showUnknown });
      if (['sounds', 'users'].includes(sub) && content.length > 2000) {
        embeds = [new EmbedBuilder().setDescription(content).toJSON()];
        content = '';
      }
      if (sub === 'status') {
        const target = voice.desired.get(interaction.guildId);
        const active = tracker.active.get(interaction.guildId);
        const describe = id => filter.channelIds.includes(id) ? `<#${id}>` : '查詢範圍外的頻道';
        content += `\n目前：${active ? `監測 ${describe(active.channelId)}` : '未監測'}；目標：${target ? describe(target) : '未設定'}。`;
      }
    }
    await interaction.editReply({ content, ...(files ? { files } : {}), ...(embeds ? { embeds } : {}), allowedMentions: { parse: [] } });
  } catch (error) {
    // Avoid exposing REST errors, payloads or tokens to a Discord response.
    const safe = error instanceof Error && error.message && /[\u3400-\u9fff]/u.test(error.message)
      ? error.message : '操作失敗，請查看本地連線狀態並稍後重試。';
    await interaction.editReply({ content: safe, allowedMentions: { parse: [] } });
  }
}
