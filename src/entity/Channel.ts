import {
  PrimaryKey, Entity, PrimaryKeyType, BaseEntity,
} from '@mikro-orm/core';

@Entity()
// eslint-disable-next-line import/prefer-default-export
export class Channel extends BaseEntity<Channel, 'id'> {
  @PrimaryKey()
  id!: string;

  [PrimaryKeyType]: [string];
}
