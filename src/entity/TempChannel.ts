import {
  BaseEntity,
  Entity, OneToOne, PrimaryKey, Property,
} from '@mikro-orm/core';
// eslint-disable-next-line import/no-cycle
import { GuildUser } from './GuildUser';

@Entity()
class TempChannel extends BaseEntity<TempChannel, 'channelId'> {
  constructor(channelId: string, guildUser : GuildUser) {
    super();
    this.channelId = channelId;
    this.guildUser = guildUser;
    this.createdAt = new Date();
  }

  @PrimaryKey()
  channelId!: string;

  @OneToOne({
    entity: 'GuildUser', unique: true, owner: true,
  })
  guildUser!: GuildUser;

  @Property()
  createdAt!: Date;

  @Property({ length: 98 })
  name?: string;

  @Property({ length: 24 })
  textChannelId?: string;
}

export default TempChannel;
