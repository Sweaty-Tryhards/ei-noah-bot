/* eslint-disable no-param-reassign */
import {
  User as DiscordUser,
  DMChannel,
  OverwriteData,
  Permissions,
  Guild as DiscordGuild,
  Client,
  VoiceChannel,
  DiscordAPIError,
  Role,
  GuildMember,
  TextBasedChannelFields,
  OverwriteResolvable,
  TextChannel,
  CategoryChannel,
  Channel,
  CollectorFilter,
  MessageReaction,
  User,
} from 'discord.js';
import { EntityManager } from '@mikro-orm/core';
import emojiRegex from 'emoji-regex';
import { Category } from '../entity/Category';
import TempChannel from '../entity/TempChannel';
import createMenu from '../createMenu';
import { getCategoryData, getUserGuildData } from '../data';
import { GuildUser } from '../entity/GuildUser';
import { Guild } from '../entity/Guild';
import Router, { GuildHandler, HandlerType } from '../router/Router';

const router = new Router();

enum ChannelType {
  Mute = 'mute',
  Public = 'public',
  Nojoin = 'private'
}

function getIcon(type : ChannelType) {
  if (type === ChannelType.Nojoin) return '🔐';
  if (type === ChannelType.Mute) return '🙊';
  return '🔊';
}

function generateLobbyName(
  type : ChannelType,
  owner : DiscordUser,
  guildUser : GuildUser,
  textChat?: boolean,
) : string {
  const icon = getIcon(type);

  if (type === ChannelType.Public) {
    if (guildUser.tempChannel?.name) {
      const result = emojiRegex().exec(guildUser.tempChannel.name);
      if (result && result[0] === guildUser.tempChannel.name.substr(0, result[0].length)) {
        const [customIcon] = result;

        if (customIcon !== '🔐' && customIcon !== '🙊') {
          const name = guildUser.tempChannel.name
            .substring(result[0].length, guildUser.tempChannel.name.length)
            .trim();

          if (textChat) return `${customIcon}${name} chat`;
          return `${customIcon} ${name}`;
        }
      }
    }
  }

  if (textChat) return `📝${guildUser.tempChannel?.name || `${owner.username}`} chat`;
  return `${icon} ${guildUser.tempChannel?.name || `${owner.username}'s Lobby`}`;
}

function toDeny(type : ChannelType) {
  if (type === ChannelType.Mute) return [Permissions.FLAGS.SPEAK];
  if (type === ChannelType.Nojoin) return [Permissions.FLAGS.CONNECT, Permissions.FLAGS.SPEAK];
  if (type === ChannelType.Public) return [];

  return [];
}

function toDenyText(type : ChannelType) {
  if (type === ChannelType.Mute) return [Permissions.FLAGS.SEND_MESSAGES];
  if (type === ChannelType.Nojoin) return [Permissions.FLAGS.SEND_MESSAGES, Permissions.FLAGS.READ_MESSAGE_HISTORY];
  if (type === ChannelType.Public) return [];

  return [];
}

function getChannelType(channel : VoiceChannel) {
  if (!channel.permissionOverwrites.get(channel.guild.id)?.deny.has('CONNECT')) {
    if (!channel.permissionOverwrites.get(channel.guild.id)?.deny.has('SPEAK')) return ChannelType.Public;
    return ChannelType.Mute;
  } return ChannelType.Nojoin;
}

async function createTempChannel(
  guild: DiscordGuild, parent: string,
  users: Array<DiscordUser | Role>, owner: DiscordUser,
  bitrate: number,
  type: ChannelType,
  userLimit = 0,
  guildUser : GuildUser,
) {
  const userSnowflakes = [...new Set([...users.map((user) => user.id), owner.id])];

  const permissionOverwrites : OverwriteData[] = userSnowflakes.map((id) => ({
    id,
    allow: [Permissions.FLAGS.CONNECT, Permissions.FLAGS.SPEAK],
  }));

  const bot = guild.client.user;

  if (bot !== null) {
    permissionOverwrites.push({
      id: bot.id,
      allow: [
        Permissions.FLAGS.CONNECT,
        Permissions.FLAGS.SPEAK,
        Permissions.FLAGS.MUTE_MEMBERS,
        Permissions.FLAGS.MOVE_MEMBERS,
        Permissions.FLAGS.DEAFEN_MEMBERS,
        Permissions.FLAGS.MANAGE_CHANNELS,
      ],
    });
  }

  permissionOverwrites.push({
    id: owner.id,
    allow: [
      Permissions.FLAGS.CONNECT,
      Permissions.FLAGS.SPEAK,
    ],
  });

  const deny = toDeny(type);

  permissionOverwrites.push({
    id: guild.id,
    deny,
  });

  return guild.channels.create(generateLobbyName(type, owner, guildUser), {
    type: 'voice',
    permissionOverwrites,
    parent,
    bitrate,
    userLimit,
  });
}

async function activeTempChannel(client : Client, em : EntityManager, tempChannel ?: TempChannel) {
  if (!tempChannel) return undefined;
  if (!tempChannel.isInitialized()) await tempChannel.init();

  try {
    const activeChannel = await client.channels.fetch(tempChannel.channelId, false);
    if (activeChannel instanceof VoiceChannel) {
      return activeChannel;
    }
  } catch (err) {
    if (err instanceof DiscordAPIError) {
      if (err.httpStatus === 404) {
        em.remove(tempChannel);
        return undefined;
      }
      throw Error('Unknown Discord API Error');
    }
  }

  return undefined;
}

