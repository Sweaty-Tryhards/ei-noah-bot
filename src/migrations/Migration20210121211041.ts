import { Migration } from '@mikro-orm/migrations';

export class Migration20210121211041 extends Migration {

  async up(): Promise<void> {
    this.addSql('UPDATE "user" set "birthday" = null WHERE "birthday" > \'today\' OR "birthday" < \'1960-01-01\'');
  }

  async down(): Promise<void> {
    
  }
}
