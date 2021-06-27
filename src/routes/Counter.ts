import Router, { HandlerType } from '../router/Router';

const router = new Router();

router.use('add', async ({ msg, guildUser }) => {
  // NOOIT parameters direct aanpassen
  // kan undefined behaviour veroorzaken

  const data = await guildUser;
  if (!data.user.isInitialized()) await data.user.init();

  if (!data.user.count) data.user.count = 1;
  else data.user.count += 1;

  return `${msg.author.tag} has counted to ${data.user.count}`;
}, HandlerType.GUILD);

router.use('get', async ({ msg, guildUser }) => {
  if ((await guildUser).user.isInitialized()) await (await guildUser).user.init(true);
  return `${msg.author.tag} is now on ${(await guildUser).user.count}`;
}, HandlerType.GUILD);

export default router;
