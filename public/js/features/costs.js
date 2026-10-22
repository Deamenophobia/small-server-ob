import { $, escape as esc } from '../core/dom.js';
const money = (amount, currency = 'USD') =>
  new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
let context;

export function initializeCosts(options) {
  context = options;
  document.addEventListener('click', (event) => {
    const costButton = event.target.closest('[data-cost-id]');
    if (costButton) openCostEditor(costButton.dataset.costId);
    if (event.target.closest('[data-billing-guide]')) $('#billing-dialog').showModal();
  });
  $('#cost-form').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const raw = form.elements.amount.value;
    const cost =
      raw === ''
        ? null
        : {
            amount: Number(raw),
            period: form.elements.period.value,
            currency: form.elements.currency.value,
            basis: form.elements.basis.value,
            sourceUrl: form.elements.sourceUrl.value,
          };
    $('#save-cost').disabled = true;
    try {
      await context.api(`/api/servers/${form.elements.id.value}/cost`, { method: 'PUT', data: { cost } });
      $('#cost-dialog').close();
      await context.refresh();
      context.notify(cost ? 'Cost estimate saved locally.' : 'Cost estimate cleared.');
    } catch (error) {
      $('#cost-error').textContent = error.message;
      $('#cost-error').hidden = false;
    } finally {
      $('#save-cost').disabled = false;
    }
  };
  $('#refresh-billing').onclick = async () => {
    $('#refresh-billing').disabled = true;
    try {
      const result = await context.api('/api/billing/refresh', { method: 'POST', data: {} });
      const failed = Object.values(result.providers).some((p) => p.status === 'error');
      context.notify(
        failed
          ? 'Some billing sources could not be read. See their status below.'
          : `Billing view refreshed. Recent results are reused for ${result.cacheHours} hours.`,
        failed,
      );
      await context.refresh();
    } catch (error) {
      context.notify(error.message, true);
    } finally {
      $('#refresh-billing').disabled = false;
    }
  };
}
function openCostEditor(id) {
  if (context.isDemo()) return context.notify('Exit preview to set prices for your own servers.');
  const server = context.getState().servers.find((s) => s.id === id);
  if (!server) return;
  const form = $('#cost-form');
  form.reset();
  $('#cost-server-name').textContent = server.name;
  form.elements.id.value = id;
  form.elements.amount.value = server.cost?.amount ?? '';
  form.elements.currency.value = server.cost?.currency ?? 'USD';
  form.elements.period.value = server.cost?.period ?? 'monthly';
  form.elements.basis.value = server.cost?.basis ?? '';
  form.elements.sourceUrl.value = server.cost?.sourceUrl ?? '';
  $('#cost-error').hidden = true;
  $('#cost-dialog').showModal();
}
export function renderCosts(state, demo) {
  const summary = state.costs;
  $('#cost-section').hidden = demo;
  if (demo || !summary) return;
  const month = new Date(`${summary.month}-01T00:00:00Z`).toLocaleDateString('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  $('#cost-month').textContent = month;
  const totals = summary.groups.length
    ? summary.groups.map((g) => `<span>${money(g.amount, g.currency)}</span>`).join('')
    : '<span>—</span>';
  $('#cost-total').innerHTML = totals;
  $('#cost-coverage').textContent =
    `${summary.configured} of ${summary.total} servers priced${summary.configured < summary.total ? ' · incomplete total' : ''}`;
  $('#cost-assumption').textContent =
    `Full-month baseline · ${summary.hours} hours for hourly rates. Pausing monitoring does not stop billing.`;
  $('#cost-provider-totals').innerHTML =
    summary.groups
      .flatMap((g) =>
        g.providers.map(
          (p) => `<div><span>${esc(p.provider)}</span><strong>${money(p.amount, g.currency)}</strong></div>`,
        ),
      )
      .join('') || '<p>Add a rate on each server card to start estimating.</p>';
  const providers = state.billing?.providers || {};
  $('#billing-query-note').textContent = providers.aws?.enabled
    ? `Health checks and estimates never query billing APIs. AWS: USD 0.01 per fresh billing request, only via Refresh billing. Successful results are cached for ${state.billing.cacheHours} hours.`
    : 'AWS billing is off · no Cost Explorer requests. Health checks and saved estimates work independently of billing.';
  $('#refresh-billing').disabled =
    state.billing?.checking || !Object.values(providers).some((p) => p.enabled);
  $('#billing-provider-cards').innerHTML = [
    ['aws', 'AWS', 'https://console.aws.amazon.com/billing/home#/bills'],
    ['digitalocean', 'DigitalOcean', 'https://cloud.digitalocean.com/account/billing'],
  ]
    .map(([key, title, url]) => {
      const provider = providers[key] || { status: 'not_configured' };
      const data = provider.data;
      const status = {
        not_configured: 'Not connected',
        not_fetched: 'Ready to fetch',
        ready: 'Provider data',
        stale: 'Cached · stale',
        error: 'Unavailable',
      }[provider.status];
      return `<article class="billing-provider"><div class="billing-provider-top"><strong>${title}</strong><span class="billing-status ${provider.status}">${status}</span></div><div class="billing-amount">${data ? money(data.monthToDate, data.currency) : '—'}</div><div class="billing-caption">${data ? `Month-to-date usage · ${esc(data.period)}` : 'Month-to-date usage unavailable'}</div>${data?.balance != null ? `<p class="billing-balance">Balance incl. current usage <strong>${money(data.balance, data.currency)}</strong><small>Negative balance means account credit.</small></p>` : ''}<p class="billing-description">${esc(provider.error || (provider.status === 'not_configured' ? 'Connect read-only billing access to see provider-reported charges.' : !data ? 'Use Refresh billing to query this account.' : `${key === 'aws' ? 'Account / organization scope, including services outside this fleet. Not a final invoice.' : 'Whole-account totals, including resources outside this fleet.'} Fetched ${new Date(data.fetchedAt).toLocaleString()}.${data.generatedAt ? ` Provider data as of ${new Date(data.generatedAt).toLocaleString()}.` : ''}`))}</p><div class="billing-links"><button class="text-button" data-billing-guide>Connection guide ↗</button><a href="${url}" target="_blank" rel="noopener noreferrer">Billing console ↗</a></div></article>`;
    })
    .join('');
  for (const card of document.querySelectorAll('.server-card[data-id]')) {
    card.querySelector('.server-cost')?.remove();
    const server = state.servers.find((s) => s.id === card.dataset.id);
    if (!server) continue;
    const cost = server.cost,
      estimate = server.costEstimate;
    const row = document.createElement('div');
    row.className = 'server-cost';
    row.innerHTML = `<div><span class="cost-label">MONTHLY ESTIMATE</span><button class="text-button" data-cost-id="${server.id}" aria-label="${cost ? 'Edit' : 'Set'} cost for ${esc(server.name)}">${estimate ? money(estimate.amount, estimate.currency) + ' <small>✎</small>' : 'Set cost ＋'}</button></div>${cost ? `<p title="${esc(cost.basis)}">${esc(cost.basis || 'Manually entered rate')}${cost.sourceUrl ? ` <a href="${esc(cost.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source ↗</a>` : ''}</p>` : '<p>No rate set · excluded from estimate</p>'}`;
    card.querySelector('.history').before(row);
  }
}