async function activeTempText(client : Client, tempChannel : TempChannel) {
  if (!tempChannel || !tempChannel.textChannelId) return undefined;

  try {
    const activeChannel = await client.channels.fetch(tempChannel.textChannelId, false);
    if (activeChannel instanceof TextChannel) {
      return activeChannel;
    }
  } catch (err) {
    if (err instanceof DiscordAPIError) {
      if (err.httpStatus === 404) {
        tempChannel.textChannelId = undefined;
        return undefined;
      }
      throw Error('Unknown Discord API Error');
    }
  }

  return undefined;
}

function getTextPermissionOverwrites(voice : VoiceChannel) : OverwriteData[] {
  return voice.permissionOverwrites.map((overwrite) : OverwriteData => {
    if (overwrite.id === voice.guild.id) {
      return {
        id: overwrite.id,
        deny: toDenyText(getChannelType(voice)),
      };
    }

    return {
      allow: [Permissions.FLAGS.SEND_MESSAGES, Permissions.FLAGS.VIEW_CHANNEL, Permissions.FLAGS.ADD_REACTIONS, Permissions.FLAGS.READ_MESSAGE_HISTORY],
      id: overwrite.id,
    };
  });
}

async function createTextChannel(
  client : Client,
  em : EntityManager,
  tempChannel : TempChannel,
  owner : DiscordUser,
) : Promise<TextChannel> {
  const voiceChannel = await activeTempChannel(client, em, tempChannel);
  if (!voiceChannel) throw Error('There is no active temp channel');

  const permissionOverwrites : OverwriteData[] = [
    ...getTextPermissionOverwrites(voiceChannel),
    {
      id: voiceChannel.guild.id,
      deny: toDenyText(getChannelType(voiceChannel)),
    }];

  return voiceChannel.guild.channels.create(
    generateLobbyName(getChannelType(voiceChannel), owner, tempChannel.guildUser, true),
    {
      type: 'text',
      parent: voiceChannel.parent || undefined,
      permissionOverwrites,
      position: voiceChannel.calculatedPosition + 1,
    },
  );
}

function updateTextChannel(voice : VoiceChannel, text : TextChannel) {
  return text.edit({ permissionOverwrites: getTextPermissionOverwrites(voice) });
}

const createCreateChannel = (type : ChannelType, category : CategoryChannel) => {
  const typeName = `${type[0].toUpperCase()}${type.substring(1, type.length)}`;
  return category.guild.channels.create(`${getIcon(type)} Maak ${typeName} Lobby`, {
    type: 'voice',
    parent: category,
  });
};

const getChannel = (client : Client, channelId ?: string) => new Promise<null | Channel>(
  (resolve) => {
    if (channelId === undefined) { resolve(null); return; }
    client.channels.fetch(channelId, true)
      .then((channel) => resolve(channel))
      .catch(() => resolve(null))
      .finally(() => resolve(null));
  },
);

const createCreateChannels = async (category : Category, client : Client) => {
  const actualCategory = await client.channels.fetch(category.id, true);
  if (!(actualCategory instanceof CategoryChannel)) return;

  let publicVoice = await getChannel(client, category.publicVoice);
  if (publicVoice === null) {
    publicVoice = await createCreateChannel(ChannelType.Public, actualCategory);
    category.publicVoice = publicVoice.id;
  }

  let muteVoice = await getChannel(client, category.muteVoice);
  if (muteVoice === null) {
    muteVoice = await createCreateChannel(ChannelType.Mute, actualCategory);
    category.muteVoice = muteVoice.id;
  }

  let privateVoice = await getChannel(client, category.privateVoice);
  if (privateVoice === null) {
    privateVoice = await createCreateChannel(ChannelType.Nojoin, actualCategory);
    category.privateVoice = privateVoice.id;
  }
};

const addUsers = (toAllow : Array<DiscordUser | Role>, activeChannel : VoiceChannel, owner : GuildUser, client : Client) : string => {
  const allowedUsers : Array<DiscordUser | Role> = [];
  const alreadyAllowedUsers : Array<DiscordUser | Role> = [];

  const overwritePromise = toAllow.map((uOrR) => {
    if (activeChannel.permissionOverwrites.some((o) => uOrR.id === o.id)) {
      alreadyAllowedUsers.push(uOrR);
      return null;
    }
    allowedUsers.push(uOrR);

    if (uOrR instanceof DiscordUser) {
        activeChannel.members.get(uOrR.id)?.voice.setMute(false);
    } else {
      activeChannel.members
        .each((member) => { if (uOrR.members.has(member.id)) member.voice.setMute(false); });
    }

    return activeChannel.updateOverwrite(uOrR, {
      CONNECT: true,
      SPEAK: true,
    });
  }).filter((value) : value is Promise<VoiceChannel> => !!value);

  Promise.all(overwritePromise)
    .then(async () => {
      if (owner.tempChannel) {
        const textChannel = await activeTempText(client, owner.tempChannel);
        if (textChannel) { updateTextChannel(activeChannel, textChannel); }
      }
    })
    .catch(() => console.log('Overwrite permission error'));

  let allowedUsersMessage : string;
  if (!allowedUsers.length) allowedUsersMessage = 'Geen user(s) toegevoegd';
  else allowedUsersMessage = `${allowedUsers.map((user) => (user instanceof DiscordUser ? user.username : `${user.name}s`)).join(', ')} ${allowedUsers.length > 1 || allowedUsers.some((user) => user instanceof Role) ? 'mogen' : 'mag'} nu naar binnen`;

  let alreadyInMessage : string;
  if (!alreadyAllowedUsers.length) alreadyInMessage = '';
  else alreadyInMessage = `${alreadyAllowedUsers.map((user) => (user instanceof DiscordUser ? user.username : `${user.name}s`)).join(', ')} ${alreadyAllowedUsers.length > 1 || allowedUsers.some((user) => user instanceof Role) ? 'konden' : 'kon'} al naar binnen`;

  return `${allowedUsersMessage}\n${alreadyInMessage}`;
};

