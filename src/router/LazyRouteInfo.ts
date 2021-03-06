import { EntityManager } from '@mikro-orm/core';
import {
  Channel, CommandInteraction, Message, NewsChannel, Role, TextChannel, User as DiscordUser,
} from 'discord.js';
import { getCategoryData, getUserData, getUserGuildData } from '../data';
import { Category } from '../entity/Category';
import { GuildUser } from '../entity/GuildUser';
import { User } from '../entity/User';
import { RouteInfo } from './Router';

export default class LazyRouteInfo implements RouteInfo {
  public absoluteParams : (string | Channel | DiscordUser | Role)[];

  public params : (string | Channel | DiscordUser | Role)[];

  public msg : Message | CommandInteraction;

  public flags : Map<string, (string | Channel | DiscordUser | Role | boolean | number)[]>;

  public em : EntityManager;

  private lazyGuildUser : undefined | null | Promise<GuildUser>;

  public get guildUser() {
    if (this.lazyUser) {
      throw new Error('Don\'t use both guildUser and user');
    }

    let user : DiscordUser;
    if (this.msg instanceof Message) {
      user = this.msg.author;
    } else user = this.msg.user;

    if (this.lazyGuildUser === undefined) {
      if (!this.msg.guild) {
        this.lazyGuildUser = null;
      } else {
        this.lazyGuildUser = getUserGuildData(this.em, user, this.msg.guild);
      }
    }

    return this.lazyGuildUser;
  }

  private lazyUser : undefined | Promise<User>;

  public get user() {
    if (this.lazyGuildUser === null) {
      throw new Error('Don\'t use both guildUser and user');
    }

    let user : DiscordUser;
    if (this.msg instanceof Message) {
      user = this.msg.author;
    } else user = this.msg.user;

    if (!this.lazyUser) this.lazyUser = getUserData(this.em, user);
    return this.lazyUser;
  }

  private lazyCategory : undefined | null | Promise<Category>;

  public get category() {
    if (this.lazyCategory === undefined) {
      if (((this.msg.channel instanceof TextChannel) || (this.msg.channel instanceof NewsChannel)) && this.msg.channel.parent) {
        this.lazyCategory = getCategoryData(this.em, this.msg.channel.parent);
      } else {
        this.lazyCategory = null;
      }
    }

    return this.lazyCategory;
  }

  constructor({
    params,
    msg,
    flags,
    em,
  } : {
    params : (string | Channel | DiscordUser | Role)[],
    msg : Message | CommandInteraction,
    flags : Map<string, (string | Channel | DiscordUser | Role | boolean | number)[]>
    em : EntityManager
  }) {
    this.absoluteParams = params;
    this.params = params;
    this.flags = flags;
    this.msg = msg;
    this.em = em;
  }
}
