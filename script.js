import { mockApiRequest } from './mock-api.js';
import { PLANS } from './investment-model.js';
import { DAILY_PRIZES, REWARDS } from './rewards-model.js';
import { translatePage, translateText } from './localization.js';

const SESSION_KEY = 'h9-test-session-v1';
const USE_MOCK_BACKEND = true;
const RENDER_API_BASE = '';
const DAY_MS = 86_400_000;
const NETWORKS = {
  bep20: 'BNB Chain · BEP-20',
  bitcoin: 'Bitcoin · USDT (test)',
  trc20: 'TRON · TRC-20',
};
const LANGUAGES = ['en', 'fr', 'es', 'de', 'pt', 'hi', 'zh', 'it'];
const LANGUAGE_LOCALES = { en: 'en-US', fr: 'fr-FR', es: 'es-ES', de: 'de-DE', pt: 'pt-PT', hi: 'hi-IN', zh: 'zh-CN', it: 'it-IT' };
const $ = (id) => document.getElementById(id);
let language = 'it';
const usd = (amount) => `${Number(amount || 0).toLocaleString(LANGUAGE_LOCALES[language] || 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
let accounts = [];
let current = null;
let accessToken = sessionStorage.getItem(SESSION_KEY) || '';
localStorage.removeItem(SESSION_KEY);
let selectedPlan = null;
let toastTimer;
let wheelSpinning = false;
let pullStartY = null;

async function apiRequest(path, options = {}) {
  if (USE_MOCK_BACKEND) return mockApiRequest(path, options, accessToken);
  const headers = new Headers(options.headers || {});
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${RENDER_API_BASE}${path}`, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Service temporarily unavailable.');
  return result;
}

async function saveAccounts(target = current) {
  if (!target || !accessToken) return false;
  try {
    const isAdminEdit = current.role === 'admin' && target.id !== current.id;
    const result = await apiRequest(isAdminEdit ? '/api/admin/account' : '/api/account', {
      method: 'PUT',
      body: JSON.stringify({ ...target, id: target.id }),
    });
    Object.assign(target, result.account);
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  }
}

function applyAccount(account) {
  const index = accounts.findIndex((item) => item.id === account.id);
  if (index >= 0) accounts[index] = account;
  current = account;
  render();
}

function setError(id, message = '') {
  $(id).textContent = translateText(message, language);
  $(id).classList.remove('success');
}

function toast(message) {
  const node = $('toast');
  node.textContent = translateText(message, language);
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2500);
}

