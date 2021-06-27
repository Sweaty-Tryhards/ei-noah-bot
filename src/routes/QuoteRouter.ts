import {
  Channel,
  Client,
  MessageEmbed, NewsChannel, Permissions, Role, TextBasedChannelFields, TextChannel, User as DiscordUser, Util,
} from 'discord.js';
import { GuildUser } from 'entity/GuildUser';
import { parseParams } from '../EiNoah';
import createMenu from '../createMenu';
import Quote from '../entity/Quote';
import { getUserGuildData } from '../data';
import Router, { GuildHandler, HandlerType } from '../router/Router';

const router = new Router();

const getQuoteEmbed = async (channel : TextBasedChannelFields, quote : Quote, client : Client) : Promise<MessageEmbed> => {
  await Promise.all([(() => {
    if (!quote.guildUser.isInitialized()) return quote.guildUser.init();

    return quote.guildUser;
  })(), (() => {
    if (!quote.creator.isInitialized()) return quote.creator.init();

    return quote.creator;
  })()]);

  const quoted = client.users.fetch(quote.guildUser.user.id, true);
  const owner = client.users.fetch(quote.creator.user.id, true);

  const text = quote.text.replace('`', '\\`');

  const embed = new MessageEmbed();

  const avatarURL = (await quoted).avatarURL() || undefined;
  let color : number | undefined;
  if (channel instanceof TextChannel) color = channel.guild.me?.displayColor;

  embed.setAuthor((await quoted).username, avatarURL);
  embed.setDescription(text);
  embed.setFooter(`Door ${(await owner).username}`, (await owner).avatarURL() || undefined);
  if (quote.date) embed.setTimestamp(quote.date);
  if (color) embed.setColor(color);

  return embed;
};

const addQuote = (params : (string | DiscordUser | Channel | Role)[], quotedUser : GuildUser, owner : GuildUser) => {
  const text = Util.removeMentions(params.map((param) => {
    if (typeof param === 'string') return param;
    if (param instanceof DiscordUser) return param.username;
    if (param instanceof Role) return param.name;
    if (param instanceof TextChannel || param instanceof NewsChannel) return param.name;
    return '[UNKNOWN]';
  }).join(' '));

  if (text.length > 256) {
    return 'Quotes kunnen niet langer zijn dan 256 karakters';
  }

  const quote = new Quote(text, owner);
  quotedUser.quotes.add(quote);

  return quote;
};

const handler : GuildHandler = async ({
  params, msg, em, guildUser,
}) => {
  if (!(params[0] instanceof DiscordUser)) {
    return 'Ok, dat is niet een persoon, mention iemand';
  }

  const user = params[0];
  params.shift();

  let quotedUser : GuildUser;
  if (msg.author.id === user.id) quotedUser = await guildUser;
  else quotedUser = await getUserGuildData(em, user, msg.guild);

  if (!quotedUser.quotes.isInitialized()) { await quotedUser.quotes.init(); }

  if (params.length === 0) {
    if (quotedUser.quotes.length === 0) {
      return `${user.username} is niet populair en heeft nog geen quotes`;
    }

    if (quotedUser.quotes.length === 1) {
      return getQuoteEmbed(msg.channel, quotedUser.quotes[0], msg.client);
    }

    createMenu(quotedUser.quotes.getItems(),
      msg.author,
      msg.channel,
      '**Kiest U Maar**',
      (q) => q.text,
      async (q) => {
        msg.channel.send(await getQuoteEmbed(msg.channel, q, msg.client)).catch(() => { });
      });
    return null;
  }

  const quote = addQuote(params, quotedUser, await guildUser);
  if (typeof quote === 'string') return quote;

  return getQuoteEmbed(msg.channel, quote, msg.client);
};

router.use(DiscordUser, handler, HandlerType.GUILD);
router.use('add', handler, HandlerType.GUILD);
router.use('toevoegen', handler, HandlerType.GUILD);

