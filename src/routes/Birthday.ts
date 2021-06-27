import moment from 'moment';
import { CronJob } from 'cron';
import {
  Client,
  MessageAttachment,
  MessageEmbed,
  NewsChannel,
  Permissions, Role, TextChannel,
  User as DiscordUser,
} from 'discord.js';
import { EntityManager } from '@mikro-orm/core';
import { createCanvas, loadImage } from 'canvas';
import { getUserData } from '../data';
import { User } from '../entity/User';
import Router, { BothHandler, GuildHandler, HandlerType } from '../router/Router';

const router = new Router();

const setRouter : BothHandler = async ({ user, params }) => {
  const rawDate = params[0];

  if (typeof (rawDate) !== 'string') {
    if (!(await user).birthday) return 'Voeg je verjaardag toe door DD/MM/YYYY als argument te gegeven';
    return 'Verander je verjaardag door DD/MM/YYYY als argument te geven';
  }

  const args = rawDate.split('/');

  const birth = new Date(parseInt(args[2], 10), parseInt(args[1], 10) - 1, parseInt(args[0], 10));
  const birth1 = moment(birth);

  if (!birth1.isValid()) { return 'Leuk geprobeerd'; }

  if (birth1.isAfter(new Date())) {
    return 'Je geboorte kan niet in de toekomst zijn';
  }

  // eslint-disable-next-line no-param-reassign
  (await user).birthday = birth1.toDate();

  if ((await user).birthday != null) {
    return `Je verjaardag is gewijzigd naar: ${birth1.locale('nl').format('D MMMM YYYY')}`;
  }
  return `Je verjaardag is toegevoegd: ${birth1.locale('nl').format('D MMMM YYYY')}`;
};

router.use('set', setRouter);
router.use('add', setRouter);
router.use('change', setRouter);

const helpHandler : BothHandler = async () => [
  '**Krijg elke ochtend een melding als iemand jarig is**',
  '`ei bday set <DD/MM/YYYY>`: Stel je geboortedatum in',
  '`ei bday show-all`: Laat iedereens geboortedatum zien',
  '`ei bday show-age`: Laat iedereens leeftijd zien',
  '`ei bday <@user>`: Laat de geboortedatum en leeftijd van een user zien',
  '`ei bday delete`: Verwijderd jouw verjaardag',
  '***Admin Commando\'s***',
  '`ei bday channel`: Selecteerd het huidige kanaal voor de dagelijkse update',
  '`ei bday role <Role Mention>`: Selecteerd de rol voor de jarige-jop',
].join('\n');

router.use('help', helpHandler);
router.use(null, helpHandler);

router.use('show-all', async ({ msg, em }) => {
  const users = await em.find(User, { $not: { birthday: null } });

  const discUsers = await Promise.all(users.map((u) => msg.client.users.fetch(u.id, true)));
  const description = discUsers
    .sort((a, b) => {
      let dayA = moment(users.find((u) => u.id === a.id)?.birthday).dayOfYear();
      let dayB = moment(users.find((u) => u.id === b.id)?.birthday).dayOfYear();

      const todayDayOfYear = moment().dayOfYear();

      if (dayA < todayDayOfYear) dayA += 365;
      if (dayB < todayDayOfYear) dayB += 365;

      return dayA - dayB;
    })
    .map((du) => `\n${du.username} is geboren op ${moment(users.find((u) => u.id === du.id)?.birthday).locale('nl').format('D MMMM YYYY')}`);

  let color : string | undefined;
  if (msg.channel instanceof TextChannel || msg.channel instanceof NewsChannel) {
    color = msg.channel.guild.me?.displayHexColor;
  }

  if (!color || color === '#000000') color = '#ffcc5f';

  const embed = new MessageEmbed();
  embed.setColor(color);
  embed.setTitle('Verjaardagen:');

  if (users.length === 0) {
    embed.setDescription('Geen verjaardagen geregistreerd');
    return embed;
  }

  embed.addField('Aankomende eerst', description);

  return embed;
});

const showAgeHandler : BothHandler = async ({ msg, em }) => {
  const users = await em.find(User, { $not: { birthday: null } });

  if (users.length === 0) return 'Geen geboortedatum\'s geregistreerd';

  const discUsers = await Promise.all(users.map((u) => msg.client.users.fetch(u.id, true)));
  const description = discUsers
    .sort((a, b) => {
      const bdayA = users.find((u) => u.id === a.id)?.birthday;
      const bdayB = users.find((u) => u.id === b.id)?.birthday;

      return (bdayA?.valueOf() || 0) - (bdayB?.valueOf() || 0);
    })
    .map((du) => `\n${du.username} is ${-moment(users.find((u) => u.id === du.id)?.birthday).diff(moment(), 'years')}`)
    .join('\n');

  let color : string | undefined;
  if (msg.channel instanceof TextChannel || msg.channel instanceof NewsChannel) {
    color = msg.channel.guild.me?.displayHexColor;
  }

  if (!color || color === '#000000') color = '#ffcc5f';

  const embed = new MessageEmbed();

  embed.setColor(color);
  embed.setTitle('Leeftijden:');

  if (users.length === 0) {
    embed.setDescription('Geen verjaardagen geregistreerd');
    return embed;
  }
  embed.description = description;

  return embed;
};

