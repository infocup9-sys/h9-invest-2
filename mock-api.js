import { PLANS } from './investment-model.js';
import { chooseDailyPrize, DAILY_TICKET_POOL, REWARDS } from './rewards-model.js';

const MOCK_ACCOUNTS_KEY = 'h9-mock-backend-v1';
const MOCK_SESSIONS_KEY = 'h9-mock-sessions-v1';
const LEGACY_ACCOUNTS_KEY = 'h9-test-accounts-v1';
const DAY_MS = 86_400_000;
const NETWORKS = ['bep20', 'bitcoin', 'trc20'];
const makeId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const fail = (message) => { throw new Error(message); };

async function passwordDigest(password, salt) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: new TextEncoder().encode(salt),
    iterations: 120_000,
    hash: 'SHA-256',
  }, material, 256);
  return [...new Uint8Array(bits)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

function readAccounts() {
  let accounts = [];
  try {
    const saved = JSON.parse(localStorage.getItem(MOCK_ACCOUNTS_KEY) || '[]');
    if (Array.isArray(saved)) accounts = saved;
  } catch {}
  accounts = accounts.filter((account) => account && typeof account.email === 'string' && account.username);
  let changed = false;
  accounts.forEach((account, index) => {
    if (!account.id) { account.id = makeId(); changed = true; }
    account.role ||= index === 0 ? 'admin' : 'user';
    account.status ||= 'approved';
    account.wallet ||= { deposit: 0, earnings: 0 };
    account.investments ||= [];
    account.transactions ||= [];
    account.depositRequests ||= [];
    account.withdrawalRequests ||= [];
    account.preferences ||= { language: 'it', theme: 'dark' };
    account.withdrawalWallet ??= null;
    account.h9Points = Math.max(0, Math.floor(Number(account.h9Points) || 0));
    account.bonusSpins = Math.max(0, Math.floor(Number(account.bonusSpins) || 0));
    account.pointHistory ||= [];
    account.referrals ||= [];
    account.activeBonuses ||= [];
    account.rewardRedemptions ||= [];
    account.dailyPrizes ||= [];
    let legacyEarnings = Math.max(0, Number(account.wallet.earnings) || 0);
    for (const investment of [...(account.investments || [])].sort((a, b) => a.startedAt - b.startedAt)) {
      investment.earningsCredited = Math.max(0, Number(investment.earningsCredited) || 0);
      if (investment.compoundBalance === undefined && investment.uncompoundedEarnings === undefined) {
        const migratedBalance = Math.min(legacyEarnings, investment.earningsCredited);
        investment.compoundBalance = migratedBalance;
        investment.uncompoundedEarnings = 0;
        legacyEarnings -= migratedBalance;
        changed = true;
      } else {
        investment.compoundBalance = Math.max(0, Number(investment.compoundBalance) || 0);
        investment.uncompoundedEarnings = Math.max(0, Number(investment.uncompoundedEarnings) || 0);
      }
    }
    if (!account.referralCode) {
      account.referralCode = makeReferralCode(accounts, account.id);
      changed = true;
    }
    account.revision ||= 1;
    account.createdAt ||= Date.now();
  });

  let migrateLegacyAccounts = false;
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_ACCOUNTS_KEY) || '[]');
    if (Array.isArray(legacy)) {
      migrateLegacyAccounts = true;
      for (const old of legacy) {
        if (!old?.email || !old?.username ||
            accounts.some((account) => account.email.toLowerCase() === old.email.toLowerCase())) continue;
        accounts.push({
          ...old,
          id: old.id || makeId(),
          role: old.role || (accounts.length === 0 ? 'admin' : 'user'),
          status: old.status || 'approved',
          wallet: old.wallet || { deposit: 0, earnings: 0 },
          investments: Array.isArray(old.investments) ? old.investments : [],
          transactions: Array.isArray(old.transactions) ? old.transactions : [],
          depositRequests: Array.isArray(old.depositRequests) ? old.depositRequests : [],
          withdrawalRequests: Array.isArray(old.withdrawalRequests) ? old.withdrawalRequests : [],
          preferences: old.preferences || { language: 'it', theme: 'dark' },
          withdrawalWallet: old.withdrawalWallet || null,
          h9Points: old.h9Points || 0,
          bonusSpins: old.bonusSpins || 0,
          pointHistory: Array.isArray(old.pointHistory) ? old.pointHistory : [],
          referrals: Array.isArray(old.referrals) ? old.referrals : [],
          activeBonuses: Array.isArray(old.activeBonuses) ? old.activeBonuses : [],
          rewardRedemptions: Array.isArray(old.rewardRedemptions) ? old.rewardRedemptions : [],
          dailyPrizes: Array.isArray(old.dailyPrizes) ? old.dailyPrizes : [],
          referralCode: old.referralCode || makeReferralCode(accounts, old.id),
          revision: 1,
          createdAt: old.createdAt || Date.now(),
        });
        changed = true;
      }
    }
  } catch {}
  if (changed || !localStorage.getItem(MOCK_ACCOUNTS_KEY)) saveAccounts(accounts);
  if (migrateLegacyAccounts) localStorage.removeItem(LEGACY_ACCOUNTS_KEY);
  return accounts;
}

