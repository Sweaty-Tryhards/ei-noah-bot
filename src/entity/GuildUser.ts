import {
  Entity, ManyToOne, OneToMany, Property, Collection, PrimaryKey, Unique,
} from '@mikro-orm/core';
// eslint-disable-next-line import/no-cycle
import { User } from './User';
// eslint-disable-next-line import/no-cycle
import { Guild } from './Guild';
// eslint-disable-next-line import/no-cycle
import Quote from './Quote';

@Entity()
@Unique({ properties: ['guild', 'user'] })
// eslint-disable-next-line import/prefer-default-export
export class GuildUser {
  @PrimaryKey()
  id!: number;

  @ManyToOne({ eager: true, entity: 'Guild' })
  guild!: Guild;

  @ManyToOne({ eager: true, entity: 'User' })
  user!: User;

  @Property({ nullable: true, unique: true })
  tempChannel?: string;

  @Property()
  tempCreatedAt?: Date;

  @Property({ length: 98 })
  tempName?: string;

  @OneToMany({ entity: () => Quote, mappedBy: 'guildUser' })
  quotes = new Collection<Quote>(this);

  @OneToMany({ entity: () => Quote, mappedBy: 'creator' })
  createdQuotes = new Collection<Quote>(this);
}
