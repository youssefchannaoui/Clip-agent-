import { state } from './store.js';
import { publicBilling } from './billing.js';

const now = () => Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

function requireOperator(user) {
  if (!user || !['owner', 'admin'].includes(String(user.role || '').toLowerCase())) {
    throw Object.assign(new Error('Not found.'), { statusCode: 404 });
  }
  return user;
}

function safeDate(value) {
  const time = Number(value || 0);
  return Number.isFinite(time) && time > 0 ? time : null;
}

function dayKey(timestamp) {
  const date = new Date(Number(timestamp || 0));
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}

function recordsForUser(records = [], userId = '') {
  return records.filter(item => item?.userId === userId || item?.ownerId === userId);
}

export function analytics(user) {
  requireOperator(user);
  const users = Array.isArray(state.authUsers) ? state.authUsers : [];
  const projects = Array.isArray(state.projects) ? state.projects : [];
  const clips = Array.isArray(state.clips) ? state.clips : [];
  const sessions = Array.isArray(state.authSessions) ? state.authSessions : [];
  const billingEvents = Array.isArray(state.billingEvents) ? state.billingEvents : [];
  const applicationLog = Array.isArray(state.log) ? state.log : [];
  const socialConnections = state.socialConnections && typeof state.socialConnections === 'object' ? state.socialConnections : {};
  const thirtyDaysAgo = now() - 30 * DAY_MS;
  const sevenDaysAgo = now() - 7 * DAY_MS;

  const planCounts = { free: 0, weekly: 0, monthly: 0, yearly: 0, admin: 0, other: 0 };
  const userRows = users.map(account => {
    const accountProjects = recordsForUser(projects, account.id);
    const projectIds = new Set(accountProjects.map(project => project.id));
    const accountClips = recordsForUser(clips, account.id).filter(clip => !clip.projectId || projectIds.has(clip.projectId));
    const bill = publicBilling(account);
    const plan = String(bill.current?.plan || 'free');
    if (Object.hasOwn(planCounts, plan)) planCounts[plan] += 1;
    else planCounts.other += 1;
    return {
      id: account.id,
      name: account.name || account.email || 'Creator',
      email: account.email || '',
      picture: account.picture || '',
      role: account.role || 'creator',
      providers: Object.keys(account.providers || {}),
      createdAt: safeDate(account.createdAt),
      lastLoginAt: safeDate(account.lastLoginAt),
      plan,
      billingStatus: bill.current?.status || 'free',
      remainingTokens: bill.current?.unlimited ? null : Number(bill.current?.remaining || 0),
      bonusTokens: bill.current?.unlimited ? null : Number(bill.current?.bonusTokens || 0),
      tokensUsed: Number(bill.current?.used || 0),
      projects: accountProjects.length,
      clips: accountClips.length,
      posted: accountClips.filter(clip => clip.status === 'posted' || clip.postedAt).length,
      failed: accountProjects.filter(project => project.status === 'failed' || project.error).length,
    };
  }).sort((a, b) => Number(b.lastLoginAt || b.createdAt || 0) - Number(a.lastLoginAt || a.createdAt || 0));

  const usageMap = new Map();
  for (let offset = 13; offset >= 0; offset -= 1) {
    const timestamp = now() - offset * DAY_MS;
    usageMap.set(dayKey(timestamp), { date: dayKey(timestamp), tokensUsed: 0, tokensAdded: 0, events: 0 });
  }
  for (const event of billingEvents) {
    const key = dayKey(event.createdAt);
    const day = usageMap.get(key);
    if (!day) continue;
    day.events += 1;
    if (event.type === 'tokens_added') day.tokensAdded += Math.max(0, Number(event.amount || 0));
    if (event.type === 'tokens_charged') day.tokensUsed += Math.max(0, Number(event.amount || 0));
  }

  const activeSessionUsers = new Set(
    sessions
      .filter(session => Number(session.expiresAt || 0) > now() && Number(session.lastSeenAt || 0) >= sevenDaysAgo)
      .map(session => session.userId)
  );
  const social = { youtube: 0, instagram: 0, facebook: 0, tiktok: 0, meta: 0 };
  for (const accountConnections of Object.values(socialConnections)) {
    if (!accountConnections || typeof accountConnections !== 'object') continue;
    for (const provider of Object.keys(social)) {
      if (accountConnections[provider]) social[provider] += 1;
    }
  }
  const paidUsers = userRows.filter(account => ['weekly', 'monthly', 'yearly'].includes(account.plan)).length;
  const trialUsers = userRows.filter(account => account.billingStatus === 'trialing').length;

  return {
    generatedAt: now(),
    overview: {
      users: users.length,
      newUsers30d: users.filter(account => Number(account.createdAt || 0) >= thirtyDaysAgo).length,
      activeUsers7d: new Set([
        ...activeSessionUsers,
        ...users.filter(account => Number(account.lastLoginAt || 0) >= sevenDaysAgo).map(account => account.id),
      ]).size,
      projects: projects.length,
      processingProjects: projects.filter(project => ['queued', 'processing'].includes(String(project.status || ''))).length,
      projects30d: projects.filter(project => Number(project.submittedAt || project.createdAt || 0) >= thirtyDaysAgo).length,
      clips: clips.length,
      postedClips: clips.filter(clip => clip.status === 'posted' || clip.postedAt).length,
      readyClips: clips.filter(clip => ['ready', 'waiting', 'approved', 'scheduled'].includes(String(clip.status || ''))).length,
      failedProjects: projects.filter(project => project.status === 'failed' || project.error).length,
      tokensUsed30d: billingEvents
        .filter(event => event.type === 'tokens_charged' && Number(event.createdAt || 0) >= thirtyDaysAgo)
        .reduce((sum, event) => sum + Math.max(0, Number(event.amount || 0)), 0),
      tokensSold30d: billingEvents
        .filter(event => event.type === 'tokens_added' && Number(event.createdAt || 0) >= thirtyDaysAgo)
        .reduce((sum, event) => sum + Math.max(0, Number(event.amount || 0)), 0),
      purchasedTopupBalance: userRows.reduce((sum, account) => sum + Math.max(0, Number(account.bonusTokens || 0)), 0),
      trialUsers,
      paidUsers,
      freeUsers: userRows.filter(account => account.plan === 'free').length,
    },
    plans: planCounts,
    social,
    usage: [...usageMap.values()],
    users: userRows.slice(0, 250),
    recentActivity: billingEvents.slice(0, 30).map(event => ({
      id: event.id,
      userId: event.userId,
      type: event.type,
      amount: Number(event.amount || 0),
      message: event.message || event.reason || '',
      createdAt: safeDate(event.createdAt),
    })),
    recentApplicationActivity: applicationLog.slice(0, 30).map(entry => ({
      userId: entry.userId || null,
      level: entry.level || 'info',
      createdAt: safeDate(entry.at),
    })),
  };
}