function makeReferralCode(accounts, accountId) {
  const base = String(accountId || makeId()).replace(/[^a-z0-9]/gi, '').slice(-7).toUpperCase();
  let code = base;
  while (accounts.some((account) => account.referralCode === code)) {
    code = `${base.slice(-5)}${Math.floor(Math.random() * 90 + 10)}`;
  }
  return code;
}

function saveAccounts(accounts) {
  localStorage.setItem(MOCK_ACCOUNTS_KEY, JSON.stringify(accounts));
}

function publicAccount(account) {
  const {
    id, username, email, role, status, createdAt, reviewedAt, revision,
    wallet, investments, transactions, depositRequests, withdrawalRequests,
    preferences, withdrawalWallet, h9Points, pointHistory, referralCode,
    referrals, activeBonuses, rewardRedemptions, dailyPrizes, invitedBy, bonusSpins,
  } = account;
  return {
    id, username, email, role, status, createdAt, reviewedAt, revision,
    wallet, investments, transactions, depositRequests, withdrawalRequests,
    preferences, withdrawalWallet, h9Points, pointHistory, referralCode,
    referrals, activeBonuses, rewardRedemptions, dailyPrizes, invitedBy, bonusSpins,
    lastDailyPrizeDate: account.lastDailyPrizeDate || null,
  };
}

function pointEntry(account, amount, type, label, extra = {}) {
  const entry = { id: makeId(), amount, type, label, date: Date.now(), ...extra };
  account.pointHistory.unshift(entry);
  return entry;
}

function secureTicket(poolSize) {
  const ceiling = Math.floor(0x1_0000_0000 / poolSize) * poolSize;
  const values = new Uint32Array(1);
  let value;
  do {
    crypto.getRandomValues(values);
    value = values[0];
  } while (value >= ceiling);
  return value % poolSize;
}

