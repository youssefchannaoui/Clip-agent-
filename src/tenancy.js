/**
 * Multi-tenancy: keeping every account's work completely separate.
 *
 * This app began as a private single-user tool, so clips, projects, jobs,
 * settings and social connections were all stored in one shared pile. That is
 * fine for one person and unacceptable the moment a second account exists —
 * without ownership, one customer sees another's lectures and, worse,
 * publishes to another's YouTube channel.
 *
 * Everything here exists to make the safe thing the easy thing. Reading a
 * collection without naming an owner is not possible through these helpers,
 * so scoping cannot be forgotten by accident in a route written later.
 *
 * The rule throughout: no owner, no data. A missing or unknown user id
 * returns nothing rather than everything, because the failure mode of
 * "returns everything" is a data leak.
 *
 * ---------------------------------------------------------------------------
 * A note on the ownership field
 *
 * Two conventions existed in this codebase at once: `ownerId`, written by the
 * engine and the old auth bootstrap, and `userId`, used by billing events and
 * sessions. Two names for one concept is how scoping bugs get written, so
 * `userId` is now the single canonical field. `ownerId` is read only as a
 * legacy fallback and is removed by the migration below.
 */

/** The account a record belongs to, tolerating the legacy `ownerId` field. */
export function ownerOf(record) {
  if (!record || typeof record !== 'object') return null;
  return record.userId || record.ownerId || null;
}

/**
 * Every record belonging to one account.
 *
 * Deliberately returns an empty list for a missing user id rather than the
 * whole collection. An unauthenticated request should see nothing at all.
 */
export function ownedBy(collection, userId) {
  if (!Array.isArray(collection) || !userId) return [];
  return collection.filter((record) => ownerOf(record) === userId);
}

/** One record, but only if this account actually owns it. */
export function findOwned(collection, id, userId) {
  if (!Array.isArray(collection) || !id || !userId) return null;
  return collection.find((record) => record?.id === id && ownerOf(record) === userId) || null;
}

/**
 * Whether an account may act on a record.
 *
 * Owners can reach anything, which keeps admin tooling and support workable.
 * Everyone else is confined to their own records.
 *
 * Note that the routes use the strict `ownedBy` / `findOwned` helpers rather
 * than this, so the operator does not see paying customers' clips in their own
 * dashboard by accident. This override exists for deliberate support tooling.
 */
export function canAccess(record, user) {
  if (!record || !user?.id) return false;
  if (user.role === 'owner') return true;
  return ownerOf(record) === user.id;
}

/**
 * Throw unless this account owns the record.
 *
 * The message deliberately does not distinguish "does not exist" from
 * "belongs to someone else" — telling a stranger that a particular id exists
 * is itself a small leak.
 */
export function assertOwned(record, user, label = 'item') {
  if (!canAccess(record, user)) {
    const error = new Error(`That ${label} was not found.`);
    error.statusCode = 404;
    throw error;
  }
  return record;
}

/** Stamp ownership on a new record. */
export function withOwner(record, userId) {
  if (!userId) throw new Error('A record cannot be created without an owner.');
  return { ...record, userId };
}

/* ------------------------------------------------------------------ */
/* Social connections                                                   */
/* ------------------------------------------------------------------ */

/**
 * Social connections are keyed by account, then by platform:
 *
 *     socialConnections[userId][provider]
 *
 * Previously this was a single flat `socialConnections[provider]`, which meant
 * whoever connected first received everybody's uploads.
 */
export function connectionsFor(socialConnections, userId) {
  if (!socialConnections || !userId) return {};
  const own = socialConnections[userId];
  return own && typeof own === 'object' ? own : {};
}

/**
 * Every connection a user holds on one platform.
 *
 * The slot was a single object for the app's whole life, and every record on
 * disk still holds one. It may now hold an ARRAY instead -- several YouTube
 * channels, several TikToks -- and the shape is normalised here on read rather
 * than by a migration pass, so a bare object is simply a list of one.
 *
 * Meta is the exception and stays a single object: one Facebook login already
 * carries its Pages in `accounts`, so wrapping it in a list would give the same
 * credential two levels of plurality.
 */
export function connectionListFor(socialConnections, userId, provider) {
  const value = connectionsFor(socialConnections, userId)[provider];
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).filter(Boolean);
}