const removeHandler : GuildHandler = async ({
  msg, em, params, guildUser,
}) => {
  if (params.length < 1) {
    return 'Verwijder quotes van wie?';
  }

  if (params.length > 1) {
    return 'Alleen de gebruiker graag';
  }

  if (!(params[0] instanceof DiscordUser)) {
    return 'Hoe moeilijk is het om daar een mention neer te zetten?';
  }

  const guToRemoveFrom = msg.author.id === params[0].id ? (await guildUser) : await getUserGuildData(em, params[0], msg.guild);

  // Als iemand zijn eigen quotes ophaalt laat hij alles zien (of als degene admin is)
  // Anders laad alleen de quotes waar hij de creator van is
  const constraint = guToRemoveFrom.user.id === msg.author.id || msg.member?.hasPermission(Permissions.FLAGS.ADMINISTRATOR)
    ? undefined : { where: { creator: await guildUser } };

  if (!guToRemoveFrom.quotes.isInitialized()) { await guToRemoveFrom.quotes.init(constraint); }

  const quotes = guToRemoveFrom.quotes.getItems();

  if (quotes.length < 1) {
    return 'Jij hebt geen quotes aangemaakt voor deze user';
  }

  const quotesToRemove : Set<Quote> = new Set<Quote>();

  const menuEm = em.fork();

  createMenu(quotes,
    msg.author,
    msg.channel,
    '**Selecteer welke quote(s) je wil verwijderen**',
    (q) => `${quotesToRemove.has(q) ? '✅' : ''}${q.text}`,
    (q) => {
      if (quotesToRemove.has(q)) quotesToRemove.delete(q);
      else quotesToRemove.add(q);
      return false;
    },
    ['❌', () => {
      quotesToRemove.forEach((q) => { menuEm.remove(q); });
      if (quotesToRemove.size > 0) msg.channel.send(`${quotesToRemove.size} quote${quotesToRemove.size !== 1 ? 's' : ''} verwijderd`);
      else msg.channel.send('Geen quote(s) verwijderd');
      menuEm.flush();
      return true;
    }]);

  return null;
};

router.use('remove', removeHandler, HandlerType.GUILD);
router.use('delete', removeHandler, HandlerType.GUILD);
router.use('verwijder', removeHandler, HandlerType.GUILD);
router.use('verwijderen', removeHandler, HandlerType.GUILD);
router.use('manage', removeHandler, HandlerType.GUILD);

router.use(null, async ({ msg, em, guildUser }) => {
  if (msg.reference?.messageID) {
    const toQuote = await msg.channel.messages.fetch(msg.reference.messageID, true).catch(() => null);
    if (!toQuote) return 'Ik heb hard gezocht, maar kon het gegeven bericht is niet vinden';
    if (!toQuote.content) return 'Bericht heeft geen inhoud';

    const quotedUser = toQuote.author.id === msg.author.id ? await guildUser : await getUserGuildData(em, toQuote.author, msg.guild);

    const splitted = toQuote.content.split(' ').filter((param) => param);

    const resolved = await parseParams(splitted, msg.client, msg.guild);

    const quote = addQuote(resolved, quotedUser, await guildUser);
    if (typeof quote === 'string') return quote;

    quote.date = new Date(toQuote.createdTimestamp);

    return getQuoteEmbed(msg.channel, quote, msg.client);
  }

  const quotes = await em.find(Quote, { guildUser: { guild: { id: msg.guild.id } } }, { populate: { guildUser: true, creator: true } });

  const quote = quotes[Math.floor(Math.random() * quotes.length)];

  if (quote) {
    return getQuoteEmbed(msg.channel, quote, msg.client);
  }

  return 'Deze server heeft nog geen quotes';
}, HandlerType.GUILD);

router.use('help', () => [
  '**Hou quotes van je makkermaten bij!**',
  'Mogelijke Commandos:',
  '`ei quote`: Verstuur een random quote',
  '`ei quote <@member>`: Verstuur een quote van dat persoon',
  '`ei quote <@member> <quote>`: Sla een nieuwe quote op van dat persoon',
  '`ei quote remove <@member>`: Verwijder een selectie aan quotes van dat persoon',
  '> Je kan alleen de quotes verwijderen die je voor dat persoon geschreven hebt',
  '> Alleen quotes van jezelf kan je volledig beheren',
].join('\n'));

export default router;