function readSessions() {
  try {
    const saved = JSON.parse(localStorage.getItem(MOCK_SESSIONS_KEY) || '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function issueSession(accountId) {
  const token = makeId();
  const sessions = readSessions();
  sessions[token] = accountId;
  localStorage.setItem(MOCK_SESSIONS_KEY, JSON.stringify(sessions));
  return token;
}

function getSessionAccount(accessToken, options) {
  const headers = new Headers(options.headers || {});
  const authorization = headers.get('Authorization') || (accessToken ? `Bearer ${accessToken}` : '');
  const token = authorization.replace(/^Bearer\s+/i, '');
  const accountId = readSessions()[token];
  if (!accountId) return fail('Session expired. Please log in again.');
  const account = readAccounts().find((item) => item.id === accountId);
  if (!account) return fail('Account not found.');
  if (account.status !== 'approved') return fail('This account is not active.');
  return account;
}

function accrueDaily(account) {
  let changed = false;
  for (const investment of account.investments || []) {
    if (!investment || investment.status !== 'active') continue;
    const maturityAt = investment.startedAt + investment.days * DAY_MS;
    const creditedDays = investment.creditedDays || 0;
    let cursor = investment.lastAccruedAt || investment.startedAt + creditedDays * DAY_MS;
    const accrualEnd = Math.min(Date.now(), maturityAt);
    while (cursor < accrualEnd) {
      const dayEnd = (Math.floor(cursor / DAY_MS) + 1) * DAY_MS;
      const nextBonusBoundary = (account.activeBonuses || [])
        .flatMap((bonus) => [bonus.startedAt, bonus.expiresAt])
        .filter((boundary) => boundary > cursor)
        .reduce((next, boundary) => Math.min(next, boundary), Infinity);
      const segmentEnd = Math.min(accrualEnd, dayEnd, nextBonusBoundary);
      const multiplier = (account.activeBonuses || []).some((bonus) =>
        bonus.type === 'double-earnings' && bonus.startedAt <= cursor && bonus.expiresAt > cursor,
      ) ? 2 : 1;
      const compoundBase = investment.principal + (investment.compoundBalance || 0);
      const gain = compoundBase * investment.rate / 100 *
        ((segmentEnd - cursor) / DAY_MS) * multiplier;
      if (gain > 0) {
        account.wallet.earnings += gain;
        investment.earningsCredited = (investment.earningsCredited || 0) + gain;
        investment.uncompoundedEarnings = (investment.uncompoundedEarnings || 0) + gain;
        const earningDay = new Date(cursor).toISOString().slice(0, 10);
        const dailyEntry = account.transactions.find((item) =>
          item.type === 'earnings' && item.investmentId === investment.id && item.earningDay === earningDay,
        );
        if (dailyEntry) {
          dailyEntry.amount += gain;
          dailyEntry.date = segmentEnd;
        } else {
          account.transactions.unshift({
            id: makeId(), type: 'earnings', amount: gain, status: 'accredited',
            investmentId: investment.id, earningDay, date: segmentEnd,
          });
        }
      }
      cursor = segmentEnd;
      if (cursor === dayEnd) {
        investment.compoundBalance = (investment.compoundBalance || 0) +
          (investment.uncompoundedEarnings || 0);
        investment.uncompoundedEarnings = 0;
      }
      investment.lastAccruedAt = cursor;
      changed = true;
    }
    investment.creditedDays = Math.min(investment.days, Math.floor((accrualEnd - investment.startedAt) / DAY_MS));
    if (accrualEnd >= maturityAt) {
      investment.status = 'matured';
      investment.maturedAt = maturityAt;
      account.wallet.deposit += investment.principal;
      account.transactions.unshift({
        id: makeId(), type: 'maturity', amount: investment.principal,
        status: 'completed', date: investment.maturedAt,
      });
      changed = true;
    }
  }
  return changed;
}

function persistAccount(account) {
  const accounts = readAccounts();
  const index = accounts.findIndex((item) => item.id === account.id);
  if (index < 0) return fail('Account not found.');
  account.revision = (accounts[index].revision || 0) + 1;
  accounts[index] = account;
  saveAccounts(accounts);
  return publicAccount(account);
}

function transaction(type, amount, network = '', status = 'completed', extra = {}) {
  return { id: makeId(), type, amount, network, status, date: Date.now(), ...extra };
}

export async function mockApiRequest(path, options = {}, accessToken = '') {
  const method = options.method || 'GET';
  let body = {};
  try {
    if (options.body) body = JSON.parse(options.body);
  } catch {
    return fail('Invalid request.');
  }

  if (path === '/api/auth/register' && method === 'POST') {
    const username = String(body.username || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (username.length < 3 || username.length > 30 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        password.length < 8 || password.length > 200) {
      return fail('Check your username, email and password (at least 8 characters).');
    }
    const accounts = readAccounts();
    if (accounts.some((account) => account.email.toLowerCase() === email ||
        account.username.toLowerCase() === username.toLowerCase())) {
      return fail('Email or username is already in use.');
    }
    const salt = makeId();
    const referralCode = String(body.referralCode || '').trim().toUpperCase();
    const inviter = referralCode
      ? accounts.find((item) => item.referralCode === referralCode && item.id !== body.id)
      : null;
    const account = {
      id: makeId(),
      username,
      email,
      salt,
      passwordHash: await passwordDigest(password, salt),
      role: accounts.length === 0 ? 'admin' : 'user',
      status: 'approved',
      wallet: { deposit: 0, earnings: 0 },
      investments: [],
      transactions: [],
      depositRequests: [],
      withdrawalRequests: [],
      preferences: { language: 'it', theme: 'dark' },
      withdrawalWallet: null,
      h9Points: inviter ? 25 : 0,
      bonusSpins: 0,
      pointHistory: [],
      referralCode: makeReferralCode(accounts),
      referrals: [],
      activeBonuses: [],
      rewardRedemptions: [],
      dailyPrizes: [],
      invitedBy: inviter?.id || null,
      createdAt: Date.now(),
      revision: 1,
    };
    if (inviter) {
      pointEntry(account, 25, 'referral-welcome', 'Welcome points');
      inviter.h9Points = (inviter.h9Points || 0) + 10;
      pointEntry(inviter, 10, 'referral', `Invitation accepted · ${username}`, {
        referredAccountId: account.id,
      });
      inviter.referrals ||= [];
      inviter.referrals.unshift({
        id: account.id, username, date: Date.now(), points: 10,
      });
    }
    accounts.push(account);
    saveAccounts(accounts);
    return { token: issueSession(account.id), account: publicAccount(account) };
  }

  if (path === '/api/auth/login' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const account = readAccounts().find((item) => item.email.toLowerCase() === email);
    if (!account || await passwordDigest(password, account.salt) !== account.passwordHash) {
      return fail('Email or password is incorrect.');
    }
    if (account.status !== 'approved') return fail('This account is not active.');
    return { token: issueSession(account.id), account: publicAccount(account) };
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    const headers = new Headers(options.headers || {});
    const token = (headers.get('Authorization') || `Bearer ${accessToken}`).replace(/^Bearer\s+/i, '');
    const sessions = readSessions();
    delete sessions[token];
    localStorage.setItem(MOCK_SESSIONS_KEY, JSON.stringify(sessions));
    return { ok: true };
  }

  if (path === '/api/account' && method === 'GET') {
    const account = getSessionAccount(accessToken, options);
    if (accrueDaily(account)) persistAccount(account);
    return { account: publicAccount(account) };
  }

  if (path === '/api/admin/accounts' && method === 'GET') {
    const admin = getSessionAccount(accessToken, options);
    if (admin.role !== 'admin') return fail('Not authorized.');
    const accounts = readAccounts();
    for (const account of accounts) {
      if (accrueDaily(account)) persistAccount(account);
    }
    return { accounts: readAccounts().map(publicAccount) };
  }

  if (path === '/api/admin/rewards/credit' && method === 'POST') {
    const admin = getSessionAccount(accessToken, options);
    if (admin.role !== 'admin') return fail('Not authorized.');
    const points = Number(body.points || 0);
    const spins = Number(body.spins || 0);
    if (!Number.isSafeInteger(points) || points < 0 ||
        !Number.isSafeInteger(spins) || spins < 0 || (points === 0 && spins === 0)) {
      return fail('Enter a positive whole number of points or extra spins.');
    }
    const target = readAccounts().find((account) => account.id === body.accountId);
    if (!target) return fail('Account not found.');
    if (!Number.isSafeInteger((target.h9Points || 0) + points) ||
        !Number.isSafeInteger((target.bonusSpins || 0) + spins)) {
      return fail('The new points or spin balance is too large.');
    }
    if (points > 0) {
      target.h9Points = (target.h9Points || 0) + points;
      pointEntry(target, points, 'admin-credit', 'Points credited by admin');
    }
    if (spins > 0) target.bonusSpins = (target.bonusSpins || 0) + spins;
    return { account: persistAccount(target) };
  }

  if (path === '/api/admin/accounts' && method === 'DELETE') {
    const admin = getSessionAccount(accessToken, options);
    if (admin.role !== 'admin') return fail('Not authorized.');
    localStorage.removeItem(MOCK_ACCOUNTS_KEY);
    localStorage.removeItem(MOCK_SESSIONS_KEY);
    return { ok: true };
  }

  if ((path === '/api/account' || path === '/api/admin/account') && method === 'PUT') {
    const sessionAccount = getSessionAccount(accessToken, options);
    if (path === '/api/admin/account' && sessionAccount.role !== 'admin') return fail('Not authorized.');
    const target = path === '/api/account'
      ? sessionAccount
      : readAccounts().find((account) => account.id === body.id);
    if (!target) return fail('Account not found.');
    if (Number(body.revision) !== target.revision) {
      return fail('This account changed in another session. Refresh and try again.');
    }
    if (path === '/api/admin/account' && target.id !== sessionAccount.id) {
      if (!body.wallet || !Number.isFinite(Number(body.wallet.deposit)) ||
          !Number.isFinite(Number(body.wallet.earnings)) ||
          Number(body.wallet.deposit) < 0 || Number(body.wallet.earnings) < 0) {
        return fail('Enter valid non-negative balances.');
      }
      if (!['approved', 'blocked', 'pending', 'rejected'].includes(body.status || target.status)) {
        return fail('Invalid account status.');
      }
      target.wallet = {
        deposit: Number(body.wallet.deposit),
        earnings: Number(body.wallet.earnings),
      };
      target.status = body.status || target.status;
      if (Array.isArray(body.transactions)) target.transactions = body.transactions;
      if (Array.isArray(body.depositRequests)) target.depositRequests = body.depositRequests;
      if (Array.isArray(body.withdrawalRequests)) target.withdrawalRequests = body.withdrawalRequests;
      if (body.reviewedAt !== undefined) target.reviewedAt = body.reviewedAt;
      return { account: persistAccount(target) };
    }
    Object.assign(target, {
      wallet: body.wallet || target.wallet,
      investments: body.investments || target.investments,
      transactions: body.transactions || target.transactions,
      depositRequests: body.depositRequests || target.depositRequests,
      withdrawalRequests: body.withdrawalRequests || target.withdrawalRequests,
      preferences: body.preferences || target.preferences || { language: 'it', theme: 'dark' },
      withdrawalWallet: body.withdrawalWallet === undefined ? target.withdrawalWallet : body.withdrawalWallet,
    });
    return { account: persistAccount(target) };
  }

  if (path === '/api/auth/password' && method === 'PUT') {
    const account = getSessionAccount(accessToken, options);
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    if (newPassword.length < 8 || newPassword.length > 200) return fail('New password must contain at least 8 characters.');
    if (await passwordDigest(currentPassword, account.salt) !== account.passwordHash) return fail('Current password is incorrect.');
    account.salt = makeId();
    account.passwordHash = await passwordDigest(newPassword, account.salt);
    return { account: persistAccount(account) };
  }

  if (path === '/api/rewards/purchase' && method === 'POST') {
    const account = getSessionAccount(accessToken, options);
    const reward = REWARDS.find((item) => item.id === body.rewardId);
    if (!reward) return fail('This reward is unavailable.');
    if ((account.h9Points || 0) < reward.points) return fail('You do not have enough H9 points.');
    if (reward.type === 'boost' &&
        (account.activeBonuses || []).some((bonus) => bonus.type === 'double-earnings' && bonus.expiresAt > Date.now())) {
      return fail('Use or wait for your current earnings boost to expire first.');
    }

    account.h9Points -= reward.points;
    pointEntry(account, -reward.points, 'spend', reward.title, { rewardId: reward.id });
    if (reward.type === 'boost') {
      const startedAt = Date.now();
      const bonus = {
        id: makeId(), type: 'double-earnings', multiplier: 2,
        title: reward.title, startedAt, expiresAt: startedAt + reward.hours * 3_600_000,
      };
      account.activeBonuses.unshift(bonus);
      account.transactions.unshift(transaction('bonus', 0, '', 'completed', {
        bonusId: bonus.id, planName: bonus.title,
      }));
    } else {
      const redemption = {
        id: makeId(), rewardId: reward.id, title: reward.title,
        amount: reward.amount, status: 'credited', balanceDestination: 'deposit',
        requestedAt: Date.now(), creditedAt: Date.now(),
      };
      account.rewardRedemptions.unshift(redemption);
      account.wallet.deposit += reward.amount;
      account.transactions.unshift(transaction('coupon', reward.amount, '', 'completed', {
        redemptionId: redemption.id, planName: reward.title,
      }));
    }
    return { account: persistAccount(account) };
  }

  if (path === '/api/rewards/spin' && method === 'POST') {
    const account = getSessionAccount(accessToken, options);
    const today = new Date().toISOString().slice(0, 10);
    const usedDailySpin = account.lastDailyPrizeDate === today;
    if (usedDailySpin && (account.bonusSpins || 0) < 1) {
      return fail('You already used today’s spin and have no extra spins.');
    }
    if (usedDailySpin) account.bonusSpins -= 1;
    else account.lastDailyPrizeDate = today;
    const prize = chooseDailyPrize(secureTicket(DAILY_TICKET_POOL));
    account.dailyPrizes ||= [];
    account.dailyPrizes.unshift({
      id: makeId(), prizeId: prize.id, points: prize.points,
      spinType: usedDailySpin ? 'extra' : 'daily', date: Date.now(),
    });
    account.h9Points = (account.h9Points || 0) + prize.points;
    pointEntry(account, prize.points, 'daily-prize', `Daily mystery box · ${prize.points} H9 points`, {
      prizeId: prize.id,
    });
    return { account: persistAccount(account), prize };
  }

  if (path === '/api/deposits' && method === 'POST') {
    const account = getSessionAccount(accessToken, options);
    const amount = Number(body.amount);
    const network = String(body.network || '');
    const txHash = String(body.txHash || '').trim();
    if (!Number.isFinite(amount) || amount <= 0 || !NETWORKS.includes(network) || !txHash) {
      return fail('Invalid amount, network or transaction hash.');
    }
    const request = { id: makeId(), amount, network, txHash, status: 'pending', createdAt: Date.now() };
    const entry = transaction('deposit', amount, network, 'pending', { requestId: request.id });
    request.transactionId = entry.id;
    account.depositRequests.unshift(request);
    account.transactions.unshift(entry);
    return { account: persistAccount(account) };
  }

  if (path === '/api/withdrawals' && method === 'POST') {
    const account = getSessionAccount(accessToken, options);
    if (accrueDaily(account)) persistAccount(account);
    const amount = Number(body.amount);
    const network = String(body.network || '');
    const address = String(body.address || '').trim();
    if (!Number.isFinite(amount) || amount <= 0 || !NETWORKS.includes(network) || !address) {
      return fail('Invalid amount, network or address.');
    }
    if (amount > account.wallet.earnings) return fail('Insufficient earnings balance.');
    account.wallet.earnings -= amount;
    let remaining = amount;
    const compoundAllocations = [];
    const investments = [...(account.investments || [])].sort((a, b) => a.startedAt - b.startedAt);
    for (const investment of investments) {
      if (remaining <= 0) break;
      const fromCompound = Math.min(remaining, investment.compoundBalance || 0);
      investment.compoundBalance = Math.max(0, (investment.compoundBalance || 0) - fromCompound);
      remaining -= fromCompound;
      const fromUncompounded = Math.min(remaining, investment.uncompoundedEarnings || 0);
      investment.uncompoundedEarnings = Math.max(0, (investment.uncompoundedEarnings || 0) - fromUncompounded);
      remaining -= fromUncompounded;
      if (fromCompound || fromUncompounded) {
        compoundAllocations.push({
          investmentId: investment.id,
          compoundBalance: fromCompound,
          uncompoundedEarnings: fromUncompounded,
        });
      }
    }
    const request = {
      id: makeId(), amount, network, address, status: 'pending', createdAt: Date.now(),
      compoundAllocations,
    };
    const entry = transaction('withdrawal', amount, network, 'pending', {
      requestId: request.id, addressHint: `…${address.slice(-6)}`,
    });
    request.transactionId = entry.id;
    account.withdrawalRequests.unshift(request);
    account.transactions.unshift(entry);
    return { account: persistAccount(account) };
  }

  if (path === '/api/investments' && method === 'POST') {
    const account = getSessionAccount(accessToken, options);
    const amount = Number(body.amount);
    const plan = PLANS.find((item) => item.id === body.planId);
    if (!plan || !Number.isFinite(amount) || amount <= 0) return fail('Invalid plan or amount.');
    if (amount > account.wallet.deposit) return fail('Insufficient deposit balance.');
    const investment = {
      id: makeId(), planId: plan.id, days: plan.days, rate: plan.rate,
      principal: amount, startedAt: Date.now(), creditedDays: 0,
      earningsCredited: 0, compoundBalance: 0, uncompoundedEarnings: 0, status: 'active',
      allocation: plan.allocations.map((item) => ({ ...item })),
    };
    account.wallet.deposit -= amount;
    account.investments.unshift(investment);
    account.transactions.unshift(transaction('investment', amount, '', 'completed', { planName: plan.name }));
    return { account: persistAccount(account) };
  }

  return fail('This operation is unavailable in the demo backend.');
}