router.use('add', async ({
  params, msg, guildUser, em,
}) => {
  const nonUserOrRole = params
    .filter((param) => !(param instanceof DiscordUser || param instanceof Role));
  const userOrRole = params
    // eslint-disable-next-line max-len
    .filter((param): param is DiscordUser | Role => param instanceof DiscordUser || param instanceof Role);

  if (nonUserOrRole.length > 0) {
    return ('Alleen user mention(s) mogelijk als argument');
  }

  const gu = await guildUser;

  if (!gu.tempChannel?.isInitialized()) await gu.tempChannel?.init();
  const activeChannel = await activeTempChannel(msg.client, em, gu.tempChannel);

  if (!activeChannel || !gu.tempChannel) {
    return 'Je hebt nog geen lobby aangemaakt\nMaak deze aan met `ei lobby create`';
  }

  if (gu.tempChannel.textChannelId !== msg.channel.id) return 'Dit commando kan alleen gegeven worden in het tekstkanaal van deze lobby';

  return addUsers(userOrRole, activeChannel, await guildUser, msg.client);
}, HandlerType.GUILD);

const removeFromLobby = (
  channel : VoiceChannel,
  toRemoveUsers : DiscordUser[],
  toRemoveRoles : Role[],
  textChannel : TextBasedChannelFields,
  channelOwner : DiscordUser,
  tempChannel ?: TempChannel,
) => {
  const usersGivenPermissions : GuildMember[] = [];

  const rolesRemoved : Role[] = [];
  const rolesNotRemoved : Role[] = [];

  const deletePromises : Array<Promise<unknown> | undefined> = [];

  toRemoveRoles.forEach((role) => {
    const roleOverwrite = channel.permissionOverwrites.get(role.id);

    if (roleOverwrite) {
      role.members.forEach((member) => {
        // eslint-disable-next-line max-len
        if (!channel.permissionOverwrites.has(member.id)
        && channel.members.has(member.id)
        && !toRemoveUsers.some((user) => user.id === member.id)) {
          deletePromises.push(channel.updateOverwrite(member.id, { CONNECT: true, SPEAK: true }));
          usersGivenPermissions.push(member);
        }
      });

      deletePromises.push(roleOverwrite.delete());
      rolesRemoved.push(role);
    } else {
      rolesNotRemoved.push(role);
    }
  });

  let triedRemoveSelf = false;
  let triedRemoveEi = false;
  const removedList : DiscordUser[] = [];
  const notRemoved = toRemoveUsers.filter((user) => {
    let removed = false;
    if (user.id === channelOwner.id) triedRemoveSelf = true;
    else if (user.id === channelOwner.client.user?.id) triedRemoveEi = true;
    else {
      const member = channel.members.get(user.id);
      if (member && member.voice.channelID === channel.id) {
        member.voice.setChannel(null);
        removed = true;
      }

      if (channel.permissionOverwrites.has(user.id)) {
        deletePromises.push(channel.permissionOverwrites.get(user.id)?.delete());
        removed = true;
      }

      if (removed) removedList.push(user);
    }

    return !removed;
  });

  let message = '';

  if (usersGivenPermissions.length > 0) {
    message += `Omdat ${usersGivenPermissions.map((user) => user.displayName).join(', ')} ${toRemoveRoles.length > 1 ? 'één of meer van de rollen' : 'de rol'} ${usersGivenPermissions.length > 1 ? 'hadden zijn ze' : 'had is hij'} niet verwijderd.`;
    message += `\nVerwijder ${usersGivenPermissions.length > 1 ? 'hen' : 'hem'} met \`ei lobby remove ${usersGivenPermissions.map((member) => `@${member.user.tag}`).join(' ')}\``;
  }

  if (notRemoved.length > 0) {
    if (triedRemoveSelf) message += '\nJe kan jezelf niet verwijderen';
    if (triedRemoveEi) message += '\nEi Noah is omnipresent';
    else message += `\n${notRemoved.map((user) => user.username).join(', ')} ${notRemoved.length > 1 ? 'konden' : 'kon'} niet verwijderd worden`;
  } else if (removedList.length) {
    message += `\n${removedList.map((user) => user.username).join(', ')} ${removedList.length > 1 ? 'zijn' : 'is'} verwijderd uit de lobby`;
  }

  if (rolesRemoved.length > 0) {
    const roleNames = rolesRemoved.map((role) => role.name);
    message += `\n${roleNames.join(', ')} rol${roleNames.length > 1 ? 'len zijn verwijderd' : ' is verwijderd'}`;
  }

  if (rolesNotRemoved.length > 0) {
    const roleNames = rolesNotRemoved.map((role) => role.name);
    message += `\nRol${rolesNotRemoved.length > 1 ? 'len' : ''} ${roleNames.join(', ')} ${rolesNotRemoved.length > 1 ? 'zijn niet verwijderd' : 'is niet verwijderd'}`;
  }

  Promise.all(deletePromises).then(() => {
    if (tempChannel) {
      const tempText = activeTempText(channel.client, tempChannel);
      tempText.then((text) => { if (text) updateTextChannel(channel, text); });
    }
  });

  if (message === '') {
    textChannel.send('Geen users of roles gegeven');
  } else {
    textChannel.send(message);
  }
};

