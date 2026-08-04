/**
 * Multi-tenancy: keeping every account's work completely separate.
 *
 * This app began as a private single-user tool, so clips, projects, jobs and
 * social connections were all stored in one shared pile. That is fine for one
 * person and unacceptable the moment a second account exists — without
 * ownership, one customer sees another's lectures and, worse, publishes to
 * another's YouTube channel.
 *
 * Everything here exists to make the safe thing the easy thing. Reading a
 * collection without naming an owner is not possible through these helpers,
 * so scoping cannot be forgotten by accident in a route written later.
 *
 * The rule throughout: no owner, no data. A missing or unknown user id
 * returns nothing rather than everything, because the failure mode of
 * "returns everything" is a data leak.
 */

/** Records created before ownership existed are attributed to the owner account. */
export const LEGACY_OWNER_MARKER = null;

/**
 * Every record belonging to one account.
 *
 * Deliberately returns an empty list for a missing user id rather than the
 * whole collection. An unauthenticated request should see nothing at all.
 */
export function ownedBy(collection, userId) {
  if (!Array.isArray(collection) || !userId) return [];
  return collection.filter((record) => record?.userId === userId);
}

/** One record, but only if this account actually owns it. */
export function findOwned(collection, id, userId) {
  if (!Array.isArray(collection) || !id || !userId) return null;
  return collection.find((record) => record?.id === id && record?.userId === userId) || null;
}

/**
 * Whether an account may act on a record.
 *
 * Owners can reach anything, which keeps admin tooling and support workable.
 * Everyone else is confined to their own records.
 */
export function canAccess(record, user) {
  if (!record || !user?.id) return false;
  if (user.role === 'owner') return true;
  return record.userId === user.id;
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
/* Migration                                                            */
/* ------------------------------------------------------------------ */

/**
 * Bring an existing single-tenant database up to multi-tenant safely.
 *
 * Everything that predates ownership is given to the owner account, which is
 * the only defensible choice: that data was created by the person who ran the
 * app privately, and orphaning it would lose their work.
 *
 * Written to be safe to run repeatedly — records that already have an owner
 * are left untouched, so a redeploy cannot reassign anyone's data.
 */
export function migrateToMultiTenant(state, ownerId) {
  if (!state || !ownerId) throw new Error('Migration needs the owner account id.');

  const summary = { projects: 0, clips: 0, rerenderJobs: 0, publishJobs: 0, socialConnections: 0, alreadyMigrated: true };

  for (const key of ['projects', 'clips', 'rerenderJobs', 'publishJobs']) {
    if (!Array.isArray(state[key])) continue;
    for (const record of state[key]) {
      if (record && !record.userId) {
        record.userId = ownerId;
        summary[key] += 1;
        summary.alreadyMigrated = false;
      }
    }
  }

  // Old shape: socialConnections.youtube = {...}
  // New shape: socialConnections[userId].youtube = {...}
  const connections = state.socialConnections;
  if (connections && typeof connections === 'object') {
    const legacyProviders = ['youtube', 'meta', 'tiktok', 'instagram', 'facebook'];
    const moved = {};
    for (const provider of legacyProviders) {
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
  for (const key of ['projects', 'clips', 'rerenderJobs', 'publishJobs']) {
    if (!Array.isArray(state?.[key])) continue;
    for (const record of state[key]) {
      if (record && !record.userId) orphans.push({ collection: key, id: record.id || '(no id)' });
    }
  }
  return orphans;
}
