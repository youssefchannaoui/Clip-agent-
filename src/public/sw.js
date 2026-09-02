/*
 * The service worker — the half of push notifications that runs when nothing
 * of DeenClipped is open.
 *
 * It deliberately does NOTHING else. No fetch handler, no caching, no offline
 * shell: a caching service worker on an app that ships several times a day is
 * how people end up looking at last week's dashboard with no way to force a
 * refresh, and this file exists to deliver notifications. Adding a fetch
 * handler here is a decision, not a tidy-up.
 */

// A new worker takes over immediately rather than waiting for every tab to
// close. Nothing here holds state, so there is no version to be careful about,
// and a stale worker would go on using an old notification shape.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  // userVisibleOnly means the browser REQUIRES a notification for every push
  // it delivers, and penalises an app that stays silent. So the fallback is a
  // real message rather than a return: the only way to get here with nothing
  // is a push we did not send.
  let data = { title: 'DeenClipped', body: 'Something happened in your studio.', url: '/app', tag: 'deenclipped' };
  try { if (event.data) data = Object.assign(data, event.data.json()); } catch (e) { /* not our payload */ }

  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/apple-touch-icon.png',
    badge: '/apple-touch-icon.png',
    // Same tag replaces rather than stacks: two lectures finishing while the
    // phone is in a pocket should not be two rows to dismiss.
    tag: data.tag,
    renotify: true,
    data: { url: data.url || '/app' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/app';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Focus a tab that already has the app rather than opening a second one.
    // Matching on origin, not on the exact URL: someone sitting on the
    // schedule should be brought to the tab they have, then navigated.
    for (const client of all) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if ('navigate' in client) { try { await client.navigate(target); } catch (e) { /* focus alone is enough */ } }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

/*
 * A push service can retire a subscription on its own (Chrome does this
 * periodically). The browser hands us a fresh one here, and without this
 * handler the device goes silent for ever with nothing anywhere saying so.
 */
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    try {
      const applicationServerKey = event.oldSubscription && event.oldSubscription.options
        ? event.oldSubscription.options.applicationServerKey
        : null;
      if (!applicationServerKey) return;
      const fresh = event.newSubscription || await self.registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey,
      });
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: fresh.toJSON(), replaces: event.oldSubscription ? event.oldSubscription.endpoint : null }),
      });
    } catch (e) { /* nothing useful to do from here */ }
  })());
});