router.use('remove', async ({
  params, msg, guildUser, em,
}) => {
  const nonUsersOrRoles = params
    .filter((param) => !(param instanceof DiscordUser || param instanceof Role));
  const users = params.filter((param): param is DiscordUser => param instanceof DiscordUser);
  const roles = params.filter((param): param is Role => param instanceof Role);

  if (nonUsersOrRoles.length > 0) {
    return 'Alleen mention(s) mogelijk als argument';
  }

  const gu = await guildUser;
  if (gu.tempChannel?.isInitialized()) await gu.tempChannel.init();

  const activeChannel = await activeTempChannel(msg.client, em, gu.tempChannel);

  if (!activeChannel || !gu.tempChannel) {
    return 'Je hebt nog geen lobby aangemaakt\nMaak één aan met `ei lobby create`';
  }

  if (gu.tempChannel.textChannelId !== msg.channel.id) return 'Dit commando kan alleen gegeven worden in het tekstkanaal van deze lobby';

  if (getChannelType(activeChannel) === ChannelType.Public) {
    return 'Wat snap jij niet aan een **public** lobby smeerjoch';
  }

  if (params.length === 0) {
    const removeAbleRoles = msg.guild.roles.cache.array()
      .filter((role) => activeChannel.permissionOverwrites.has(role.id))
      .filter((role) => role.id !== msg.guild?.id);

    const removeAbleUsers = msg.guild.members.cache.array()
      .filter((member) => {
        if (member.id === msg.author.id) return false;
        if (member.id === msg.client.user?.id) return false;
        if (activeChannel.permissionOverwrites.has(member.id)) return true;
        if (activeChannel.members.has(member.id)) return true;
        return false;
      })
      .map((member) => member.user);

    if (removeAbleUsers.length === 0 && removeAbleRoles.length === 0) {
      return 'Geen gebruikers of roles die verwijderd kunnen worden';
    }

    const selectedUsers = new Set<DiscordUser>();
    const selectedRoles = new Set<Role>();

    createMenu([...removeAbleRoles, ...removeAbleUsers], msg.author, msg.channel, 'Welke user(s) of role(s) wil je verwijderen',
      (item) => {
        if (item instanceof DiscordUser) {
          return `${selectedUsers.has(item) ? '✅' : ''}User: ${item.username}`;
        }

        return `${selectedRoles.has(item) ? '✅' : ''}Role: ${item.name}`;
      },
      (selected) => {
        if (selected instanceof DiscordUser) {
          if (selectedUsers.has(selected)) selectedUsers.delete(selected);
          else selectedUsers.add(selected);
        } else if (selectedRoles.has(selected)) selectedRoles.delete(selected);
        else selectedRoles.add(selected);

        return false;
      },
      ['❌', async () => {
        removeFromLobby(activeChannel,
          Array.from(selectedUsers),
          Array.from(selectedRoles),
          msg.channel,
          msg.author,
          (await guildUser).tempChannel);
      }]);
    return null;
  }

  removeFromLobby(activeChannel, users, roles, msg.channel, msg.author, (await guildUser).tempChannel);
  return null;
}, HandlerType.GUILD);

