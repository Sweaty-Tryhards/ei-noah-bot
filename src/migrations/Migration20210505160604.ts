import { Migration } from '@mikro-orm/migrations';

export class Migration20210505160604 extends Migration {

  async up(): Promise<void> {
    this.addSql('alter table "guild" rename column "requierd_role" to "required_role";');


    this.addSql('alter table "custom_role" add column "guild_id" varchar(255) not null;');

    this.addSql('alter table "custom_role" add constraint "custom_role_guild_id_foreign" foreign key ("guild_id") references "guild" ("id") on update cascade;');
  }

}
