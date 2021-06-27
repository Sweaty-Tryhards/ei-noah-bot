import {
  Message,
  User as DiscordUser,
  Role, Channel,
  Client,
  MessageOptions,
  StringResolvable,
  MessageAdditions,
  TextChannel,
  NewsChannel,
  DMChannel,
  Guild,
  GuildMember,
} from 'discord.js';
import {
  EntityManager, MikroORM, IDatabaseDriver, Connection,
} from '@mikro-orm/core';
import { Category } from '../entity/Category';
import { GuildUser } from '../entity/GuildUser';
import { User } from '../entity/User';

export interface RouteInfo {
  msg: Message
  absoluteParams: Array<string | DiscordUser | Role | Channel>
  params: Array<string | DiscordUser | Role | Channel>
  flags: Map<string, Array<string | DiscordUser | Role | Channel>>,
  readonly guildUser: Promise<GuildUser> | null,
  readonly user: Promise<User>,
  readonly category: Promise<Category> | null,
  em : EntityManager
}

type BothRouteInfo = (DMRouteInfo | GuildRouteInfo);

export interface DMRouteInfo extends RouteInfo {
  msg: Message & {
    channel: DMChannel
    guild : null
    member : null
  }
  readonly guildUser: null,
  readonly category: null,
}

export interface GuildRouteInfo extends RouteInfo {
  msg: Message & {
    channel: TextChannel | NewsChannel
    guild : Guild
    member : GuildMember
  }
  readonly guildUser: Promise<GuildUser>,
  readonly category: null | Promise<Category>,
}

export type HandlerReturn =
  (MessageOptions & {content: StringResolvable}) | MessageAdditions | string | null;

export enum HandlerType {
  DM = 'dm',
  GUILD = 'guild',
  BOTH = 'both'
}

export interface BothHandler {
  (info: BothRouteInfo) : HandlerReturn | Promise<HandlerReturn>
}

export interface BothHandlerWithIndicator {
  (info: BothRouteInfo) : HandlerReturn | Promise<HandlerReturn>,
  type : HandlerType.BOTH
}

export interface DMHandler {
  (info: DMRouteInfo) : HandlerReturn | Promise<HandlerReturn>,
}

export interface DMHandlerWithIndicator {
  (info: DMRouteInfo) : HandlerReturn | Promise<HandlerReturn>,
  type : HandlerType.DM
}

export interface GuildHandler {
  (info: GuildRouteInfo) : HandlerReturn | Promise<HandlerReturn>
}

export interface GuildHandlerWithIndicator {
  (info: GuildRouteInfo) : HandlerReturn | Promise<HandlerReturn>,
  type : HandlerType.GUILD
}

interface RouteList {
  [path : string]: Router | BothHandlerWithIndicator | DMHandlerWithIndicator | GuildHandlerWithIndicator;
}

export default class Router {
  private routes : RouteList = {};

  private userRoute ?: BothHandlerWithIndicator | DMHandlerWithIndicator | GuildHandlerWithIndicator;

  private nullRoute ?: BothHandlerWithIndicator | DMHandlerWithIndicator | GuildHandlerWithIndicator;

  private roleRoute ?: BothHandlerWithIndicator | DMHandlerWithIndicator | GuildHandlerWithIndicator;