const changeTypeHandler : GuildHandler = async ({
  params, msg, guildUser, em,
}) => {
  if (msg.channel instanceof DMChannel || msg.guild === null || guildUser === null) {
    return 'Dit commando kan alleen op servers worden gebruikt';
  }
  const lobbyOwner = await guildUser;
  if (lobbyOwner.tempChannel?.isInitialized()) await lobbyOwner.tempChannel.init();

  const activeChannel = await activeTempChannel(msg.client, em, lobbyOwner.tempChannel);

  if (!activeChannel || !lobbyOwner.tempChannel) {
    return 'Je hebt nog geen lobby aangemaakt\nMaak één aan met `ei lobby create`';
  }

  if (lobbyOwner.tempChannel.textChannelId !== msg.channel.id) return 'Dit commando kan alleen gegeven worden in het tekstkanaal van deze lobby';

  if (params.length > 1) {
    return 'Ik verwachte niet meer dan **één** argument';
  }

  const type = getChannelType(activeChannel);

  if (params.length !== 1) {
    if (type === ChannelType.Mute) return `Type van lobby is \`${ChannelType.Mute}\` andere types zijn \`${ChannelType.Public}\` en \`${ChannelType.Nojoin}\``;
    if (type === ChannelType.Nojoin) return `Type van lobby is \`${ChannelType.Nojoin}\` andere types zijn \`${ChannelType.Public}\` en \`${ChannelType.Mute}\``;
    return `Type van lobby is \`${ChannelType.Public}\` andere types zijn \`${ChannelType.Mute}\` en \`${ChannelType.Nojoin}\``;
  } if (params.length === 1) {
    if (typeof params[0] !== 'string') {
      return 'Ik verwachte hier geen **mention**';
    }

    const [changeTo] = <ChannelType[]>params;

    if (!Object.values(ChannelType).includes(changeTo)) {
      return `*${params[0]}* is niet een lobby type`;
    }

    if (changeTo === type) {
      return `Je lobby was al een **${type}** lobby`;
    }

    const deny = toDeny(changeTo);

    const newOverwrites = type === ChannelType.Public ? activeChannel.members
      .filter((member) => !activeChannel.permissionOverwrites.has(member.id))
      .map((member) : OverwriteResolvable => ({ id: member.id, allow: ['SPEAK', 'CONNECT'] })) : [];

    if (type === ChannelType.Mute && changeTo === ChannelType.Public) {
      activeChannel.members
        .filter((member) => !activeChannel.permissionOverwrites.has(member.id))
        .forEach((member) => member.voice.setMute(false));
    } else if (type === ChannelType.Mute && changeTo === ChannelType.Nojoin) {
      activeChannel.members
        .filter((member) => !activeChannel.permissionOverwrites.has(member.id))
        .forEach((member) => {
          member.voice.setChannel(null);
          member.send(`Je bent verwijderd uit *${msg.author.username}'s*, omdat de lobby was veranderd naar ${changeTo} en jij nog geen toestemming had gekregen`);
        });
    }

    activeChannel.overwritePermissions([
      ...activeChannel.permissionOverwrites.array(),
      { id: msg.guild.id, deny },
      ...newOverwrites,
    ]).catch(console.error);

    activeChannel.setName(generateLobbyName(changeTo, msg.author, lobbyOwner))
      .then(async (voice) => {
        const gu = (await guildUser);
        if (gu.tempChannel) {
          activeTempText(msg.client, gu.tempChannel)
            .then(async (textChannel) => {
              if (textChannel) {
                await textChannel.setName(generateLobbyName(changeTo, msg.author, gu, true));
                updateTextChannel(voice, textChannel);
              }
            });
        }
      })
      .catch((err) => console.error('Change name error', err));

    return `Lobby type is veranderd naar *${changeTo}*`;
  }

  return 'Stuur een berichtje naar een ei-noah dev als je dit bericht ziet';
};

router.use('type', changeTypeHandler, HandlerType.GUILD);
router.use('change', changeTypeHandler, HandlerType.GUILD);
router.use('set', changeTypeHandler, HandlerType.GUILD);
router.use('verander', changeTypeHandler, HandlerType.GUILD);

const sizeHandler : GuildHandler = async ({
  msg, guildUser, params, em,
}) => {
  const gu = await guildUser;
  const activeChannel = await activeTempChannel(msg.client, em, gu.tempChannel);

  if (!gu.tempChannel || !activeChannel) {
    return 'Je hebt nog geen lobby aangemaakt\nMaak één aan met `ei lobby create`';
  }

  if (gu.tempChannel.textChannelId !== msg.channel.id) return 'Dit commando kan alleen gegeven worden in het tekstkanaal van deze lobby';

  if (params.length === 0) {
    return 'Geen één (1) argument gegeven';
  }

  if (params.length > 1) {
    return 'Ik verwachte maar één (1) argument';
  }

  const sizeParam = params[0];

  if (typeof sizeParam !== 'string') {
    return 'Lijkt dat op een nummer??';
  }

  let size = Number.parseInt(sizeParam, 10);

  if (sizeParam.toLowerCase() === 'none' || sizeParam.toLowerCase() === 'remove') {
    size = 0;
  }

  if (!Number.isSafeInteger(size)) {
    return 'Even een normaal nummer alstublieft';
  }

  if (size > 99) { size = 99; }
  size = Math.abs(size);

  await activeChannel.setUserLimit(size);

  if (size === 0) { return 'Limiet is verwijderd'; } return `Limiet veranderd naar ${size}`;
};

router.use('size', sizeHandler, HandlerType.GUILD);
router.use('limit', sizeHandler, HandlerType.GUILD);
router.use('userlimit', sizeHandler, HandlerType.GUILD);

router.use('category', async ({
  params, msg, em,
}) => {
  if (params.length !== 2 || typeof params[0] !== 'string' || typeof params[1] !== 'string') {
    return 'Ik verwacht twee argumenten `<lobby-create-categorie id> <nieuwe categorie id om de lobbies in te plaatsen>`';
  }

  if (!msg.member?.hasPermission('ADMINISTRATOR')) {
    return 'Alleen een Edwin mag dit aanpassen';
  }

  const [createCategory, lobbyCategory] = await Promise.all([
    msg.client.channels.fetch(params[0], true).catch(() => null),
    msg.client.channels.fetch(params[1], true).catch(() => null),
  ]);

  if (!(createCategory instanceof CategoryChannel)) return 'Gegeven create-category is niet een categorie';
  if (!(lobbyCategory instanceof CategoryChannel)) return 'Gegeven lobby-category is niet een categorie';

  if (createCategory.guild !== msg.guild) return 'Gegeven create-category van een andere server';
  if (lobbyCategory.guild !== msg.guild) return 'Gegeven lobby-category van een andere server';

  const createCategoryData = getCategoryData(em, createCategory);
  if ((await createCategoryData).lobbyCategory === lobbyCategory.id) {
    (await createCategoryData).lobbyCategory = undefined;
    return `'${lobbyCategory.name}' is niet meer de lobby categorie`;
  }
  (await createCategoryData).lobbyCategory = lobbyCategory.id;

  return `'${lobbyCategory.name}' is nu de lobby categorie`;
}, HandlerType.GUILD);

