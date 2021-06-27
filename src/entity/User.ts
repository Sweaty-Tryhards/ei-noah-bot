import {
  Entity, PrimaryKey, OneToMany, Property, Collection, BaseEntity,
} from '@mikro-orm/core';
// eslint-disable-next-line import/no-cycle
import { GuildUser } from './GuildUser';
// eslint-disable-next-line import/no-cycle
import UserCoronaRegions from './UserCoronaRegions';

@Entity()
// eslint-disable-next-line import/prefer-default-export
export class User extends BaseEntity<User, 'id'> {
  @PrimaryKey()
  id!: string;

  @OneToMany(() => GuildUser, (gu) => gu.user)
  guildUsers = new Collection<GuildUser>(this);

  @OneToMany(() => UserCoronaRegions, (ucr) => ucr.user)
  coronaRegions = new Collection<UserCoronaRegions>(this);

  @Property()
  count: number = 0;

  @Property()
  birthday?: Date;
}
