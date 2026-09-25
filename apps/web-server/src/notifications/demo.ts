import {
  NotificationEventPublisher,
  NotificationSender,
  type NotificationSendResult,
  resolveNotificationConfig,
} from '@kwtech/module-notification/server';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env.js';
import { PrismaClient } from '../generated/client.js';
import { notificationWriteClient } from '../prisma/module-clients.js';
import { realtimeIsDistributed, realtimePubSub } from '../realtime/realtime.pubsub.js';
import { NOTIFICATION_SOURCES } from './sources.js';

/**
 * `pnpm --filter @kwtech/web-server notify:demo --to=<email>` — fills one
 * person's inbox with every kind of notification, so the bell, the toasts, the
 * pages and the flood rule can be seen working before any real producer exists.
 *
 * ⚠ NOT A SEEDER. Seeders write reference data idempotently and run on every
 * deploy; this writes USER data and must never run anywhere but a local
 * database. The package script refuses any profile but `local`
 * (`env.mjs --require=local`), and this file refuses anything but a
 * development build as a second lock.
 *
 * ⚠ LIVE ONLY WITH REDIS. This is a separate process: with the in-memory engine
 * its publishes reach no socket held by the running server. The rows are
 * written either way — reopen the bell, or reconnect, and the catch-up brings
 * them in. With `REDIS_URL` set the toasts arrive as they are sent.
 */

const FLOOD_BURST = 25;

function argument(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main(): Promise<void> {
  if (env.NODE_ENV !== 'development') throw new Error('notify:demo runs only in a development build.');
  const email = argument('to')?.trim().toLowerCase();
  if (!email) throw new Error('Name the recipient: notify:demo --to=someone@example.com');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  try {
    const user = await prisma.authUser.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new Error(`No account with the email ${email}.`);

    const config = resolveNotificationConfig({ sources: NOTIFICATION_SOURCES, allowHttpLinks: true });
    const sender = new NotificationSender(
      notificationWriteClient(prisma),
      config,
      new NotificationEventPublisher(realtimePubSub()),
    );
    const to = [user.id];
    const results: NotificationSendResult[] = [];
    const send = async (input: Parameters<NotificationSender['send']>[0]) => {
      results.push(await sender.send(input));
    };

    // One of each severity, with every kind of button and every context shape.
    await send({ recipientIds: to, source: 'demo', severity: 'info', title: 'Welcome to notifications' });
    await send({
      recipientIds: to,
      source: 'demo',
      severity: 'success',
      title: 'Your report is ready',
      body: 'The monthly report finished generating.',
      actions: [
        { kind: 'download', key: 'download', label: 'Download', href: '/favicon.ico', filename: 'demo-download.ico' },
      ],
      context: { scope: 'organization', organizationId: 'demo-org', label: 'Demo organization' },
    });
    await send({
      recipientIds: to,
      source: 'demo',
      severity: 'warning',
      title: 'Your plan is almost full',
      body: 'You are using 9 of 10 workspaces.',
      actions: [{ kind: 'link', key: 'open', label: 'See plans', href: '/admin', target: 'self' }],
      context: { scope: 'workspace', organizationId: 'demo-org', workspaceId: 'demo-ws', label: 'Demo · Front desk' },
    });
    await send({
      recipientIds: to,
      source: 'demo',
      severity: 'alert',
      title: 'The queue session stopped unexpectedly',
      body: 'Every display went dark. Start the session again from the console.',
      actions: [{ kind: 'link', key: 'docs', label: 'Read more', href: 'https://example.com', target: 'blank' }],
    });
    await send({
      recipientIds: to,
      source: 'demo',
      title: 'This link has expired',
      actions: [{ kind: 'link', key: 'open', label: 'Open', href: '/', target: 'self' }],
      expiresAt: new Date(Date.now() - 60_000),
    });

    // A group of five: one row, "5 people joined Demo · Front desk".
    for (const name of ['Ana', 'Ben', 'Cy', 'Dee', 'Eli']) {
      await send({
        recipientIds: to,
        source: 'demo',
        title: `${name} joined Demo · Front desk`,
        group: { key: 'demo:joined', title: '{count} people joined Demo · Front desk' },
      });
    }

    // A burst past the flood limit: the surplus folds into ONE overflow row.
    for (let i = 1; i <= FLOOD_BURST; i += 1) {
      await send({ recipientIds: to, source: 'demo', title: `Burst notification ${i}` });
    }

    const written = results.reduce((sum, result) => sum + result.written, 0);
    const overflowed = results.reduce((sum, result) => sum + result.overflowed, 0);
    console.log(
      `Sent ${results.length} notifications to ${email}: ${written} rows written, ${overflowed} folded by the flood rule.`,
    );
    if (!realtimeIsDistributed()) {
      console.log('No REDIS_URL: this process cannot reach the server’s sockets. Reopen the bell to see them.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
