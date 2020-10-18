import {
  Options,
} from 'mikro-orm';
import dotenv from 'dotenv';

dotenv.config();

const options : Options = {
  entitiesDirs: ['./dist/data/entity'], // path to your TS entities (source), relative to `baseDir`
  entitiesDirsTs: ['./data/entity'],
  dbName: process.env.DBNAME || 'ei-noah',
  type: 'postgresql', // one of `mongo` | `mysql` | `mariadb` | `postgresql` | `sqlite`
  host: process.env.HOST || 'localhost',
  password: process.env.PASSWORD || undefined,
  user: 'ei-noah',
  migrations: {
    tableName: 'mikro_orm_migrations',
    path: './data/migrations',
    transactional: true,
  },
  debug: process.env.DEBUG === 'true',
};

export default options;