router.use('show-age', showAgeHandler);
router.use('ages', showAgeHandler);

router.use(DiscordUser, async ({ params, em, msg }) => {
  const user = params[0];

  if (!(user instanceof DiscordUser)) {
    return 'Onmogelijk pad, gefeliciteerd';
  }

  const dbUser = await getUserData(em, user);

  if (!dbUser.birthday) { return `${user.username} heeft geen verjaardag, dit is zo zielig`; }

  const embed = new MessageEmbed();

  let color : string | undefined;
  if (msg.channel instanceof TextChannel || msg.channel instanceof NewsChannel) {
    color = msg.channel.guild.me?.displayHexColor;
  }

  if (!color || color === '#000000') color = '#ffcc5f';

  embed.setColor(color);
  embed.setAuthor(user.username, user.avatarURL() || undefined);
  embed.description = `Geboren op ${moment(dbUser.birthday).format('D MMMM YYYY')} en is ${moment().diff(moment(dbUser.birthday), 'year')} jaar oud`;

  return embed;
});

router.use('delete', async ({ user }) => {
  // eslint-disable-next-line no-param-reassign
  (await user).birthday = undefined;
  return 'Je verjaardag is verwijderd.';
});

const setChannelHandler : GuildHandler = async ({ guildUser, msg }) => {
  if (!msg.member?.hasPermission(Permissions.FLAGS.ADMINISTRATOR)) {
    return 'Alleen een Edwin mag dit aanpassen';
  }

  const guild = await (await guildUser).guild.init();
  const { channel } = msg;

  if (guild.birthdayChannel === channel.id) {
    guild.birthdayChannel = undefined;
    return 'Kanaal niet meer geselecteerd als announcement kanaal';
  }

  guild.birthdayChannel = channel.id;
  return 'Het huidige kanaal is nu geselecteerd als bday announcement kanaal';
};

router.use('set-channel', setChannelHandler, HandlerType.GUILD);
router.use('channel', setChannelHandler, HandlerType.GUILD);

const setRoleHandler : GuildHandler = async ({ guildUser, msg, params }) => {
  if (!msg.member?.hasPermission(Permissions.FLAGS.ADMINISTRATOR)) {
    return 'Alleen een Edwin mag dit aanpassen';
  }

  if (!msg.guild.me?.permissions.has(Permissions.FLAGS.MANAGE_ROLES)) {
    return 'Ik heb geen permissions om iemand een rol te geven';
  }

  const role = params[0];

  const guild = await (await guildUser).guild.init();

  if (role instanceof Role) {
    if (msg.guild && msg.guild.me && msg.guild?.me?.roles.highest.position > role.position) {
      guild.birthdayRole = role.id;
      return 'De role voor deze server is gezet';
    }

    return 'Gegeven rol is hoger dan mijn rol';
  }

  return 'Mention een role';
};

router.use('set-role', setRoleHandler, HandlerType.GUILD);
router.use('role', setRoleHandler, HandlerType.GUILD);

const bdayHatPromise = loadImage('./src/images/bday-hat.png');
const confettiFullPromise = loadImage('./src/images/confetti-full.png');
const confettiCannon = loadImage('./src/images/confetti-cannon.png');
const bdayCake = loadImage('./src/images/bday-cake.png');

const colors = ['#C00000', '#229954', '#1F9ADA', '#9B5CB4', '#EC1C61', '#F4C223', '#E97C26'];

const colorFullText = (ctx : CanvasRenderingContext2D, text : string, _x : number, y : number) => {
  let x = _x;

  ctx.save();
  text.split('').forEach((letter) => {
    const color = colors[Math.floor(Math.random() * colors.length)];
    ctx.fillStyle = color;
    ctx.fillText(letter, x, y);
    x += ctx.measureText(letter).width;
  });
  ctx.restore();
};

const generateImage = async (url : string, age : string) : Promise<MessageAttachment> => {
  const canvas = createCanvas(800, 600);
  const ctx = canvas.getContext('2d');

  const fontSize = 180;

  ctx.font = `${fontSize}px 'Arial Black'`;
  ctx.fillStyle = '#FFFFFF';
  colorFullText(ctx, age, (canvas.width - ctx.measureText(age).width) / 2, fontSize);

  {
    const avatar = await loadImage(url);

    const width = 256;
    const height = width;

    const x = Math.abs(width - canvas.width) / 2;
    const y = Math.abs(height - canvas.height) / 2 + 50;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x + width / 2, y + height / 2, height / 2, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();

    ctx.drawImage(avatar, x, y, width, height);
    ctx.closePath();
    ctx.restore();
  }

  {
    const hat = await bdayHatPromise;

    const scale = 0.7;
    const width = hat.width * scale;
    const height = (hat.height / hat.width) * width;

    ctx.drawImage(hat, 380, 70, width, height);
  }

  {
    const cake = await bdayCake;

    const scale = 0.45;
    const width = cake.width * scale;
    const height = (cake.height / cake.width) * width;

    ctx.drawImage(cake, (canvas.width - width) / 2, canvas.height - height, width, height);
  }

  {
    const cannon = await confettiCannon;

    const scale = 1.1;
    const width = cannon.width * scale;
    const height = (cannon.height / cannon.width) * width;

    const x = -210;
    const y = 200;

    ctx.drawImage(cannon, x, y, width, height);

    ctx.save();

    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(cannon, x, y, width, height);

    ctx.restore();
  }

  {
    const confettiFull = await confettiFullPromise;

    const { width } = canvas;
    const height = (confettiFull.height / confettiFull.width) * width;

    ctx.drawImage(confettiFull, 0, 0, width, height);
  }

  return new MessageAttachment(canvas.createPNGStream());
};

