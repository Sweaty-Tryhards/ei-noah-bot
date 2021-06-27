import { Migration } from '@mikro-orm/migrations';

export class Migration20210424121631 extends Migration {

  async up(): Promise<void> {
    this.addSql('alter table "guild" add column "role_menu_id" varchar(255) null, add column "default_color" varchar(255) null, add column "requierd_role" varchar(255) null, add column "category" varchar(255) null;');

    this.addSql('create table "custom_role" ("id" varchar(255) not null, "owner_id" int4 not null, "role_name" varchar(255) not null, "max_users" int4 null, "expire_date" timestamptz(0) null, "reaction_icon" varchar(255) not null, "channel_id" varchar(255) null);');
    this.addSql('alter table "custom_role" add constraint "custom_role_pkey" primary key ("id");');

    this.addSql('alter table "custom_role" add constraint "custom_role_owner_id_foreign" foreign key ("owner_id") references "guild_user" ("id") on update cascade;');
  }

}
