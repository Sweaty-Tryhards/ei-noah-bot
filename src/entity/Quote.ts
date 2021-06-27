import {
  BaseEntity,
  Entity, ManyToOne, PrimaryKey, Property,
} from '@mikro-orm/core';
// eslint-disable-next-line import/no-cycle
import { GuildUser } from './GuildUser';

@Entity()
class Quote extends BaseEntity<Quote, 'id'> {
  @PrimaryKey({ serializedPrimaryKey: true })
  id!: number;

  @ManyToOne({ entity: 'GuildUser' })
  guildUser!: GuildUser;

  @ManyToOne({ entity: 'GuildUser' })
  creator!: GuildUser;

  @Property()
  text!: string;

  @Property()
  date?: Date;

  constructor(text : string, creator: GuildUser) {
    super();
    this.text = text;
    this.creator = creator;
    this.date = new Date();
  }
}

export default Quote;