function timestampDate(value) {
  return new Date(value).toLocaleDateString(LANGUAGE_LOCALES[language] || 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function earningsNoticeKey(accountId = current?.id) {
  return `h9-earnings-notice-v1:${accountId || 'guest'}`;
}

function readEarningsNoticeState() {
  try {
    const state = JSON.parse(localStorage.getItem(earningsNoticeKey()) || '{}');
    return state && typeof state === 'object' ? state : {};
  } catch {
    return {};
  }
}

function openApp(account) {
  current = account;
  if (accessToken) sessionStorage.setItem(SESSION_KEY, accessToken);
  $('auth-screen').hidden = true;
  $('app-shell').hidden = false;
  $('bottom-nav').hidden = false;
  render();
  setView('home');
  if (current.role === 'admin') {
    apiRequest('/api/admin/accounts').then(({ accounts: list }) => {
      accounts = list;
      current = accounts.find((item) => item.id === current.id) || current;
      render();
    }).catch((error) => toast(error.message));
  }
}

function signOut() {
  if (accessToken) apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => {});
  current = null;
  accessToken = '';
  accounts = [];
  sessionStorage.removeItem(SESSION_KEY);
  $('app-shell').hidden = true;
  $('bottom-nav').hidden = true;
  $('auth-screen').hidden = false;
  showAuthMode('login');
}

function showAuthMode(mode) {
  const register = mode === 'register';
  $('auth-entry').hidden = false;
  $('login-form').hidden = register;
  $('register-form').hidden = !register;
  $('auth-title').textContent = register ? 'Crea il tuo account' : 'Bentornato';
  $('auth-subtitle').textContent = register ? 'Registrati per provare l’app.' : 'Accedi al tuo account H9.';
  $('show-login').classList.toggle('selected', !register);
  $('show-register').classList.toggle('selected', register);
  translatePage(language);
}

function balanceTotal() {
  const activeCapital = current.investments
    .filter((investment) => investment.status === 'active')
    .reduce((sum, investment) => sum + investment.principal, 0);
  return current.wallet.deposit + current.wallet.earnings + activeCapital;
}

async function refreshAccount() {
  if (!current) return;
  try {
    const { account } = await apiRequest('/api/account');
    if (account.role === 'admin') {
      const { accounts: list } = await apiRequest('/api/admin/accounts');
      accounts = list;
      current = accounts.find((item) => item.id === account.id) || account;
    } else {
      const index = accounts.findIndex((item) => item.id === account.id);
      if (index >= 0) accounts[index] = account;
      current = account;
    }
    render();
    return true;
  } catch (error) {
    if (/session expired|not active/i.test(error.message)) {
      signOut();
      setError('login-error', /not active/i.test(error.message)
        ? 'This account is not active.'
        : 'Session expired. Please log in again.');
    } else {
      toast(error.message);
    }
    return false;
  }
}

async function resumeSession() {
  if (!accessToken) return;
  try {
    const { account } = await apiRequest('/api/account');
    current = account;
    accounts = [account];
    openApp(account);
  } catch (error) {
    accessToken = '';
    sessionStorage.removeItem(SESSION_KEY);
    setError('login-error', error.message);
  }
}

function renderPlan(plan, compact = false) {
  const totalPct = (Math.pow(1 + plan.rate / 100, plan.days) - 1) * 100;
  return `<article class="plan-card ${compact ? 'compact' : ''}" data-plan-card="${plan.id}">
    <div class="plan-card-top"><span class="duration-tag">${plan.days} ${translateText('days', language)}</span><span class="plan-lock">${translateText('Capital locked', language)}</span></div>
    <h3>${esc(translateText(plan.name, language))}</h3>
    <div class="plan-rate">${plan.rate.toLocaleString(LANGUAGE_LOCALES[language])}%<small>${translateText('/ day', language)}</small></div>
    <div class="plan-data"><span>${translateText('Estimated total return', language)}</span><b>${totalPct.toLocaleString(LANGUAGE_LOCALES[language], { maximumFractionDigits: 2 })}%</b></div>
    <div class="plan-data"><span>${translateText('Daily return on 1,000 USDT', language)}</span><b>${usd(plan.rate * 10)}</b></div>
    <p class="plan-description">${translateText('Unwithdrawn earnings compound daily; withdraw anytime.', language)}</p>
    <button class="primary-button" type="button" data-plan-details="${plan.id}">${compact ? 'Details' : 'Plan details'}</button>
  </article>`;
}

function renderInvestment(investment, ended = false) {
  const plan = PLANS.find((item) => item.id === investment.planId);
  const elapsedDays = ended ? investment.days : Math.min(investment.days, Math.floor((Date.now() - investment.startedAt) / DAY_MS));
  const progress = Math.max(0, Math.min(100, (elapsedDays / investment.days) * 100));
  const dailyReturn = (investment.principal + (investment.compoundBalance || 0)) *
    investment.rate / 100 * (ended ? 1 : earningsMultiplier());
  return `<article class="investment-card interactive-investment" data-investment-detail="${esc(investment.id)}" tabindex="0" role="button" aria-label="Details ${esc(plan?.name || `${investment.days}-day plan`)}">
    <div class="investment-card-head"><div><b>${esc(plan?.name || `${investment.days}-day plan`)}</b><span>${usd(investment.principal)} · ${investment.rate.toLocaleString(LANGUAGE_LOCALES[language])}% daily rate · ${usd(dailyReturn)} daily</span></div><span class="state-badge ${ended ? 'ended' : 'active'}">${ended ? 'Completed' : 'Active'}</span></div>
    <div class="progress-track"><i style="width:${progress}%"></i></div>
    <div class="investment-details"><span>${ended ? `Completed ${timestampDate(investment.maturedAt)}` : `Matures ${timestampDate(investment.startedAt + investment.days * DAY_MS)}`}</span><span>Credited <b>${usd(investment.earningsCredited)}</b></span></div>
    ${ended ? `<div class="released-line">Principal returned to deposit balance · ${usd(investment.principal)}</div>` : `<div class="released-line">${investment.days - elapsedDays} days until principal is returned · daily product return ${usd(dailyReturn)}${earningsMultiplier() > 1 ? ' · 2× boost active' : ''}</div>`}
  </article>`;
}

function renderAllocationRows(allocation, principal = null) {
  return allocation.map((item) => {
    const weight = Math.max(0, Math.min(100, Number(item.weight) || 0));
    const dailyGain = principal === null ? null :
      principal * weight / 100 * (selectedPlan?.rate || 0) / 100 * earningsMultiplier();
    return `<div class="allocation-row">
      <div class="allocation-row-head">
        <span><b>${esc(item.name)}</b><small>${esc(item.category || 'Mercato')}</small></span>
        <span class="allocation-values"><b>${weight.toLocaleString(LANGUAGE_LOCALES[language])}%</b>${principal === null ? '' : `<small>${usd(dailyGain)} / day</small>`}</span>
      </div>
      <div class="allocation-track"><i style="width:${weight}%"></i></div>
    </div>`;
  }).join('');
}

function earningsMultiplier() {
  const active = (current?.activeBonuses || []).find((bonus) =>
    bonus.type === 'double-earnings' && bonus.expiresAt > Date.now(),
  );
  return active?.multiplier || 1;
}

function estimatedPlanGain(amount, plan, startAt = Date.now()) {
  if (!plan || !amount) return 0;
  const maturityAt = startAt + plan.days * DAY_MS;
  let cursor = startAt;
  let compoundBase = amount;
  let pendingDailyGain = 0;
  let totalGain = 0;
  while (cursor < maturityAt) {
    const dayEnd = (Math.floor(cursor / DAY_MS) + 1) * DAY_MS;
    const nextBonusBoundary = (current?.activeBonuses || [])
      .flatMap((bonus) => [bonus.startedAt, bonus.expiresAt])
      .filter((boundary) => boundary > cursor)
      .reduce((next, boundary) => Math.min(next, boundary), Infinity);
    const segmentEnd = Math.min(maturityAt, dayEnd, nextBonusBoundary);
    const multiplier = (current?.activeBonuses || []).some((bonus) =>
      bonus.type === 'double-earnings' && bonus.startedAt <= cursor && bonus.expiresAt > cursor,
    ) ? 2 : 1;
    const gain = compoundBase * plan.rate / 100 *
      ((segmentEnd - cursor) / DAY_MS) * multiplier;
    totalGain += gain;
    pendingDailyGain += gain;
    cursor = segmentEnd;
    if (cursor === dayEnd) {
      compoundBase += pendingDailyGain;
      pendingDailyGain = 0;
    }
  }
  return totalGain;
}

function updateCompoundSimulator() {
  const principal = Number($('compound-principal').value);
  const dailyRate = Number($('compound-rate').value);
  const days = Number($('compound-days').value);
  const breakdownRows = $('compound-breakdown-rows');
  if (!Number.isFinite(principal) || principal <= 0 ||
      !Number.isFinite(dailyRate) || dailyRate < 0 ||
      !Number.isInteger(days) || days <= 0) {
    $('compound-gain').textContent = usd(0);
    $('compound-total').textContent = usd(0);
    breakdownRows.innerHTML = `<tr><td class="empty-breakdown" colspan="5">${translateText('Enter valid values to view the daily breakdown.', language)}</td></tr>`;
    return;
  }
  let total = principal;
  let cumulativeInterest = 0;
  const rows = [];
  for (let day = 1; day <= days; day += 1) {
    const startingBalance = total;
    const dailyInterest = startingBalance * dailyRate / 100;
    cumulativeInterest += dailyInterest;
    total = startingBalance + dailyInterest;
    if (!Number.isFinite(total)) {
      $('compound-gain').textContent = '—';
      $('compound-total').textContent = '—';
      breakdownRows.innerHTML = '';
      return;
    }
    rows.push(`<tr><td>${day.toLocaleString(LANGUAGE_LOCALES[language])}</td><td>${usd(startingBalance)}</td><td class="interest-cell">${usd(dailyInterest)}</td><td>${usd(cumulativeInterest)}</td><td>${usd(total)}</td></tr>`);
  }
  $('compound-gain').textContent = usd(total - principal);
  $('compound-total').textContent = usd(total);
  breakdownRows.innerHTML = rows.join('');
}

function showPlanDetails(id) {
  selectedPlan = PLANS.find((plan) => plan.id === id);
  if (!selectedPlan) return;
  const totalPct = (Math.pow(1 + selectedPlan.rate / 100, selectedPlan.days) - 1) * 100;
  $('details-eyebrow').textContent = 'PLAN DETAILS · DEMO';
  $('details-title').textContent = translateText(selectedPlan.name, language);
  $('details-overview').innerHTML = `
    <div><span>Term</span><b>${selectedPlan.days} ${translateText('days', language)}</b></div>
    <div><span>Illustrative return</span><b>${selectedPlan.rate.toLocaleString(LANGUAGE_LOCALES[language])}% ${translateText('/ day', language)}</b></div>
    <div><span>Estimated total return</span><b>${totalPct.toLocaleString(LANGUAGE_LOCALES[language], { maximumFractionDigits: 2 })}%</b></div>
    <div><span>Daily product return</span><b>${usd(1000 * selectedPlan.rate / 100 * earningsMultiplier())} per 1,000 USDT${earningsMultiplier() > 1 ? ' · 2× boost active' : ''}</b></div>`;
  $('allocation-intro').textContent = `${translateText('Illustrative daily return for a 1,000 USDT investment.', language)} ${translateText('Each asset estimate reflects its allocation weight.', language)}${earningsMultiplier() > 1 ? ' A 2× boost applies while active.' : ''}`;
  $('details-allocation').innerHTML = renderAllocationRows(selectedPlan.allocations, 1000);
  $('details-invest-button').hidden = false;
  translatePage(language);
  $('details-dialog').showModal();
}

function showInvestmentDetails(id) {
  const investment = current?.investments.find((item) => item.id === id);
  if (!investment) return;
  const plan = PLANS.find((item) => item.id === investment.planId);
  const allocation = investment.allocation?.length ? investment.allocation : (plan?.allocations || []);
  selectedPlan = plan || { rate: investment.rate };
  const ended = investment.status === 'matured';
  $('details-eyebrow').textContent = ended ? 'COMPLETED INVESTMENT · DEMO' : 'ACTIVE INVESTMENT · DEMO';
  $('details-title').textContent = plan ? translateText(plan.name, language) : `${investment.days}-day plan`;
  $('details-overview').innerHTML = `
    <div><span>Initial capital</span><b>${usd(investment.principal)}</b></div>
    <div><span>Return</span><b>${investment.rate.toLocaleString(LANGUAGE_LOCALES[language])}% ${translateText('/ day', language)}</b></div>
    <div><span>Illustrative earnings credited</span><b>${usd(investment.earningsCredited)}</b></div>
    <div><span>Daily product return</span><b>${usd((investment.principal + (investment.compoundBalance || 0)) * investment.rate / 100 * earningsMultiplier())} ${translateText('/ day', language)}${earningsMultiplier() > 1 ? ' · 2× boost active' : ''}</b></div>
    <div><span>${ended ? 'Completed' : 'Maturity'}</span><b>${timestampDate(investment.maturedAt || investment.startedAt + investment.days * DAY_MS)}</b></div>
    <div><span>Started</span><b>${timestampDate(investment.startedAt)}</b></div>`;
  const currentCompoundBase = investment.principal + (investment.compoundBalance || 0);
  $('allocation-intro').textContent = `${translateText('Estimated daily return by asset', language)} · ${usd(currentCompoundBase)}`;
  $('details-allocation').innerHTML = renderAllocationRows(allocation, currentCompoundBase);
  $('details-invest-button').hidden = true;
  translatePage(language);
  $('details-dialog').showModal();
}

function renderActivity(transaction) {
  const titles = {
    deposit: 'Demo deposit',
    investment: 'Investment started',
    earnings: 'Daily earnings',
    maturity: 'Principal returned',
    withdrawal: 'Demo withdrawal',
    coupon: 'H9 coupon redemption',
    bonus: 'Earnings boost activated',
  };
  const date = timestampDate(transaction.date);
  const network = NETWORKS[transaction.network] || transaction.planName || '';
  const status = {
    pending: 'Pending review',
    confirmed: 'Confirmed · demo',
    completed: 'Completed · demo',
    accredited: 'Credited · demo',
    rejected: 'Rejected · demo',
    requested: 'Pending redemption · demo',
  }[transaction.status] || 'Recorded · demo';
  return `<article class="activity-row">
    <span class="activity-mark" aria-hidden="true">${transaction.type === 'deposit' || transaction.type === 'maturity' ? '↓' : transaction.type === 'withdrawal' ? '↑' : '↗'}</span>
    <span class="activity-copy"><b>${titles[transaction.type] || 'Account activity'}</b><small>${esc(network ? `${network} · ` : '')}${status} · ${date}</small></span>
    <b class="activity-amount">${usd(transaction.amount)}</b>
  </article>`;
}

function renderPointActivity(entry) {
  return `<article class="points-row">
    <span><b>${esc(translateText(entry.label, language))}</b><small>H9 points · ${timestampDate(entry.date)}</small></span>
    <b class="points-delta ${entry.amount < 0 ? 'spent' : ''}">${entry.amount > 0 ? '+' : ''}${entry.amount.toLocaleString(LANGUAGE_LOCALES[language])}</b>
  </article>`;
}

function renderAccountRequestHistory(account) {
  const history = [
    ...(account.depositRequests || [])
      .filter((request) => request.status !== 'pending')
      .map((request) => ({ type: 'Deposit', request })),
    ...(account.withdrawalRequests || [])
      .filter((request) => request.status !== 'pending')
      .map((request) => ({ type: 'Withdrawal', request })),
  ];
  if (account.reviewedAt && ['approved', 'rejected'].includes(account.status)) {
    history.push({
      type: 'Account registration',
      request: {
        id: `account-${account.id}`,
        amount: null,
        status: account.status,
        createdAt: account.createdAt,
        reviewedAt: account.reviewedAt,
      },
    });
  }
  history.sort((a, b) => (b.request.reviewedAt || b.request.createdAt || 0) -
    (a.request.reviewedAt || a.request.createdAt || 0));

  return `<details class="account-history">
    <summary>Request history <span>${history.length}</span></summary>
    ${history.length ? `<div class="account-history-list">${history.map(({ type, request }) => {
      const status = {
        confirmed: 'Confirmed',
        completed: 'Paid',
        rejected: 'Rejected',
        approved: 'Approved',
      }[request.status] || request.status;
      const reference = request.txHash || request.address;
      return `<article class="account-history-row">
        <div><b>${esc(type)}${request.amount === null ? '' : ` · ${usd(request.amount)}`}</b><span class="history-status">${esc(status)}</span></div>
        <small>Submitted ${timestampDate(request.createdAt)} · Reviewed ${timestampDate(request.reviewedAt || request.createdAt)}</small>
        ${request.network ? `<small>${esc(NETWORKS[request.network] || request.network)}</small>` : ''}
        ${reference ? `<code>${esc(reference)}</code>` : ''}
        ${request.payoutHash ? `<small>External payout hash</small><code>${esc(request.payoutHash)}</code>` : ''}
      </article>`;
    }).join('')}</div>` : '<p class="account-history-empty">No reviewed requests.</p>'}
  </details>`;
}

function renderAdmin() {
  if (!current || current.role !== 'admin') return;
  const pendingUsers = accounts.filter((account) => account.status === 'pending');
  const pendingDeposits = accounts.flatMap((account) =>
    (account.depositRequests || [])
      .filter((request) => request.status === 'pending')
      .map((request) => ({ account, request })),
  );
  const pendingWithdrawals = accounts.flatMap((account) =>
    (account.withdrawalRequests || [])
      .filter((request) => request.status === 'pending')
      .map((request) => ({ account, request })),
  );
  $('pending-user-count').textContent = pendingUsers.length;
  $('registered-user-count').textContent = accounts.length;
  $('pending-deposit-count').textContent = pendingDeposits.length;
  $('pending-withdrawal-count').textContent = pendingWithdrawals.length;
  $('users-queue-empty').hidden = pendingUsers.length > 0;
  $('deposits-queue-empty').hidden = pendingDeposits.length > 0;
  $('withdrawals-queue-empty').hidden = pendingWithdrawals.length > 0;
  $('registered-users').innerHTML = accounts.map((account) => `
    <article class="queue-card account-admin-card" data-account-card="${esc(account.id)}">
      <div class="queue-card-head"><div><b>${esc(account.username)}</b><span>${esc(account.email)}</span></div><span class="queue-status ${account.status === 'blocked' ? 'blocked' : ''}">${account.status === 'blocked' ? 'Blocked' : esc(account.status)}</span></div>
      <small>ID ${esc(account.id)} · Registered ${timestampDate(account.createdAt)} · ${account.role === 'admin' ? 'Admin' : 'User'} · ${(account.h9Points || 0).toLocaleString(LANGUAGE_LOCALES[language])} H9 points · ${(account.bonusSpins || 0).toLocaleString(LANGUAGE_LOCALES[language])} extra spins · ${(account.investments || []).length} investments</small>
      <div class="account-balance-fields">
        <label>Deposit balance (USDT)<input type="number" min="0" step="0.01" data-balance="deposit" value="${Number(account.wallet?.deposit || 0)}"></label>
        <label>Earnings balance (USDT)<input type="number" min="0" step="0.01" data-balance="earnings" value="${Number(account.wallet?.earnings || 0)}"></label>
      </div>
      <div class="account-credit-fields">
        <label>Points to add<input type="number" min="0" step="1" inputmode="numeric" data-credit="points" placeholder="0"></label>
        <label>Extra spins to add<input type="number" min="0" step="1" inputmode="numeric" data-credit="spins" placeholder="0"></label>
      </div>
      <div class="queue-actions">
        <button class="approve-button" type="button" data-admin-action="save-account" data-user="${esc(account.id)}">Save balances</button>
        <button class="reject-button" type="button" data-admin-action="toggle-account" data-user="${esc(account.id)}" ${account.id === current.id ? 'disabled' : ''}>${account.status === 'blocked' ? 'Unblock account' : 'Block account'}</button>
      </div>
      ${renderAccountRequestHistory(account)}
      <button class="outline-wide credit-rewards-button" type="button" data-admin-action="credit-rewards" data-user="${esc(account.id)}">Credit points / spins</button>
    </article>`).join('');

  $('pending-users').innerHTML = pendingUsers.map((account) => `
    <article class="queue-card">
      <div class="queue-card-head"><div><b>${esc(account.username)}</b><span>${esc(account.email)}</span></div><span class="queue-status">Pending approval</span></div>
      <small>Registered ${timestampDate(account.createdAt)}</small>
      <div class="queue-actions"><button class="approve-button" type="button" data-admin-action="approve-account" data-user="${esc(account.id)}">Approve account</button><button class="reject-button" type="button" data-admin-action="reject-account" data-user="${esc(account.id)}">Reject</button></div>
    </article>`).join('');

  $('pending-deposits').innerHTML = pendingDeposits.map(({ account, request }) => `
    <article class="queue-card">
      <div class="queue-card-head"><div><b>${esc(account.username)} · ${usd(request.amount)}</b><span>${esc(account.email)}</span></div><span class="queue-status">Pending</span></div>
      <small>${esc(NETWORKS[request.network] || request.network)} · ${timestampDate(request.createdAt)}</small>
      <code class="queue-hash">${esc(request.txHash)}</code>
      <div class="queue-actions"><button class="approve-button" type="button" data-admin-action="confirm-deposit" data-user="${esc(account.id)}" data-request="${esc(request.id)}">Confirm deposit</button><button class="reject-button" type="button" data-admin-action="reject-deposit" data-user="${esc(account.id)}" data-request="${esc(request.id)}">Reject</button></div>
    </article>`).join('');

  $('pending-withdrawals').innerHTML = pendingWithdrawals.map(({ account, request }) => `
    <article class="queue-card" data-withdrawal-card="${esc(request.id)}">
      <div class="queue-card-head"><div><b>${esc(account.username)} · ${usd(request.amount)}</b><span>${esc(account.email)}</span></div><span class="queue-status">Pending</span></div>
      <small>${esc(NETWORKS[request.network] || request.network)} · ${timestampDate(request.createdAt)}</small>
      <code class="queue-hash">${esc(request.address)}</code>
      <label class="queue-input-label" for="payout-${esc(request.id)}">External payout hash</label>
      <input class="queue-input" id="payout-${esc(request.id)}" type="text" placeholder="Demo transaction hash">
      <div class="queue-actions"><button class="approve-button" type="button" data-admin-action="complete-withdrawal" data-user="${esc(account.id)}" data-request="${esc(request.id)}">Mark paid</button><button class="reject-button" type="button" data-admin-action="reject-withdrawal" data-user="${esc(account.id)}" data-request="${esc(request.id)}">Reject and refund</button></div>
    </article>`).join('');
}

function renderDailyPrizeOdds() {
  const colors = ['#91d85a', '#68b95d', '#46a579', '#42988e', '#70c994', '#a8e275', '#8cce64', '#5fae78', '#b7e983'];
  const sliceAngle = 360 / DAILY_PRIZES.length;
  const stops = DAILY_PRIZES.map((prize, index) =>
    `${colors[index]} ${index * sliceAngle}deg ${(index + 1) * sliceAngle}deg`,
  );
  $('mystery-wheel').style.background = `conic-gradient(${stops.join(',')})`;
  $('daily-prize-odds').innerHTML = DAILY_PRIZES.map((prize, index) =>
    `<div class="odds-row"><span class="prize-label"><i class="prize-dot" style="--prize-color:${colors[index]}"></i>${prize.points.toLocaleString(LANGUAGE_LOCALES[language])} H9 points</span></div>`,
  ).join('');
}

function updateSpinButton() {
  const today = new Date().toISOString().slice(0, 10);
  const usedDailySpin = current.lastDailyPrizeDate === today;
  const extraSpins = current.bonusSpins || 0;
  $('spin-wheel').disabled = wheelSpinning || (usedDailySpin && extraSpins === 0);
  $('spin-wheel').textContent = usedDailySpin
    ? (extraSpins > 0 ? `${translateText('Use extra spin', language)} · ${extraSpins}` : translateText('Come back tomorrow', language))
    : translateText('Open today’s mystery box', language);
}

function renderRewards() {
  const today = new Date().toISOString().slice(0, 10);
  const inviteUrl = new URL(location.href);
  inviteUrl.hash = '';
  inviteUrl.searchParams.set('ref', current.referralCode || '');
  $('invite-link').value = inviteUrl.href;
  $('h9-points').textContent = (current.h9Points || 0).toLocaleString(LANGUAGE_LOCALES[language]);
  $('extra-spin-count').textContent = (current.bonusSpins || 0).toLocaleString(LANGUAGE_LOCALES[language]);
  $('referral-count').textContent = (current.referrals || []).length.toLocaleString(LANGUAGE_LOCALES[language]);
  updateSpinButton();
  const todaysPrize = (current.dailyPrizes || []).find((prize) =>
    new Date(prize.date).toISOString().slice(0, 10) === today,
  );
  $('wheel-result').textContent = todaysPrize
    ? `${translateText('Today’s prize', language)}: ${todaysPrize.points.toLocaleString(LANGUAGE_LOCALES[language])} H9 points`
    : 'Open one mystery box each day.';
  $('reward-catalog').innerHTML = REWARDS.map((reward) => {
    const detail = reward.type === 'boost'
      ? `${translateText('Double the simulated earnings on active plans for', language)} ${reward.hours} ${translateText(reward.hours === 1 ? 'hour' : 'hours', language)}.`
      : `${translateText('Redeem for', language)} ${usd(reward.amount)} ${translateText('in your demo deposit balance. Real-money payouts are not connected.', language)}`;
    return `<article class="reward-card">
      <h3>${esc(translateText(reward.title, language))}</h3><p>${esc(detail)}</p>
      <span class="reward-cost">${reward.points.toLocaleString(LANGUAGE_LOCALES[language])} H9 points</span>
      <button class="primary-button" type="button" data-buy-reward="${esc(reward.id)}">${translateText('Redeem', language)}</button>
    </article>`;
  }).join('');

  const activeBonuses = (current.activeBonuses || [])
    .filter((bonus) => bonus.expiresAt > Date.now());
  const redemptions = current.rewardRedemptions || [];
  const benefitRows = [
    ...activeBonuses.map((bonus) => {
      const remainingHours = Math.max(1, Math.ceil((bonus.expiresAt - Date.now()) / 3_600_000));
      return `<article class="reward-row"><span><b>${esc(translateText(bonus.title, language))}</b><small>${translateText('Ends', language)} ${timestampDate(bonus.expiresAt)}</small></span><span class="reward-state">2× · ${remainingHours}${translateText('h left', language)}</span></article>`;
    }),
    ...redemptions.map((coupon) =>
      `<article class="reward-row"><span><b>${esc(translateText(coupon.title, language))}</b><small>${translateText('Redeemed', language)} ${timestampDate(coupon.creditedAt || coupon.requestedAt)} · ${translateText(coupon.balanceDestination === 'deposit' ? 'added to demo deposit balance' : 'added to demo earnings', language)}</small></span><span class="reward-state">${translateText('Credited', language)}</span></article>`,
    ),
  ];
  $('active-rewards').innerHTML = benefitRows.join('');
  $('active-rewards-empty').hidden = benefitRows.length > 0;

  $('points-history').innerHTML = (current.pointHistory || []).map((entry) => `
    <article class="points-row">
      <span><b>${esc(entry.label)}</b><small>${timestampDate(entry.date)}</small></span>
      <b class="points-delta ${entry.amount < 0 ? 'spent' : ''}">${entry.amount > 0 ? '+' : ''}${entry.amount.toLocaleString(LANGUAGE_LOCALES[language])}</b>
    </article>`).join('');
  $('points-history-empty').hidden = (current.pointHistory || []).length > 0;
  renderDailyPrizeOdds();
}

function renderFullHistory() {
  const entries = [
    ...(current.transactions || []).map((entry) => ({ kind: 'transaction', date: entry.date || 0, entry })),
    ...(current.pointHistory || []).map((entry) => ({ kind: 'points', date: entry.date || 0, entry })),
  ].sort((a, b) => b.date - a.date);
  $('full-history-list').innerHTML = entries.map(({ kind, entry }) => {
    if (kind === 'transaction') return renderActivity(entry);
    return renderPointActivity(entry);
  }).join('');
  $('full-history-empty').hidden = entries.length > 0;
}

function render() {
  if (!current) return;
  const wallet = current.wallet;
  const locked = current.investments
    .filter((investment) => investment.status === 'active')
    .reduce((sum, investment) => sum + investment.principal, 0);
  $('user-chip').textContent = current.username;
  $('profile-username').textContent = current.username;
  $('profile-email').textContent = current.email;
  $('profile-account-id').textContent = current.id;
  $('profile-avatar').textContent = [...current.username][0].toLocaleUpperCase('it-IT');
  language = LANGUAGES.includes(current.preferences?.language) ? current.preferences.language : 'it';
  $('language-select').value = language;
  $('theme-select').value = current.preferences?.theme || 'dark';
  document.documentElement.lang = language;
  document.documentElement.dataset.theme = $('theme-select').value;
  const linkedWallet = current.withdrawalWallet;
  $('bound-wallet-label').textContent = linkedWallet?.address ? `${NETWORKS[linkedWallet.network] || linkedWallet.network} · ${linkedWallet.address.slice(0, 8)}…${linkedWallet.address.slice(-5)}` : 'No wallet linked';
  $('wallet-network').value = linkedWallet?.network || 'bep20';
  $('wallet-address').value = linkedWallet?.address || '';
  $('open-admin').hidden = current.role !== 'admin';
  $('reset-test-data').hidden = current.role !== 'admin';
  $('total-balance').textContent = usd(balanceTotal());
  $('deposit-balance').textContent = usd(wallet.deposit);
  $('earnings-balance').textContent = usd(wallet.earnings);
  $('locked-balance').textContent = usd(locked);
  $('profile-deposit').textContent = usd(wallet.deposit);
  $('profile-earnings').textContent = usd(wallet.earnings);
  $('withdraw-available').textContent = usd(wallet.earnings);
  $('invest-available').textContent = usd(wallet.deposit);

  const active = current.investments.filter((investment) => investment.status === 'active');
  const ended = current.investments.filter((investment) => investment.status === 'matured');
  $('home-investments').innerHTML = active.slice(0, 3).map((investment) => renderInvestment(investment)).join('');
  $('home-investments-empty').hidden = active.length > 0;
  $('active-investments').innerHTML = active.map((investment) => renderInvestment(investment)).join('');
  $('active-empty').hidden = active.length > 0;
  $('ended-investments').innerHTML = ended.map((investment) => renderInvestment(investment, true)).join('');
  $('ended-empty').hidden = ended.length > 0;
  $('locked-total').textContent = usd(locked);
  $('credited-total').textContent = usd(current.investments.reduce((sum, investment) => sum + investment.earningsCredited, 0));

  const transactions = current.transactions.slice(0, 8);
  $('recent-activity').innerHTML = transactions.map(renderActivity).join('');
  $('activity-empty').hidden = transactions.length > 0;
  const profileHistory = [
    ...(current.transactions || []).map((entry) => ({ kind: 'transaction', date: entry.date || 0, entry })),
    ...(current.pointHistory || []).map((entry) => ({ kind: 'points', date: entry.date || 0, entry })),
  ].sort((a, b) => b.date - a.date);
  $('profile-activity').innerHTML = profileHistory.slice(0, 5).map(({ kind, entry }) =>
    kind === 'transaction' ? renderActivity(entry) : renderPointActivity(entry),
  ).join('');
  $('profile-activity-empty').hidden = profileHistory.length > 0;
  const notificationsSeenAt = current.preferences?.notificationsSeenAt || 0;
  let earningsNotice = readEarningsNoticeState();
  const unreadEarnings = current.transactions.filter((item) =>
    item.type === 'earnings' && (item.date || 0) > notificationsSeenAt,
  );
  if (unreadEarnings.length &&
      Date.now() - (Number(earningsNotice.shownAt) || 0) >= DAY_MS) {
    earningsNotice = {
      shownAt: Date.now(),
      ids: unreadEarnings.map((item) => item.id),
    };
    localStorage.setItem(earningsNoticeKey(), JSON.stringify(earningsNotice));
  }
  const surfacedEarnings = new Set(Array.isArray(earningsNotice.ids) ? earningsNotice.ids : []);
  const notificationTransactions = current.transactions.filter((item) =>
    item.type !== 'earnings' || surfacedEarnings.has(item.id),
  );
  const unreadNotifications = notificationTransactions
    .filter((item) => (item.date || 0) > notificationsSeenAt)
    .slice(0, 12);
  $('notification-list').innerHTML = unreadNotifications.map(renderActivity).join('');
  $('notifications-empty').hidden = unreadNotifications.length > 0;
  const latestNonEarningAt = current.transactions
    .filter((item) => item.type !== 'earnings')
    .reduce((latest, item) => Math.max(latest, item.date || 0), 0);
  const latestActivityAt = Math.max(
    latestNonEarningAt,
    surfacedEarnings.size ? Number(earningsNotice.shownAt) || 0 : 0,
  );
  $('notification-dot').hidden = latestActivityAt <= notificationsSeenAt;
  renderRewards();
  renderFullHistory();
  $('home-plans').innerHTML = PLANS.map((plan) => renderPlan(plan, true)).join('');
  $('catalog-plans').innerHTML = PLANS.map((plan) => renderPlan(plan)).join('');
  updateCompoundSimulator();
  renderAdmin();
  translatePage(language);
}

function setView(name) {
  if (name === 'admin' && current?.role !== 'admin') return;
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${name}`));
  document.querySelectorAll('.nav-item').forEach((button) => {
    const active = button.dataset.tab === name;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function adminAction(action, accountId, requestId, card) {
  if (!current || current.role !== 'admin') return;
  const target = accounts.find((account) => account.id === accountId);
  if (!target) return;
  if (action === 'credit-rewards') {
    const accountCard = document.querySelector(`[data-account-card="${CSS.escape(accountId)}"]`);
    const points = Number(accountCard?.querySelector('[data-credit="points"]')?.value || 0);
    const spins = Number(accountCard?.querySelector('[data-credit="spins"]')?.value || 0);
    if (!Number.isSafeInteger(points) || points < 0 ||
        !Number.isSafeInteger(spins) || spins < 0 || (points === 0 && spins === 0)) {
      toast('Enter a positive whole number of points or extra spins.');
      return;
    }
    try {
      const { account } = await apiRequest('/api/admin/rewards/credit', {
        method: 'POST',
        body: JSON.stringify({ accountId, points, spins }),
      });
      const index = accounts.findIndex((item) => item.id === account.id);
      if (index >= 0) accounts[index] = account;
      if (current.id === account.id) current = account;
      render();
      toast('Points and extra spins credited.');
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  const before = JSON.stringify(accounts);
  let message = '';
  if (action === 'save-account') {
    const accountCard = document.querySelector(`[data-account-card="${CSS.escape(accountId)}"]`);
    const deposit = Number(accountCard?.querySelector('[data-balance="deposit"]')?.value);
    const earnings = Number(accountCard?.querySelector('[data-balance="earnings"]')?.value);
    if (!Number.isFinite(deposit) || !Number.isFinite(earnings) || deposit < 0 || earnings < 0) {
      toast('Enter valid non-negative balances.');
      return;
    }
    target.wallet = { ...target.wallet, deposit, earnings };
    message = `Balances updated for ${target.username}.`;
  } else if (action === 'toggle-account' && target.id !== current.id) {
    target.status = target.status === 'blocked' ? 'approved' : 'blocked';
    message = target.status === 'blocked'
      ? `Account ${target.username} blocked.`
      : `Account ${target.username} unblocked.`;
  } else if (action === 'approve-account' && target.status === 'pending') {
    target.status = 'approved';
    target.approvedAt = Date.now();
    target.reviewedAt = target.approvedAt;
    message = `Account ${target.username} approved.`;
  } else if (action === 'reject-account' && target.status === 'pending') {
    target.status = 'rejected';
    target.reviewedAt = Date.now();
    message = `Account ${target.username} rejected.`;
  } else if (action === 'confirm-deposit') {
    const request = target.depositRequests.find((item) => item.id === requestId && item.status === 'pending');
    if (!request) return;
    request.status = 'confirmed';
    request.reviewedAt = Date.now();
    target.wallet.deposit += request.amount;
    const transaction = target.transactions.find((item) => item.id === request.transactionId);
    if (transaction) transaction.status = 'confirmed';
    message = `Demo deposit of ${usd(request.amount)} confirmed.`;
  } else if (action === 'reject-deposit') {
    const request = target.depositRequests.find((item) => item.id === requestId && item.status === 'pending');
    if (!request) return;
    request.status = 'rejected';
    request.reviewedAt = Date.now();
    const transaction = target.transactions.find((item) => item.id === request.transactionId);
    if (transaction) transaction.status = 'rejected';
    message = 'Demo deposit request rejected.';
  } else if (action === 'complete-withdrawal') {
    const request = target.withdrawalRequests.find((item) => item.id === requestId && item.status === 'pending');
    const payoutHash = card.querySelector('.queue-input')?.value.trim();
    if (!request || !payoutHash) {
      toast('Enter the demo payout hash before marking this withdrawal as paid.');
      return;
    }
    request.status = 'completed';
    request.payoutHash = payoutHash;
    request.reviewedAt = Date.now();
    const transaction = target.transactions.find((item) => item.id === request.transactionId);
    if (transaction) transaction.status = 'completed';
    message = 'Demo withdrawal marked as paid.';
  } else if (action === 'reject-withdrawal') {
    const request = target.withdrawalRequests.find((item) => item.id === requestId && item.status === 'pending');
    if (!request) return;
    request.status = 'rejected';
    request.reviewedAt = Date.now();
    target.wallet.earnings += request.amount;
    for (const allocation of request.compoundAllocations || []) {
      const investment = target.investments.find((item) => item.id === allocation.investmentId);
      if (!investment) continue;
      investment.compoundBalance = (investment.compoundBalance || 0) + allocation.compoundBalance;
      investment.uncompoundedEarnings = (investment.uncompoundedEarnings || 0) + allocation.uncompoundedEarnings;
    }
    const transaction = target.transactions.find((item) => item.id === request.transactionId);
    if (transaction) transaction.status = 'rejected';
    message = `Request rejected; ${usd(request.amount)} returned to your earnings balance.`;
  }
  if (!message) return;
  if (!await saveAccounts(target)) {
    accounts = JSON.parse(before);
    current = accounts.find((account) => account.id === current.id) || current;
    render();
    return;
  }
  current = accounts.find((account) => account.id === current.id) || current;
  render();
  toast(message);
}

function openPlan(id) {
  selectedPlan = PLANS.find((plan) => plan.id === id);
  if (!selectedPlan) return;
  $('plan-dialog-title').textContent = selectedPlan.name;
  $('plan-terms').textContent = `${selectedPlan.days} ${translateText('days', language)} · ${selectedPlan.rate.toLocaleString(LANGUAGE_LOCALES[language])}% ${translateText('/ day', language)} · ${translateText('Unwithdrawn earnings compound daily', language)}.`;
  $('invest-amount').value = '';
  $('plan-estimate').textContent = 'Estimated total return: 0.00 USDT';
  setError('plan-error');
  $('plan-dialog').showModal();
}

async function registerAccount(event) {
  event.preventDefault();
  setError('register-error');
  const submitButton = event.currentTarget.querySelector('[type="submit"]');
  if (submitButton.disabled) return;
  const username = $('register-username').value.trim();
  const email = $('register-email').value.trim().toLowerCase();
  const password = $('register-password').value;
  if (password !== $('register-confirm').value) {
    setError('register-error', 'Passwords do not match.');
    return;
  }
  submitButton.disabled = true;
  try {
  const result = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password, referralCode: $('register-referral').value.trim() }),
    });
    accessToken = result.token;
    sessionStorage.setItem(SESSION_KEY, accessToken);
    accounts = [result.account];
    $('register-form').reset();
    openApp(result.account);
    toast('Your account is ready.');
  } catch (error) {
    setError('register-error', error.message);
    return;
  } finally {
    submitButton.disabled = false;
  }
}

async function login(event) {
  event.preventDefault();
  setError('login-error');
  const submitButton = event.currentTarget.querySelector('[type="submit"]');
  if (submitButton.disabled) return;
  submitButton.disabled = true;
  const email = $('login-email').value.trim().toLowerCase();
  const password = $('login-password').value;
  try {
    const result = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    accessToken = result.token;
    sessionStorage.setItem(SESSION_KEY, accessToken);
    accounts = [result.account];
    openApp(result.account);
  } catch (error) {
    setError('login-error', error.message);
    return;
  } finally {
    submitButton.disabled = false;
  }
}

async function addDeposit(event) {
  event.preventDefault();
  setError('deposit-error');
  const amount = Number($('deposit-amount').value);
  const txHash = $('deposit-txhash').value.trim();
  if (!Number.isFinite(amount) || amount <= 0) {
    setError('deposit-error', 'Enter a valid amount.');
    return;
  }
  if (!txHash) {
    setError('deposit-error', 'Enter the transaction hash for review.');
    return;
  }
  try {
    const result = await apiRequest('/api/deposits', {
      method: 'POST',
      body: JSON.stringify({ amount, network: $('deposit-network').value, txHash }),
    });
    applyAccount(result.account);
    $('deposit-dialog').close();
    $('deposit-form').reset();
    toast('Request submitted for admin review.');
  } catch (error) {
    setError('deposit-error', error.message);
    return;
  }
}

async function addWithdrawal(event) {
  event.preventDefault();
  setError('withdraw-error');
  const amount = Number($('withdraw-amount').value);
  const address = $('withdraw-address').value.trim();
  if (!Number.isFinite(amount) || amount <= 0 || amount > current.wallet.earnings) {
    setError('withdraw-error', `Enter a valid amount. Available: ${usd(current.wallet.earnings)}.`);
    return;
  }
  if (!address) {
    setError('withdraw-error', 'Enter a destination address.');
    return;
  }
  try {
    const result = await apiRequest('/api/withdrawals', {
      method: 'POST',
      body: JSON.stringify({ amount, network: $('withdraw-network').value, address }),
    });
    applyAccount(result.account);
    $('withdraw-dialog').close();
    $('withdraw-form').reset();
    toast('Demo withdrawal submitted for review.');
  } catch (error) {
    setError('withdraw-error', error.message);
    return;
  }
}

async function startInvestment(event) {
  event.preventDefault();
  if (!selectedPlan) return;
  setError('plan-error');
  const amount = Number($('invest-amount').value);
  if (!Number.isFinite(amount) || amount <= 0) {
    setError('plan-error', 'Enter an amount greater than zero.');
    return;
  }
  if (amount > current.wallet.deposit) {
    setError('plan-error', 'Insufficient deposit balance. Add demo funds first.');
    return;
  }
  try {
    const result = await apiRequest('/api/investments', {
      method: 'POST',
      body: JSON.stringify({ amount, planId: selectedPlan.id }),
    });
    applyAccount(result.account);
  } catch (error) {
    setError('plan-error', error.message);
    return;
  }
  $('plan-dialog').close();
  $('plan-form').reset();
  setView('investments');
  toast('Demo plan activated. Your capital is now locked.');
}

async function purchaseReward(button) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    const { account } = await apiRequest('/api/rewards/purchase', {
      method: 'POST',
      body: JSON.stringify({ rewardId: button.dataset.buyReward }),
    });
    applyAccount(account);
    toast('Reward redeemed with H9 points.');
  } catch (error) {
    toast(error.message);
    button.disabled = false;
  }
}

async function spinDailyWheel() {
  const button = $('spin-wheel');
  if (button.disabled || wheelSpinning) return;
  wheelSpinning = true;
  button.disabled = true;
  try {
    const { account, prize } = await apiRequest('/api/rewards/spin', { method: 'POST' });
    applyAccount(account);
    const prizeIndex = DAILY_PRIZES.findIndex((item) => item.id === prize.id);
    const targetAngle = (prizeIndex + 0.5) * (360 / DAILY_PRIZES.length);
    const finalRotation = 5 * 360 + ((360 - targetAngle) % 360);
    const wheel = $('mystery-wheel');
    wheel.style.transition = 'none';
    wheel.style.transform = 'rotate(0deg)';
    wheel.offsetWidth;
    wheel.style.transition = '';
    wheel.style.transform = `rotate(${finalRotation}deg)`;
    window.setTimeout(() => {
      $('wheel-result').textContent = `${translateText('You won', language)} ${prize.points.toLocaleString(LANGUAGE_LOCALES[language])} H9 points.`;
      wheelSpinning = false;
      updateSpinButton();
      toast('H9 points added to your account.');
    }, 4100);
  } catch (error) {
    wheelSpinning = false;
    updateSpinButton();
    toast(error.message);
  }
}

document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => setView(button.dataset.tab)));
document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.go)));
document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', async () => {
  const dialog = $(button.dataset.open);
  setError(dialog.id === 'deposit-dialog' ? 'deposit-error' : 'withdraw-error');
  if (dialog.id === 'withdraw-dialog') {
    if (!await refreshAccount() || !current) return;
    $('withdraw-amount').value = '';
    $('withdraw-address').value = current.withdrawalWallet?.address || '';
    $('withdraw-network').value = current.withdrawalWallet?.network || 'bep20';
  }
  dialog.showModal();
}));
document.addEventListener('click', (event) => {
  const planButton = event.target.closest('[data-plan-details]');
  const planCard = event.target.closest('[data-plan-card]');
  if (planButton) showPlanDetails(planButton.dataset.planDetails);
  else if (planCard) showPlanDetails(planCard.dataset.planCard);
  const investmentCard = event.target.closest('[data-investment-detail]');
  if (investmentCard) showInvestmentDetails(investmentCard.dataset.investmentDetail);
  const closeButton = event.target.closest('[data-close]');
  if (closeButton) $(closeButton.dataset.close).close();
  const rewardButton = event.target.closest('[data-buy-reward]');
  if (rewardButton) purchaseReward(rewardButton);
  const adminButton = event.target.closest('[data-admin-action]');
  if (adminButton) {
    const card = adminButton.closest('.queue-card');
    adminAction(
      adminButton.dataset.adminAction,
      adminButton.dataset.user,
      adminButton.dataset.request,
      card,
    );
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const investmentCard = event.target.closest('[data-investment-detail]');
  if (!investmentCard) return;
  event.preventDefault();
  showInvestmentDetails(investmentCard.dataset.investmentDetail);
});
$('details-invest-button').addEventListener('click', () => {
  const planId = selectedPlan?.id;
  $('details-dialog').close();
  if (planId) openPlan(planId);
});
$('show-login').addEventListener('click', () => showAuthMode('login'));
$('show-register').addEventListener('click', () => showAuthMode('register'));
$('register-form').addEventListener('submit', registerAccount);
$('login-form').addEventListener('submit', login);
$('deposit-form').addEventListener('submit', addDeposit);
$('withdraw-form').addEventListener('submit', addWithdrawal);
$('plan-form').addEventListener('submit', startInvestment);
['compound-principal', 'compound-rate', 'compound-days'].forEach((id) => {
  $(id).addEventListener('input', updateCompoundSimulator);
});
$('copy-invite-link').addEventListener('click', async () => {
  const link = $('invite-link').value;
  try {
    await navigator.clipboard.writeText(link);
    toast('Invitation link copied.');
  } catch {
    $('invite-link').select();
    document.execCommand('copy');
    toast('Invitation link copied.');
  }
});
$('spin-wheel').addEventListener('click', spinDailyWheel);
$('open-notifications').addEventListener('click', async () => {
  $('notifications-dialog').showModal();
  const latestActivityAt = current.transactions.reduce((latest, item) => Math.max(latest, item.date || 0), 0);
  const earningsNotice = readEarningsNoticeState();
  earningsNotice.ids = [];
  localStorage.setItem(earningsNoticeKey(), JSON.stringify(earningsNotice));
  current.preferences = { ...(current.preferences || {}), notificationsSeenAt: latestActivityAt };
  $('notification-dot').hidden = true;
  await saveAccounts(current);
});
$('profile-history-open').addEventListener('click', () => $('history-dialog').showModal());
$('edit-wallet-button').addEventListener('click', () => $('wallet-dialog').showModal());
$('change-password-button').addEventListener('click', () => {
  setError('password-error');
  $('password-form').reset();
  $('password-dialog').showModal();
});
$('wallet-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const address = $('wallet-address').value.trim();
  if (!address) return;
  const previous = current.withdrawalWallet;
  current.withdrawalWallet = { network: $('wallet-network').value, address };
  if (!await saveAccounts(current)) {
    current.withdrawalWallet = previous;
    return;
  }
  $('wallet-dialog').close();
  render();
  toast('Withdrawal wallet saved for this demo.');
});
$('password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  setError('password-error');
  const newPassword = $('new-password').value;
  if (newPassword !== $('confirm-new-password').value) {
    setError('password-error', 'New passwords do not match.');
    return;
  }
  try {
    const { account } = await apiRequest('/api/auth/password', {
      method: 'PUT',
      body: JSON.stringify({
        currentPassword: $('current-password').value,
        newPassword,
      }),
    });
    Object.assign(current, account);
    $('password-dialog').close();
    $('password-form').reset();
    toast('Password updated in the browser demo.');
  } catch (error) {
    setError('password-error', error.message);
  }
});
$('language-select').addEventListener('change', async (event) => {
  const previous = current.preferences?.language || 'it';
  current.preferences = { ...(current.preferences || {}), language: event.target.value };
  if (!await saveAccounts(current)) {
    current.preferences.language = previous;
    render();
    return;
  }
  language = event.target.value;
  render();
});
$('theme-select').addEventListener('change', async (event) => {
  const previous = current.preferences?.theme || 'dark';
  current.preferences = { ...(current.preferences || {}), theme: event.target.value };
  document.documentElement.dataset.theme = event.target.value;
  if (!await saveAccounts(current)) {
    current.preferences.theme = previous;
    render();
    return;
  }
  render();
});
$('invest-amount').addEventListener('input', () => {
  const amount = Number($('invest-amount').value) || 0;
  const gain = estimatedPlanGain(amount, selectedPlan);
  $('plan-estimate').textContent = `Estimated total return: ${usd(gain)}`;
});
$('refresh-account').addEventListener('click', () => {
  refreshAccount();
});
$('home-link').addEventListener('click', (event) => {
  event.preventDefault();
  setView('home');
});
$('open-admin').addEventListener('click', () => setView('admin'));
$('logout-button').addEventListener('click', signOut);
$('reset-test-data').addEventListener('click', () => {
  if (!current || current.role !== 'admin') return;
  if (!confirm('Delete all demo accounts and activity saved in this browser?')) return;
  apiRequest('/api/admin/accounts', { method: 'DELETE' }).then(() => signOut()).catch((error) => toast(error.message));
});
document.addEventListener('touchstart', (event) => {
  const target = event.target;
  if (!current || window.scrollY > 0 || event.touches.length !== 1 ||
      target.closest('input, textarea, select, button, a, dialog[open], [contenteditable="true"]')) {
    pullStartY = null;
    return;
  }
  pullStartY = event.touches[0].clientY;
}, { passive: true });
document.addEventListener('touchend', (event) => {
  if (pullStartY === null) return;
  const pulledDistance = event.changedTouches[0].clientY - pullStartY;
  pullStartY = null;
  if (current && window.scrollY <= 0 && pulledDistance >= 80 &&
      !document.querySelector('dialog[open]')) {
    refreshAccount();
  }
}, { passive: true });
document.addEventListener('touchcancel', () => {
  pullStartY = null;
}, { passive: true });
document.querySelectorAll('.modal').forEach((dialog) => dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
}));

resumeSession();
setInterval(() => {
  if (!current || document.hidden) return;
  refreshAccount();
}, 60_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && current) {
    refreshAccount();
  }
});
translatePage('it');
$('register-referral').value = new URLSearchParams(location.search).get('ref') || '';
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