router.use('create-category', async ({
  params, msg, em,
}) => {
  if (!msg.client.user) throw new Error('msg.client.user not set somehow');

  if (params.length > 1) {
    return 'Ik verwacht maar één argument';
  }

  if (typeof params[0] !== 'string') {
    return 'Ik verwacht een string als argument';
  }

  if (!msg.member?.hasPermission('ADMINISTRATOR')) {
    return 'Alleen een Edwin mag dit aanpassen';
  }

  const category = await msg.client.channels.fetch(params[0], true).catch(() => {});
  if (!(category instanceof CategoryChannel)) return 'Gegeven is geen categorie';

  if (!category.permissionsFor(msg.client.user)?.has('MANAGE_CHANNELS')) {
    return 'Ik heb niet de permission om kanalen aan te maken';
  }

  if (!category.permissionsFor(msg.client.user)?.has('MOVE_MEMBERS')) {
    return 'Ik heb niet de permission om members te verplaatsen';
  }

  const categoryData = await getCategoryData(em, category);
  if (!categoryData) return 'Dit pad is onmogelijk :D';

  if (category.guild !== msg.guild) return 'Gegeven categorie van een andere server';

  if (!categoryData.publicVoice || !categoryData.muteVoice || !categoryData.privateVoice) {
    await createCreateChannels(categoryData, msg.client);

    return `${category.name} is nu een lobby aanmaak categorie`;
  }

  return Promise.all([
    getChannel(msg.client, categoryData.publicVoice).then((channel) => channel?.delete()),
    getChannel(msg.client, categoryData.privateVoice).then((channel) => channel?.delete()),
    getChannel(msg.client, categoryData.muteVoice).then((channel) => channel?.delete()),
  ])
    .then(async () => {
      categoryData.publicVoice = undefined;
      categoryData.privateVoice = undefined;
      categoryData.muteVoice = undefined;

      return `${category.name} is nu geen lobby aanmaak categorie meer`;
    })
    .catch(() => 'Er is iets fout gegaan probeer het later opnieuw');
}, HandlerType.GUILD);

router.use('bitrate', async ({ msg, guildUser, params }) => {
  if (msg.channel instanceof DMChannel || guildUser === null) {
    return 'Je kan dit commando alleen op servers gebruiken';
  }

  if (params.length === 0) {
    if (!(await guildUser).guild.isInitialized()) await (await guildUser).guild.init();
    return `Lobby bitrate is ${(await guildUser).guild.bitrate}`;
  }

  if (params.length > 1) {
    return 'Ik verwacht maar één argument';
  }

  if (typeof params[0] !== 'string') {
    return 'Ik verwacht een string als argument';
  }

  if (!msg.member?.hasPermission('ADMINISTRATOR')) {
    return 'Alleen een Edwin mag dit aanpassen';
  }

  const newBitrate = Number(params[0]);

  if (Number.isNaN(newBitrate)) {
    return `${params[0]} is niet een nummer`;
  }

  if (newBitrate > 128000) {
    return 'Bitrate gaat tot 128000';
  }

  if (newBitrate < 8000) {
    return 'Bitrate gaat boven 8000';
  }

  if (!(await guildUser).guild.isInitialized()) await (await guildUser).guild.init();

  // eslint-disable-next-line no-param-reassign
  (await guildUser).guild.bitrate = newBitrate;

  return `Bitrate veranderd naar ${newBitrate}`;
});

const nameHandler : GuildHandler = async ({
  params, guildUser, msg, em,
}) => {
  const gu = await guildUser;

  if (!(await guildUser).tempChannel?.isInitialized()) await (await guildUser).tempChannel?.init();
  const tempChannel = await activeTempChannel(msg.client, em, gu.tempChannel);

  if (!tempChannel || !gu.tempChannel) return 'Je moet een lobby hebben om dit commando te kunnen gebruiken';
  if (gu.tempChannel.textChannelId !== msg.channel.id) return 'Dit commando kan alleen gegeven worden in het tekstkanaal van deze lobby';

  if (!params.length) return 'Geef een naam in';

  const nameArray = params.filter((param) : param is string => typeof param === 'string');
  if (nameArray.length !== params.length) return 'Je mag alleen tekst gebruiken in de naam';

  const name = nameArray.join(' ');

  if (name.length > 98) return 'De naam mag niet langer zijn dan 98 tekens';

  gu.tempChannel.name = name;
  const type = getChannelType(tempChannel);
  tempChannel.setName(generateLobbyName(type, msg.author, gu));
  activeTempText(msg.client, gu.tempChannel)
    .then((tc) => tc?.setName(generateLobbyName(type, msg.author, gu, true)));

  return 'Lobby naam is aangepast\n> Bij overmatig gebruik kan het meer dan 10 minuten duren';
};

