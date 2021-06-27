import {
  BaseEntity,
  Entity, ManyToOne, PrimaryKey, Property,
} from '@mikro-orm/core';
// eslint-disable-next-line import/no-cycle
import { User } from './User';

@Entity()
class UserCoronaRegions extends BaseEntity<UserCoronaRegions, 'id'> {
  @PrimaryKey()
  id!: number;

  @ManyToOne({ unique: 'userRegion', entity: 'User' })
  user!: User;

  @Property({ unique: 'userRegion' })
  region!: string;
}

export default UserCoronaRegions;
