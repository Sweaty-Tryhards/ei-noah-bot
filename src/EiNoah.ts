import {
  Client, User as DiscordUser, TextChannel, NewsChannel, Role, Permissions, Guild, Message, DiscordAPIError,
} from 'discord.js';
import {
  Connection, IDatabaseDriver, MikroORM, EntityManager,
} from '@mikro-orm/core';

import { getCategoryData, getUserData, getUserGuildData } from 'data';
import Router, { Handler, RouteInfo } from './Router';

enum ErrorType {
  Uncaught,
  Unhandled,
}

const errorToChannel = async (channelId : string, client : Client, err : Error, type?: ErrorType) => {
  const errorChannel = await client.channels.fetch(channelId);
  if (errorChannel instanceof TextChannel
     || errorChannel instanceof NewsChannel
  ) {
    let header = '';
    if (type === ErrorType.Uncaught) header = '**Uncaught**';
    if (type === ErrorType.Unhandled) header = '**Unhandled**';
    return errorChannel.send(`${header}\n**${err?.name}**\n\`\`\`${err?.stack}\`\`\``, { split: true });
  }

  return null;
};

function mapParams(_mention : string,
  client : Client,
  guild : Guild | null) : Array<Promise<Role | DiscordUser | string | null>> {
  const mention = _mention;

  const seperated = mention.match(/(<@!*[0-9]+>|<@&[0-9]+>|[<]|[^<]+)/g);

  if (seperated) {
    return seperated.map((param) => {
      const user = param.match(/<@!*([0-9]+)>/);
      if (user) return client.users.fetch(user[1], true);

      const role = param.match(/<@&*([0-9]+)>/);
      if (role && guild) return guild.roles.fetch(role[1], true);

      return Promise.resolve(param);
    });
  }

  return [Promise.resolve(null)];
}

function isFlag(argument: string) {
  return argument[0] === '-' && argument.length > 1;
}

async function messageParser(msg : Message, em: EntityManager) {
  if (!msg.content) throw new Error('Message heeft geen content');

  const splitted = msg.content.split(' ').filter((param) => param);

  const flags = splitted.filter(isFlag).map((rawFlag) => rawFlag.substr(1, rawFlag.length - 1));
  const nonFlags = splitted.filter((argument) => !isFlag(argument));

  nonFlags.shift();

  if (nonFlags[0] && nonFlags[0].toLowerCase() === 'noah') nonFlags.shift();

  const parsed : Array<Promise<DiscordUser | Role | string | null>> = [];

  nonFlags.forEach((param) => { parsed.push(...mapParams(param, msg.client, msg.guild)); });

  let resolved;

  try {
    resolved = (await Promise.all(parsed)).filter(((item) : item is DiscordUser | Role => !!item));
  } catch (err) {
    if (err instanceof DiscordAPIError) {
      if (err.httpStatus === 404) throw new Error('Invalid Mention of User, Role or Channel');
      else throw new Error('Unknown Discord Error');
    } else throw new Error('Unknown Parsing error');
  }

  let guildUser;
  if (msg.guild) {
    guildUser = await getUserGuildData(em, msg.author, msg.guild);
  } else guildUser = null;

  let category;
  if (msg.channel instanceof TextChannel || msg.channel instanceof NewsChannel) {
    category = await getCategoryData(em, msg.channel.parent);
  } else category = null;

  let user;
  if (!guildUser) { user = await getUserData(em, msg.author); } else user = guildUser.user;

  const routeInfo : RouteInfo = {
    absoluteParams: resolved,
    params: resolved,
    msg,
    flags,
    guildUser,
    user,
    category,
    em,
  };

  return routeInfo;
}

class EiNoah {
  public readonly client = new Client();

  private readonly router = new Router();

  private readonly token : string;

  private readonly orm : MikroORM<IDatabaseDriver<Connection>>;

  constructor(token : string, orm : MikroORM<IDatabaseDriver<Connection>>) {
    this.token = token;
    this.orm = orm;
  }

  // this.use wordt doorgepaast aan de echte router
  public use(route: typeof DiscordUser, using: Handler) : void
  public use(route: typeof Role, using: Handler) : void
  public use(route: null, using: Handler) : void
  public use(route : string, using: Router | Handler) : void
  public use(route : any, using: any) : any {
    this.router.use(route, using);
  }

  public onInit ?: ((client : Client, orm : MikroORM<IDatabaseDriver<Connection>>)
  => void | Promise<void>);

  public async start() {
    const { orm } = this;

    this.client.on('ready', () => {
      console.log('client online');
    });

    this.client.on('message', (msg) => {
      if (msg.author !== this.client.user && msg.content) {
        const splitted = msg.content.split(' ').filter((param) => param);

        // Raw mention ziet er anders uit wanneer user een nickname heeft
        const botMention = `<@${this.client.user?.id}>`;
        const botNickMention = `<@!${this.client.user?.id}>`;

        let canSendMessage = true;

        if ((msg.channel instanceof TextChannel || msg.channel instanceof NewsChannel) && msg.client.user) {
          if (!msg.channel.permissionsFor(msg.client.user)?.has(Permissions.FLAGS.SEND_MESSAGES)) canSendMessage = false;
        }

        if ((splitted[0] === botMention || splitted[0].toUpperCase() === 'EI' || splitted[0] === botNickMention)) {
          if (!canSendMessage) {
            if (msg.member && msg.member.hasPermission(Permissions.FLAGS.ADMINISTRATOR)) {
              msg.author.send('Ik kan toch niet in dat kanaal praten, doe je fucking werk of ik steek je neer').catch(() => { });
              return;
            }

            msg.author.send('Ik kan niet in dat kanaal reageren, kunnen die kanker admins niet hun werk doen??').catch(() => { });
            return;
          }

          msg.channel.startTyping(10000).catch(() => { });
          const em = orm.em.fork();

          messageParser(msg, em)
            // @ts-ignore
            .then((info) => this.router.handle(info))
            .then((response) => {
              if (response) {
                if (typeof (response) !== 'string') {
                  return msg.channel.send(response).catch(() => { });
                }

                return msg.channel.send(response, { split: true }).catch(() => { });
              }

              return null;
            })
            .finally(() => {
              msg.channel.stopTyping(true);
              return em.flush();
            })
            .catch((err) => {
              // Dit wordt gecallt wanneer de parsing faalt
              if (process.env.NODE_ENV !== 'production') {
                errorToChannel(msg.channel.id, msg.client, err).catch(() => { console.log('Error could not be send :('); });
              } else if (process.env.ERROR_CHANNEL) {
                msg.channel.send('Even normaal doen!').catch(() => {});
                errorToChannel(process.env.ERROR_CHANNEL, msg.client, err).catch(() => { console.log('Stel error kanaal in'); });
              }

              console.error(err);
            });
        }
      }
    });

    this.client.on('rateLimit', () => {
      console.log('We are getting rate limited');
    });

    await this.client.login(this.token);

    this.router.onInit = this.onInit;

    // @ts-ignore
    this.router.initialize(this.client, orm);
    process.on('uncaughtException', async (err) => {
      if (process.env.ERROR_CHANNEL) await errorToChannel(process.env.ERROR_CHANNEL, this.client, err, ErrorType.Uncaught);
    });

    process.on('unhandledRejection', (err) => {
      if (err instanceof Error && process.env.ERROR_CHANNEL) {
        errorToChannel(process.env.ERROR_CHANNEL, this.client, err, ErrorType.Unhandled);
      }
    });
  }
}

export default EiNoah;
