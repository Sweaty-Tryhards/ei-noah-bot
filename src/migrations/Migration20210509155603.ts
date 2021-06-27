import { Migration } from '@mikro-orm/migrations';

export class Migration20210509155603 extends Migration {

  async up(): Promise<void> {
    this.addSql('alter table "category" add column "public_voice" varchar(255) null, add column "mute_voice" varchar(255) null, add column "private_voice" varchar(255) null, add column "lobby_category" varchar(255) null;');
    this.addSql('alter table "category" drop column "is_lobby_category";');
  }

}
