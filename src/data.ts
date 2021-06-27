import { User as DiscordUser, Guild as DiscordGuild, CategoryChannel } from 'discord.js';
import { EntityManager } from '@mikro-orm/core';
import { Category } from './entity/Category';
import { GuildUser } from './entity/GuildUser';
import { User } from './entity/User';
import { Guild } from './entity/Guild';

const getGuildData = async (em : EntityManager, guild : DiscordGuild) : Promise<Guild> => {
  const dbGuild = await em.findOne(Guild, { id: guild.id });

  if (!dbGuild) {
    const newGuild = em.create(Guild, { id: guild.id });

    em.persist(newGuild);

    return newGuild;
  }

  return dbGuild;
};

const getUserData = async (em : EntityManager, user: DiscordUser) : Promise<User> => {
  const dbUser = await em.findOne(User, { id: user.id });

  if (!dbUser) {
    const newUser = em.create(User, { id: user.id });

    em.persist(newUser);

    return newUser;
  }

  return dbUser;
};

const getUserGuildData = async (em : EntityManager, user : DiscordUser, guild : DiscordGuild) => {
  const dbGuildUser = await em.findOne(GuildUser,
    { guild: { id: guild.id }, user: { id: user.id } });

  if (!dbGuildUser) {
    const dbUser = await getUserData(em, user);
    const dbGuild = await getGuildData(em, guild);

    const newGuildUser = em.create(GuildUser, { user: dbUser, guild: dbGuild });

    em.persist(newGuildUser);

    return newGuildUser;
  }

  return dbGuildUser;
};

const getCategoryData = async (em : EntityManager, category : CategoryChannel) => {
  const dbCategory = await em.findOne(Category, { id: category.id });

  if (dbCategory) return dbCategory;

  const newCategory = em.create(Category, { id: category.id });

  em.persist(newCategory);

  return newCategory;
};

export {
  getUserGuildData, getUserData, getGuildData, getCategoryData,
};