  // Met use geef je aan welk commando waarheen gaat
  public use(route : typeof DiscordUser, using: BothHandler, type ?: HandlerType.BOTH) : void
  public use(route : typeof DiscordUser, using: DMHandler, type : HandlerType.DM) : void
  public use(route : typeof DiscordUser, using: GuildHandler, type : HandlerType.GUILD) : void
  public use(route : typeof Role, using: BothHandler, type ?: HandlerType.BOTH) : void
  public use(route : typeof Role, using: DMHandler, type : HandlerType.DM) : void
  public use(route : typeof Role, using: GuildHandler, type : HandlerType.GUILD) : void
  public use(route : string, using: Router | BothHandler) : void
  public use(route : string, using: BothHandler, type ?: HandlerType.BOTH) : void
  public use(route : string, using: DMHandler, type : HandlerType.DM) : void
  public use(route : string, using: GuildHandler, type : HandlerType.GUILD) : void
  public use(route : null, using : BothHandler, type ?: HandlerType.BOTH) : void
  public use(route : null, using : DMHandler, type : HandlerType.DM) : void
  public use(route : null, using : GuildHandler, type : HandlerType.GUILD) : void
  public use(route : typeof DiscordUser | typeof Role | string | null, using: Router | BothHandler | DMHandler | GuildHandler, type : HandlerType = HandlerType.BOTH) : void {
    const newUsing = <Router | BothHandlerWithIndicator | DMHandlerWithIndicator | GuildHandlerWithIndicator>using;
    if (route === DiscordUser) {
      if (this.userRoute) throw new Error('User route already exists');

      if (newUsing instanceof Router) throw new Error('Can\'t use Router on mention routing');

      newUsing.type = type;
      this.userRoute = newUsing;
    } else if (route === Role) {
      if (this.roleRoute) throw new Error('Role route already exists');

      if (newUsing instanceof Router) throw new Error('Can\'t use Router on mention routing');

      newUsing.type = type;
      this.roleRoute = newUsing;
    } else if (typeof route === 'string') {
      if (this.routes[route]) throw new Error('This Route Already Exists');

      if (!(newUsing instanceof Router)) {
        newUsing.type = type;
      }

      this.routes[route.toUpperCase()] = newUsing;
      this.routes[route.toUpperCase()] = newUsing;
    } else if (route === null) {
      if (this.nullRoute) throw new Error('Role route already exists');
      if (newUsing instanceof Router) throw new Error('Can\'t use Router on null routing');
      newUsing.type = type;
      this.nullRoute = newUsing;
    }
  }

  // INTERNAL
  // Zorgt dat de commando's op de goede plek terecht komen
  protected handle(info: GuildRouteInfo | DMRouteInfo) : Promise<HandlerReturn> {
    return new Promise((resolve, reject) => {
      const currentRoute = info.params[0];

      let handler : Router | BothHandlerWithIndicator | DMHandlerWithIndicator | GuildHandlerWithIndicator | undefined;
      const newInfo = info;

      if (typeof currentRoute !== 'string') {
        if (currentRoute instanceof DiscordUser) {
          handler = this.userRoute;
        } else if (typeof currentRoute === 'undefined') {
          handler = this.nullRoute;
        } else if (currentRoute instanceof Role) {
          handler = this.roleRoute;
        }
      } else {
        const nameHandler = this.routes[currentRoute.toUpperCase()];

        if (nameHandler) {
          const newParams = [...info.params];
          newParams.shift();

          newInfo.params = newParams;
          handler = nameHandler;
        }
      }

      if (handler) {
        if (handler instanceof Router) {
          handler.handle(newInfo).then(resolve).catch(reject);
        } else {
          try {
            let handling : HandlerReturn | Promise<HandlerReturn>;

            if (handler.type === HandlerType.DM) {
              if (newInfo.msg.guild) {
                handling = 'Commando kan alleen in server gebruikt worden';
              } else {
                handling = handler(<DMRouteInfo>newInfo);
              }
            } else if (handler.type === HandlerType.GUILD) {
              if (!newInfo.msg.guild) {
                handling = 'Commando kan alleen in DMs gebruikt worden';
              } else {
                handling = handler(<GuildRouteInfo>newInfo);
              }
            } else {
              handling = handler(newInfo);
            }

            if (handling instanceof Promise) handling.then(resolve).catch(reject);
            else resolve(handling);
          } catch (err) {
            reject(err);
          }
        }
      } else {
        resolve(`Ja ik heb toch geen idee wat \`${info.absoluteParams.map((param) => {
          if (typeof param === 'string') return param;
          if (param instanceof Role) return `@${param.name}`;
          if (param instanceof DiscordUser) return `@${param.username}`;
          return '[UNKNOWN]';
        }).join(' ')}\` moet betekenen`);
      }
    });
  }

  protected initialize(client : Client, orm : MikroORM<IDatabaseDriver<Connection>>) {
    Object.entries(this.routes).forEach(([, route]) => {
      if (route instanceof Router) {
        route.initialize(client, orm);
      }
    });

    if (this.onInit) this.onInit(client, orm);
  }

  public onInit ?: ((client : Client, orm : MikroORM<IDatabaseDriver<Connection>>)
  => void | Promise<void>);
}