/**
 * The PRIMARY connection -- the first one.
 *
 * Deliberately kept, and deliberately still the first: about twenty call sites
 * read "the user's YouTube" for things that are not per-destination (is
 * anything connected at all, when was this platform last tested). Anything that
 * publishes must use connectionByAccount instead, or it will happily post a
 * clip aimed at the second channel using the first channel's token.
 */
export function connectionFor(socialConnections, userId, provider) {
  return connectionListFor(socialConnections, userId, provider)[0] || null;
}

/** The connection for ONE account, which is what a publish must resolve. */
export function connectionByAccount(socialConnections, userId, provider, accountId = '') {
  const list = connectionListFor(socialConnections, userId, provider);
  if (!accountId) return list[0] || null;
  return list.find(item => String(item?.accountId || '') === String(accountId)) || null;
}

/** Replaces everything stored for this platform with one connection. */
export function setConnection(socialConnections, userId, provider, connection) {
  if (!userId) throw new Error('A social connection needs an owner.');
  if (!socialConnections[userId] || typeof socialConnections[userId] !== 'object') {
    socialConnections[userId] = {};
  }
  socialConnections[userId][provider] = connection;
  return socialConnections;
}

/**
 * Add a connection alongside the ones already there.
 *
 * Reconnecting the SAME account replaces it in place, keeping its position --
 * that is what "Reconnect" means, and appending instead would leave a dead
 * credential for the same channel sitting in the list.
 *
 * `max` is the caller's tier limit. Beyond it this throws rather than dropping
 * the oldest: silently evicting a channel someone is publishing to, because
 * they connected a fourth, is not a decision this function gets to make. The
 * one exception is a limit of ONE, where connecting is how an account has
 * always switched channels and there is no second slot to preserve.
 */
export function addConnection(socialConnections, userId, provider, connection, { max = 1 } = {}) {
  if (!userId) throw new Error('A social connection needs an owner.');
  if (!socialConnections[userId] || typeof socialConnections[userId] !== 'object') {
    socialConnections[userId] = {};
  }
  const list = connectionListFor(socialConnections, userId, provider);
  const limit = Math.max(1, max);
  const id = String(connection?.accountId || '');
  const at = id ? list.findIndex(item => String(item?.accountId || '') === id) : (list.length ? 0 : -1);
  if (at > -1) list[at] = connection;
  // At a limit of one, connecting has always MEANT switching: there is no
  // second slot to keep the old credential in, and refusing here would leave a
  // Pro account unable to change channel without finding Disconnect first.
  // Accumulation, and the refusal that goes with it, only applies where the
  // plan actually permits more than one.
  else if (limit === 1) list.splice(0, list.length, connection);
  else if (list.length >= limit) {
    throw new Error(`This plan connects ${limit} ${provider} accounts. Disconnect one first.`);
  } else list.push(connection);
  socialConnections[userId][provider] = list;
  return socialConnections;
}

/**
 * Remove one account's connection, or the whole platform when none is named.
 *
 * Naming an account matters now: "Disconnect" on the third YouTube channel must
 * not take the other two with it.
 */
export function removeConnection(socialConnections, userId, provider, accountId = '') {
  const own = socialConnections?.[userId];
  if (!own || !own[provider]) return false;
  if (!accountId) { delete own[provider]; return true; }
  const list = connectionListFor(socialConnections, userId, provider);
  const left = list.filter(item => String(item?.accountId || '') !== String(accountId));
  if (left.length === list.length) return false;
  if (left.length) own[provider] = left;
  else delete own[provider];
  return true;
}

/* ------------------------------------------------------------------ */
/* Per-user settings                                                    */
/* ------------------------------------------------------------------ */

/**
 * Clip length, music, automation, publishing and the selected template were
 * all single global values. One customer lowering their clip count changed it
 * for everybody, and one customer enabling publishing enabled it for everybody.
 *
 * These live under `state.userSettings[userId]`.
 */
export function userSettings(state, userId) {
  if (!state || !userId) return {};
  if (!state.userSettings || typeof state.userSettings !== 'object') state.userSettings = {};
  if (!state.userSettings[userId] || typeof state.userSettings[userId] !== 'object') {
    state.userSettings[userId] = {};
  }
  return state.userSettings[userId];
}