if (process.env.NODE_ENV !== 'production') {
  router.use('generate', ({ params }) => {
    const [user] = params;

    if (!(user instanceof DiscordUser)) return 'Not gaming';
    const url = user.avatarURL({ size: 256, dynamic: false, format: 'png' });
    if (!url) return 'Not url';
    return generateImage(url, '22');
  });
}

// TODO: Deze functie aanpakken
// Bug: Announcement wordt alleen gegeven wanneer de user met ei-noah heeft interact
// Bug: Announcement wordt alleen gegeven wanneer de server een bday-rol had ingesteld (moet niet verplicht zijn)
// Refactor: If in if in if in if in if
// Refactor: Iets meer van async gebruikmaken
const checkBday = async (client : Client, em : EntityManager) => {
  const today = moment().startOf('day').locale('nl').format('DD MMMM');
  const todayAge = moment().startOf('day').locale('nl').format('YYYY');

  const users = await em.find(User, { $not: { birthday: null } }, ['guildUsers', 'guildUsers.guild']);
  const discUsers = await Promise.all(users.map((u) => client.users.fetch(u.id, true)));

  discUsers.forEach(async (du) => {
    const user = users.find((u) => u.id === du.id);
    const discBday = moment(user?.birthday).locale('nl').format('DD MMMM');
    const discBdayAge = moment(user?.birthday).locale('nl').format('YYYY');
    if (today === discBday) {
      const age = parseInt(todayAge, 10) - parseInt(discBdayAge, 10);

      user?.guildUsers.getItems().forEach(async (gu) => {
        if (gu.guild.birthdayChannel) {
          const bdayChannel = await client.channels.fetch(gu.guild.birthdayChannel, true).catch(() => {});
          if (bdayChannel instanceof TextChannel) {
            const bdayRole = await bdayChannel.guild.roles.fetch(gu.guild.birthdayRole, true).catch(() => {});
            if (bdayRole instanceof Role) {
              const member = await bdayChannel.guild.members.fetch({ user: du, cache: true }).catch(() => {});
              if (member && !member.roles.cache.has(bdayRole.id)) {
                member.roles.add(bdayRole).catch(() => console.log('Kon geen rol geven'));

                const url = du.avatarURL({ size: 256, dynamic: false, format: 'png' });
                if (!url) {
                  const embed = new MessageEmbed();

                  let color : string | undefined;
                  color = member.guild.me?.displayHexColor;

                  if (!color || color === '#000000') color = '#ffcc5f';

                  embed.setColor(color);

                  // eslint-disable-next-line max-len
                  embed.setAuthor(member.nickname || member.user.username, member.user.avatarURL() || undefined);
                  embed.description = `Is vandaag ${age} geworden!`;
                  embed.setThumbnail('http://clipart-library.com/images/kcKnBz4Ai.jpg');

                  bdayChannel.send(embed).catch(() => {});
                } else {
                  bdayChannel.send(`Gefeliciteerd met jouw verjaardag ${du}!`, await generateImage(url, age.toString())).catch(() => {});
                }
              }
            }
          }
        }
      });
    } else {
      user?.guildUsers.getItems().forEach(async (gu) => {
        if (gu.guild.birthdayChannel) {
          const bdayChannel = await client.channels.fetch(gu.guild.birthdayChannel, true).catch(() => {});
          if (bdayChannel instanceof TextChannel) {
            const bdayRole = await bdayChannel.guild.roles.fetch(gu.guild.birthdayRole, true).catch(() => {});
            if (bdayRole instanceof Role) {
              const member = await bdayChannel.guild.members.fetch({ user: du, cache: true }).catch(() => {});
              if (member && member.roles.cache.has(bdayRole.id)) member.roles.remove(bdayRole).catch(() => console.log('Kon rol niet verwijderen'));
            }
          }
        }
      });
    }
  });
};

router.onInit = async (client, orm) => {
  const offset = new Date().getTimezoneOffset();
  console.log(`Offset in minutes: ${offset}`);

  const reportCron = new CronJob('5 0 0 * * *', () => { checkBday(client, orm.em.fork()); });

  if (process.env.NODE_ENV !== 'production') {
    checkBday(client, orm.em.fork());
  }

  reportCron.start();
};

export default router;
