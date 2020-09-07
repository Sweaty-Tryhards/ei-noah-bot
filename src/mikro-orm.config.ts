import {
  Options,
} from 'mikro-orm';

const options : Options = {
  entitiesDirs: ['./src/entity'], // path to your TS entities (source), relative to `baseDir`
  dbName: process.env.DBNAME || 'ei-noah',
  type: 'postgresql', // one of `mongo` | `mysql` | `mariadb` | `postgresql` | `sqlite`
  host: process.env.HOST || 'localhost',
  password: process.env.PASSWORD || undefined,
  user: 'ei-noah',
  migrations: {
    tableName: 'mikro_orm_migrations',
    path: './src/migrations',
    transactional: true,
  },
};

export default options;