router.use('name', nameHandler, HandlerType.GUILD);
router.use('rename', nameHandler, HandlerType.GUILD);
router.use('naam', nameHandler, HandlerType.GUILD);
router.use('hernoem', nameHandler, HandlerType.GUILD);

const memberCommandText = [
  '`ei lobby add @mention...`: Laat user(s) toe aan de lobby',
  '`ei lobby remove @mention...`: Verwijder user(s)/ role(s) uit de lobby',
  '`ei lobby type [mute / private / public]`: Verander het type van de lobby',
  '`ei lobby limit <nummer>`: Verander de lobby user limit',
  '`ei lobby name <lobby naam>`: Geef de lobby een naam',
].join('\n');

const helpCommandText = [
  '**Maak een tijdelijke voice kanaal aan**',
  'Mogelijke Commandos:',
  memberCommandText,
  '`*Admin* ei lobby category none/<category id>`: Verander de categorie waar de lobbies worden neergezet',
  '`*Admin* ei lobby create-category <category id>`: Maak in gegeven categorie lobby-aanmaak-kanalen aan, verwijder deze kanalen door dezelfde categorie opnieuw te sturen',
  '`*Admin* ei lobby bitrate <8000 - 128000>`: Stel in welke bitrate de lobbies hebben wanneer ze worden aangemaakt',
].join('\n');

const helpHandler = () => helpCommandText;

router.use(null, helpHandler);
router.use('help', helpHandler);

const createAddMessage = async (tempChannel : TempChannel, user : User, client : Client, em : EntityManager) => {
  if (!tempChannel.textChannelId) throw new Error('Text channel not defined');

  const textChannel = await client.channels.fetch(tempChannel.textChannelId, true);
  if (!textChannel || !(textChannel instanceof TextChannel)) throw new Error('Text channel not found');

  const activeChannel = await activeTempChannel(client, em, tempChannel);
  if (!activeChannel) throw new Error('No active temp channel');

  textChannel.send(`Laat ${user.username} toe in de lobby?`).then((msg) => {
    const filter : CollectorFilter = (reaction : MessageReaction, reactor : User) => reactor.id === tempChannel.guildUser.user.id && reaction.emoji.name === '✅';

    const collector = msg.createReactionCollector(filter);
    collector.on('collect', () => {
      msg.delete();
      textChannel.send(addUsers([user], activeChannel, tempChannel.guildUser, client));
    });
    msg.react('✅');
  });
};

const checkTempChannel = async (client : Client, tempChannel: TempChannel,
  em : EntityManager, respectTimeLimit = true) => {
  const now = new Date();

  const difference = Math.abs(now.getMinutes() - tempChannel.createdAt.getMinutes());
  if (!respectTimeLimit || difference >= 2) {
    const activeChannel = await activeTempChannel(client, em, tempChannel);
    const activeTextChannel = await activeTempText(client, tempChannel);

    if (!activeChannel) {
      em.remove(tempChannel);
      console.log('Lobby bestond niet meer');
    } else if (!activeChannel.members.filter((member) => !member.user.bot).size) {
      await activeChannel.delete();

      if (activeTextChannel) await activeTextChannel.delete();
      console.log('Verwijderd: Niemand in lobby');
      em.remove(tempChannel);
    } else if (!activeChannel.members.has(tempChannel.guildUser.user.id)) {
      const guildUsers = await Promise.all(activeChannel.members
        .map((member) => getUserGuildData(em, member.user, activeChannel.guild)));

      const newOwner = activeChannel.members
        .sort(
          (member1, member2) => (member1.joinedTimestamp || 0) - (member2.joinedTimestamp || 0),
        )
        .filter((member) => !guildUsers.find((gu) => gu.user.id === member.id)?.tempChannel)
        .filter((member) => {
          const isPublic = getChannelType(activeChannel) === ChannelType.Public;
          const isAllowedUser = activeChannel.permissionOverwrites.has(member.id);
          const hasAllowedRole = activeChannel.permissionOverwrites
            .some((overwrite) => overwrite.id !== activeChannel.guild.id
            && member.roles.cache.has(overwrite.id));

          return (isPublic || isAllowedUser || hasAllowedRole) && !member.user.bot;
        })
        .first();

      if (newOwner) {
        const newOwnerGuildUser = guildUsers.find((gu) => gu.user.id === newOwner.id);

        if (!newOwnerGuildUser) throw new Error('Guild User Not Found In Array');

        tempChannel.guildUser = newOwnerGuildUser;

        const type = getChannelType(activeChannel);

        await activeChannel.updateOverwrite(newOwner, { SPEAK: true, CONNECT: true })
          .catch(console.error);

        await Promise.all([
          activeChannel.setName(generateLobbyName(type, newOwner.user, newOwnerGuildUser)),
          activeTextChannel?.setName(
            generateLobbyName(type, newOwner.user, newOwnerGuildUser, true)
          ),
          newOwner.voice.setMute(false),
          activeTextChannel?.send(`De lobby is overgedragen aan ${newOwner.displayName}`),
        ]).catch(console.error);

        console.log('Ownership is overgedragen');
      } else { console.log('Owner is weggegaan, maar niemand kwam in aanmerking om de nieuwe leider te worden'); }
    } else {
      const discordUser = await client.users.fetch(tempChannel.guildUser.user.id);
      const lobbyType = getChannelType(activeChannel);

      const correctName = generateLobbyName(lobbyType, discordUser, tempChannel.guildUser);

      if (activeChannel.name !== correctName) {
        await Promise.all([
          activeChannel.setName(correctName),
          activeTextChannel?.setName(generateLobbyName(lobbyType, discordUser, tempChannel.guildUser, true)),
        ]);
      }
    }
  }
};

