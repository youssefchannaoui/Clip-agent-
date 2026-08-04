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

export function connectionFor(socialConnections, userId, provider) {
  return connectionsFor(socialConnections, userId)[provider] || null;
}

export function setConnection(socialConnections, userId, provider, connection) {
  if (!userId) throw new Error('A social connection needs an owner.');
  if (!socialConnections[userId] || typeof socialConnections[userId] !== 'object') {
    socialConnections[userId] = {};
  }
  socialConnections[userId][provider] = connection;
  return socialConnections;
}

export function removeConnection(socialConnections, userId, provider) {
  const own = socialConnections?.[userId];
  if (!own || !own[provider]) return false;
  delete own[provider];
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