export function readUserSetting(state, userId, key) {
  if (!state?.userSettings || !userId) return undefined;
  const own = state.userSettings[userId];
  return own && typeof own === 'object' ? own[key] : undefined;
}

export function writeUserSetting(state, userId, key, value) {
  userSettings(state, userId)[key] = value;
  return value;
}

/* ------------------------------------------------------------------ */
/* Migration                                                            */
/* ------------------------------------------------------------------ */

const OWNED_COLLECTIONS = ['projects', 'clips', 'rerenderJobs', 'publishJobs'];
const LEGACY_PROVIDERS = ['youtube', 'meta', 'tiktok', 'instagram', 'facebook'];

/** Settings that used to be global and are now held per account. */
const GLOBAL_SETTING_KEYS = [
  'clipSettings', 'musicSettings', 'automationSettings',
  'publishingSettings', 'selectedTemplateId',
];

/**
 * Bring an existing single-tenant database up to multi-tenant safely.
 *
 * Records that already name an owner — under either the canonical `userId` or
 * the legacy `ownerId` — keep that owner. Only genuinely unowned records, the
 * ones created before ownership existed at all, are given to the owner
 * account. That is the only defensible choice for them: they were created by
 * the person who ran the app privately, and orphaning them would lose their
 * work.
 *
 * Honouring `ownerId` first matters more than it looks. Assigning every record
 * without a `userId` to the owner account would have quietly handed every
 * other customer's clips to the operator, because the engine had been writing
 * `ownerId` all along.
 *
 * Written to be safe to run repeatedly — records that already have an owner
 * are left untouched, so a redeploy cannot reassign anyone's data.
 */
export function migrateToMultiTenant(state, ownerId) {
  if (!state || !ownerId) throw new Error('Migration needs the owner account id.');

  const summary = {
    projects: 0, clips: 0, rerenderJobs: 0, publishJobs: 0,
    socialConnections: 0, settings: 0, adopted: 0, alreadyMigrated: true,
  };

  for (const key of OWNED_COLLECTIONS) {
    if (!Array.isArray(state[key])) continue;
    for (const record of state[key]) {
      if (!record || typeof record !== 'object') continue;

      if (!record.userId) {
        if (record.ownerId) {
          // Written by the engine before `userId` was canonical. Keep the
          // real owner rather than handing their work to the operator.
          record.userId = record.ownerId;
          summary.adopted += 1;
        } else {
          record.userId = ownerId;
          summary[key] += 1;
        }
        summary.alreadyMigrated = false;
      }

      if (record.ownerId) {
        delete record.ownerId;
        summary.alreadyMigrated = false;
      }
    }
  }

  // Old shape: socialConnections.youtube = {...}
  // New shape: socialConnections[userId].youtube = {...}
  const connections = state.socialConnections;
  if (connections && typeof connections === 'object') {
    const moved = {};
    for (const provider of LEGACY_PROVIDERS) {
      if (connections[provider] && connections[provider].provider) {
        moved[provider] = connections[provider];
        delete connections[provider];
        summary.socialConnections += 1;
        summary.alreadyMigrated = false;
      }
    }
    if (Object.keys(moved).length) {
      connections[ownerId] = { ...(connections[ownerId] || {}), ...moved };
    }
  }

  // Global settings become the owner's settings. Everyone else starts from
  // the defaults rather than inheriting a stranger's configuration.
  const existing = state.userSettings?.[ownerId];
  for (const key of GLOBAL_SETTING_KEYS) {
    if (state[key] == null) continue;
    if (existing && existing[key] != null) continue;
    writeUserSetting(state, ownerId, key, state[key]);
    delete state[key];
    summary.settings += 1;
    summary.alreadyMigrated = false;
  }

  return summary;
}

/**
 * Check that no record escaped the migration.
 *
 * Worth running after migrating and in tests: an unowned record is invisible
 * to its rightful owner and could surface to the wrong account through any
 * query that forgets to scope.
 */
export function findUnownedRecords(state) {
  const orphans = [];
  for (const key of OWNED_COLLECTIONS) {
    if (!Array.isArray(state?.[key])) continue;
    for (const record of state[key]) {
      if (record && !ownerOf(record)) orphans.push({ collection: key, id: record.id || '(no id)' });
    }
  }
  return orphans;
}