const checkVoiceCreateChannels = async (em : EntityManager, client : Client) => {
  const categories = await em.find(Category, {
    $or: [
      { publicVoice: { $ne: null } },
      { muteVoice: { $ne: null } },
      { privateVoice: { $ne: null } },
    ],
  });

  await Promise.all(categories.map((category) => createCreateChannels(category, client).catch(() => {})));
};

router.onInit = async (client, orm) => {
  // Check elke tempChannel om de 60 minuten
  const checkTempLobbies = async () => {
    const em = orm.em.fork();

    const usersWithTemp = await em.getRepository(TempChannel).findAll({ populate: { guildUser: true } });

    const tempChecks = usersWithTemp.map((tcs) => checkTempChannel(client, tcs, em));

    await Promise.all(tempChecks).catch(console.error);
    await em.flush().catch(console.error);

    setTimeout(checkTempLobbies, 1000 * 60);
  };

  client.on('voiceStateUpdate', async (oldState, newState) => {
    // Check of iemand een temp lobby heeft verlaten
    if (oldState?.channel && oldState.channel.id !== newState?.channel?.id) {
      const em = orm.em.fork();
      const tempChannel = await em.findOne(TempChannel, {
        channelId: oldState.channel.id,
      }, { populate: { guildUser: true } });
      if (tempChannel) {
        await checkTempChannel(client, tempChannel, em, false);
        await em.flush();
      }
    }

    // Check of iemand een nieuw kanaal is gejoint
    if (newState.channel && newState.channel.parent && oldState.channelID !== newState.channelID) {
      const em = orm.em.fork();

      const categoryData = getCategoryData(em, newState.channel.parent);
      const guildUserPromise = newState.member?.user ? getUserGuildData(em, newState.member.user, newState.guild) : null;

      const user = newState.member?.user;

      const { channel } = newState;

      // Check of iemand een create-lobby channel is gejoint
      if (
        channel
        && guildUserPromise
        && user
        && (
          channel.id === (await categoryData).publicVoice
          || channel.id === (await categoryData).muteVoice
          || channel.id === (await categoryData).privateVoice)) {
        if (!(await guildUserPromise)?.tempChannel?.isInitialized()) await (await guildUserPromise)?.init();
        const activeChannel = await activeTempChannel(client, em, (await guildUserPromise).tempChannel);
        const guildUser = await guildUserPromise;

        if (activeChannel) {
          newState.setChannel(activeChannel);
        } else if (channel.parent) {
          let type : ChannelType = ChannelType.Public;
          if (channel.id === (await categoryData).privateVoice) type = ChannelType.Nojoin;
          if (channel.id === (await categoryData).muteVoice) type = ChannelType.Mute;

          if (!guildUser.guild.isInitialized()) await guildUser.guild.init();

          const createdChannel = await createTempChannel(newState.guild, (await categoryData).lobbyCategory || channel.parent.id, [], user, guildUser.guild.bitrate, type, undefined, guildUser);
          guildUser.tempChannel = new TempChannel(createdChannel.id, guildUser);

          newState.setChannel(createdChannel);

          const textChannel = await createTextChannel(client, em, guildUser.tempChannel, user);
          guildUser.tempChannel.textChannelId = textChannel.id;

          textChannel.send(['**Beheer je lobby met deze commands:**', memberCommandText].join('\n'));
        }
      } else if ( // Check of iemand een tempChannel is gejoint
        user
      && newState.channelID !== oldState.channelID
      ) {
        const tempChannel = await em.findOne(TempChannel, {
          channelId: channel.id,
        }, { populate: ['guildUser', 'guildUser.user'] });

        if (tempChannel) {
          const activeChannel = await activeTempChannel(client, em, tempChannel);

          if (!activeChannel?.permissionsFor(user)?.has(Permissions.FLAGS.SPEAK, true)) {
            await createAddMessage(tempChannel, user, client, em);
          }
        }
      }

      await em.flush();
    }
  });

  checkTempLobbies();

  // LOBBY-CREATE-CATEGORY MIRGRATION
  // TODO DIT WEGHALEN NA DE CUSTOM ROLE UPDATE
  {
    const em = orm.em.fork();

    const guildWithCreateLobbyCategory = await em.find(Guild, {
      $or: [
        { publicVoice: { $ne: null } },
        { muteVoice: { $ne: null } },
        { privateVoice: { $ne: null } },
      ],
    });

    await Promise.all(guildWithCreateLobbyCategory.map(async (guild) => {
      const channelId = guild.publicVoice || guild.muteVoice || guild.privateVoice;

      const channel = await getChannel(client, channelId);

      if (channel instanceof VoiceChannel && channel.parent) {
        const category = await getCategoryData(em, channel.parent);

        category.publicVoice = guild.publicVoice;
        category.muteVoice = guild.muteVoice;
        category.privateVoice = guild.privateVoice;

        category.lobbyCategory = guild.lobbyCategory;
      }
    })).catch(() => {});

    await em.flush();
  }

  const em = orm.em.fork();
  await checkVoiceCreateChannels(em, client);
  await em.flush();
};

export default router;
