import {
  Client, User as DiscordUser, TextChannel, NewsChannel, Role, Permissions, Guild, Message, DiscordAPIError, Channel,
} from 'discord.js';
import {
  Connection, IDatabaseDriver, MikroORM, EntityManager,
} from '@mikro-orm/core';

import LazyRouteInfo from './router/LazyRouteInfo';
import Router, { BothHandler, RouteInfo } from './router/Router';

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

function mapParams(mention : string,
  client : Client,
  guild : Guild | null) : Array<Promise<Role | DiscordUser | string | Channel>> {
  const seperated : string[] = [];

  const matches = mention.match(/<(@[!&]?|#)[0-9]+>/g);
  if (matches) {
    let index = 0;
    matches.forEach((match) => {
      const found = mention.indexOf(match, index);
      if (found !== index) seperated.push(mention.substring(index, found));
      seperated.push(mention.substr(found, match.length));

      index = found + match.length;
    });
    if (index < mention.length) {
      seperated.push(mention.substring(index, mention.length));
    }
  } else {
    seperated.push(mention);
  }

  return seperated.map((param) => {
    const user = param.match(/<@!?([0-9]+)>/);
    if (user) return client.users.fetch(user[1], true);

    const role = param.match(/<@&([0-9]+)>/);
    if (role && guild) {
      return guild.roles.fetch(role[1], true).then((r) => {
        if (!r) throw new Error('Role not found');

        return r;
      });
    }

    const channel = param.match(/<#([0-9]+)>/);
    if (channel && guild) return client.channels.fetch(channel[1], true);

    return Promise.resolve(param);
  });
}

export async function parseParams(params : string[], client : Client, guild : Guild | null) {
  const parsed : Array<Promise<DiscordUser | Channel | Role | string | null>> = [];

  params.forEach((param) => { parsed.push(...mapParams(param, client, guild)); });

  let resolved;

  try {
    resolved = (await Promise.all(parsed)).filter(((item) : item is DiscordUser | Role | string | Channel => !!item));
  } catch (err) {
    if (err instanceof DiscordAPIError) {
      if (err.httpStatus === 404) throw new Error('Invalid Mention of User, Role or Channel');
      else throw new Error('Unknown Discord Error');
    } else throw new Error('Unknown Parsing error');
  }

  return resolved;
}

function isFlag(argument: string) {
  return argument[0] === '-' && argument.length > 1;
}

async function messageParser(msg : Message, em: EntityManager) {
  if (!msg.content) throw new Error('Message heeft geen content');

  const splitted = msg.content.split(' ').filter((param) => param);

  const flags = new Map<string, Array<Role | DiscordUser | string | Channel>>();
  const params : Array<Role | DiscordUser | string | Channel> = [];

  splitted.shift();

  if (splitted[0] && splitted[0].toLowerCase() === 'noah') splitted.shift();

  const resolved = await parseParams(splitted, msg.client, msg.guild).catch(() => null);

  if (!resolved) return null;

  let flag : string | null = null;
  resolved.forEach((param) => {
    if (typeof param === 'string' && isFlag(param)) {
      flag = param.substr(1, param.length - 1).toLowerCase();
      flags.set(flag, []);
      return;
    }

    if (flag) {
      flags.get(flag)?.push(param);
      return;
    }

    params.push(param);
  });

  const routeInfo : RouteInfo = new LazyRouteInfo({
    params,
    msg,
    flags,
    em,
  });

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
  public use(route: typeof DiscordUser, using: BothHandler) : void
  public use(route: typeof Role, using: BothHandler) : void
  public use(route: null, using: BothHandler) : void
  public use(route : string, using: Router | BothHandler) : void
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

            msg.author.send('Ik kan niet in dat kanaal reageren, kunnen die klote admins niet hun werk doen??').catch(() => { });
            return;
          }

          msg.channel.startTyping().catch(() => { });
          const em = orm.em.fork();

          if (process.env.NODE_ENV !== 'production') console.time(`${msg.id}`);

          messageParser(msg, em)
            .then((info) => {
              if (!info) return 'Ongeldige user(s), role(s) en/of channel(s) gegeven';

              // @ts-ignore
              return this.router.handle(info);
            })
            .then((response) => {
              console.timeEnd(`${msg.id}`);
              if (response) {
                if (typeof (response) !== 'string') {
                  return msg.channel.send(response).catch(() => { });
                }

                return msg.channel.send(response, { split: true }).catch(() => { });
              }

              return null;
            })
            .finally(() => {
              msg.channel.stopTyping();
              return em.flush();
            })
            .catch((err) => {
              console.timeEnd(`${msg.id}`);
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
