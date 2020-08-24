import {
  Entity, PrimaryColumn, Column,
} from 'typeorm';

@Entity()
// eslint-disable-next-line import/prefer-default-export
export class Category {
  @PrimaryColumn()
  id: string;

  @Column({ default: true })
  isLobbyCategory: boolean;
}
