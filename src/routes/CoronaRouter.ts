import fetch from 'node-fetch';
import moment from 'moment';
import { CronJob } from 'cron';
import UserCoronaRegions from '../entity/UserCoronaRegions';
import { User } from '../entity/User';
import Router from '../Router';
import CoronaData, { CoronaInfo } from '../entity/CoronaData';

const router = new Router();

router.use(null, async ({ msg }) => {
  msg.channel.send('a');
});

router.onInit = async (client, orm) => {
  const refreshData = async () => {
    const em = orm.em.fork();

    const inDb = await em.getRepository(CoronaData).findAll();
    const fetchedData = <CoronaInfo[]>(await fetch('https://data.rivm.nl/covid-19/COVID-19_aantallen_gemeente_per_dag.json').then((res) => res.json()));

    const coronaData = fetchedData
      .map((info) => new CoronaData(info))
      .filter((data) => data.community !== null)
      .filter((data) => !inDb
        .some((db) => db.community === data.community
          && db.date.getTime() === data.date.getTime()));

    const duplicatesRemoved : CoronaData[] = [];
    coronaData.forEach((data) => {
      const duplicate = duplicatesRemoved
        .find((item) => item.community === data.community
        && item.date.getTime() === data.date.getTime());

      if (!duplicate) duplicatesRemoved.push(data);
    });

    if (duplicatesRemoved.length > 0) { console.log(`${moment().format('HH:mm')}: ${duplicatesRemoved.length} new corona_data rows`); }

    em.persist(duplicatesRemoved);

    await em.flush();

    setTimeout(() => refreshData, 1000 * 60 * 60 * 3);
  };

  const reportCheck = async () => {
    const em = orm.em.fork();

    const userRegions = await em.getRepository(UserCoronaRegions).findAll();

    const relevantReports = await em
      .find(CoronaData, { community: { $in: userRegions.map((region) => region.region) } });

    const groupedReports : {[key : string]: CoronaData[]} = {};
    relevantReports.forEach((report) => {
      if (groupedReports[report.community.toLowerCase()]) {
        groupedReports[report.community.toLowerCase()].push(report);
      } else groupedReports[report.community.toLowerCase()] = [report];
    });

    interface WeeklyCoronaDataCounted {
      deceased: number
      totalReported: number
      hospitalized: number
    }

    const weeklyCountPerRegion : {[key : string]: WeeklyCoronaDataCounted} = {};

    Object.keys(groupedReports).forEach((key) => {
      groupedReports[key] = groupedReports[key]
        .sort((r1, r2) => 1 / r1.date.getTime() - 1 / r2.date.getTime());

      weeklyCountPerRegion[key] = { deceased: 0, hospitalized: 0, totalReported: 0 };

      for (let i = 0; i < 7; i += 1) {
        const currentReport = groupedReports[key][i];

        weeklyCountPerRegion[key].deceased += currentReport.deceased;
        weeklyCountPerRegion[key].hospitalized += currentReport.hospitalAdmissions;
        weeklyCountPerRegion[key].totalReported += currentReport.totalReported;
      }
    });

    const groupedUsers : {[key : string]: UserCoronaRegions[]} = {};
    userRegions.forEach((userRegion) => {
      if (groupedUsers[userRegion.user.id]) groupedUsers[userRegion.user.id].push(userRegion);
      else groupedUsers[userRegion.user.id] = [userRegion];
    });

    Object.keys(groupedUsers).forEach(async (key) => {
      const regions = groupedUsers[key];

      const reports = regions.map((r) => {
        const weeklyCount = weeklyCountPerRegion[r.region.toLowerCase()];

        return `**${r.region}**:\nNieuwe gevallen: ${weeklyCount.totalReported}\nZiekenhuis Opnames: ${weeklyCount.hospitalized}\nDoden: ${weeklyCount.deceased}`;
      });

      const report = `*Corona cijfers deze week:*\n${reports.join('\n')}`;
      const user = await client.users.fetch(groupedUsers[key][0].user.id, true);
      user.send(report);
    });
  };

  refreshData();

  const reportCron = new CronJob('0 8 * * *', reportCheck);
  reportCron.start();
};

export default router;