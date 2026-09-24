import { api, hideAlert, showAlert } from './api.js';
import { clear, el, label, pill } from './dom.js';

const state = {
  status: '',
  q: '',
  page: 1,
  selectedId: null,
  campaignId: '',
};

const whoami = document.getElementById('whoami');
const summary = document.getElementById('summary');
const clientTable = document.getElementById('client-table');
const clientDetails = document.getElementById('client-details');
const poolAlert = document.getElementById('pool-alert');
const importAlert = document.getElementById('import-alert');
const campaignAlert = document.getElementById('campaign-alert');
const campaignFilter = document.getElementById('campaign-filter');
const resultsAlert = document.getElementById('results-alert');
const resultsCampaign = document.getElementById('results-campaign');
const resultsSummary = document.getElementById('results-summary');
const resultsBreakdown = document.getElementById('results-breakdown');
const userAlert = document.getElementById('user-alert');
const pageLabel = document.getElementById('page-label');
const mappingForm = document.getElementById('mapping-form');
const mappingFields = document.getElementById('mapping-fields');
const phoneColumns = document.getElementById('phone-columns');
const extraColumns = document.getElementById('extra-columns');
const modalRoot = document.getElementById('modal-root');

function scrollableTable(table) {
  return el('div', { class: 'table-scroll' }, [table]);
}

function dataCell(label, attrs = {}, children = []) {
  return el('td', { ...attrs, 'data-label': label }, children);
}

document.getElementById('logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});

document.querySelectorAll('.nav-btn').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    const view = button.dataset.view;
    document.getElementById('view-pool').classList.toggle('hidden', view !== 'pool');
    document.getElementById('view-campaigns').classList.toggle('hidden', view !== 'campaigns');
    document.getElementById('view-results').classList.toggle('hidden', view !== 'results');
    document.getElementById('view-import').classList.toggle('hidden', view !== 'import');
    document.getElementById('view-users').classList.toggle('hidden', view !== 'users');
    if (view === 'users') loadUsers();
    if (view === 'pool') loadPool();
    if (view === 'campaigns') loadCampaigns();
    if (view === 'results') loadResults();
  });
});

resultsCampaign.addEventListener('change', () => {
  state.campaignId = resultsCampaign.value;
  loadResults();
});

campaignFilter.addEventListener('change', () => {
  state.campaignId = campaignFilter.value;
  state.page = 1;
  state.selectedId = null;
  clientDetails.classList.add('hidden');
  loadPool();
});

document.querySelectorAll('.filter-btn').forEach((button) => {
  button.addEventListener('click', () => {
    state.status = button.dataset.status;
    state.page = 1;
    loadPool();
  });
});

document.getElementById('client-search').addEventListener('change', (event) => {
  state.q = event.target.value.trim();
  state.page = 1;
  loadPool();
});

document.getElementById('prev-page').addEventListener('click', () => {
  state.page = Math.max(1, state.page - 1);
  loadPool();
});
document.getElementById('next-page').addEventListener('click', () => {
  state.page += 1;
  loadPool();
});

document.getElementById('preview-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert(importAlert);
  const form = new FormData(event.currentTarget);
  try {
    const preview = await api('/api/admin/import/preview', { method: 'POST', body: form });
    renderMapping(preview);
    showAlert(importAlert, `${preview.rowCount} filas listas. Confirma el mapeo y luego importa.`, 'info');
  } catch (error) {
    showAlert(importAlert, error.message);
  }
});

mappingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert(importAlert);
  const selectedPhones = [...phoneColumns.querySelectorAll('input:checked')].map((input) => input.value);
  const extra = [...extraColumns.querySelectorAll('input:checked')].map((input) => input.value);
  try {
    const result = await api('/api/admin/import/commit', {
      method: 'POST',
      body: {
        name: document.getElementById('campaign-name').value,
        mapping: {
          name: document.getElementById('map-name').value || null,
          external_id: document.getElementById('map-external').value || null,
          phones: selectedPhones,
          extra,
        },
      },
    });
    mappingForm.classList.add('hidden');
    const activeNote = result.campaign?.active
      ? 'Quedó activa.'
      : 'Quedó inactiva hasta que la actives.';
    showAlert(
      importAlert,
      `Campaña ${result.campaign?.name || ''}. Importados: ${result.summary.imported}. Teléfonos agregados: ${result.summary.phonesAdded || 0}. Duplicados omitidos: ${result.summary.skippedDuplicate}. Sin teléfono: ${result.summary.skippedNoPhone}. ${activeNote}`,
      'ok'
    );
    state.campaignId = result.campaign?.id ? String(result.campaign.id) : state.campaignId;
    loadPool();
  } catch (error) {
    showAlert(importAlert, error.message);
  }
});

document.getElementById('create-user').addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert(userAlert);
  const formEl = event.currentTarget;
  const form = new FormData(formEl);
  try {
    await api('/api/admin/users', {
      method: 'POST',
      body: {
        name: form.get('name'),
        username: form.get('username'),
        password: form.get('password'),
        role: form.get('role'),
      },
    });
    formEl.reset();
    showAlert(userAlert, 'Usuario creado.', 'ok');
    loadUsers();
  } catch (error) {
    showAlert(userAlert, error.message);
  }
});

function optionList(headers, selected) {
  return [
    el('option', { value: '', text: '— ninguna —' }),
    ...headers.map((header) =>
      el('option', { value: header, text: header, selected: header === selected })
    ),
  ];
}

function renderMapping(preview) {
  const suggested = preview.suggestedMapping || {};
  clear(mappingFields);
  mappingFields.append(
    el('span', { text: 'Nombre del cliente' }),
    el('select', { id: 'map-name' }, optionList(preview.headers, suggested.name)),
    el('span', { text: 'Identificador del cliente' }),
    el('select', { id: 'map-external' }, optionList(preview.headers, suggested.external_id))
  );

  clear(phoneColumns);
  preview.headers.forEach((header) => {
    const checked = (suggested.phones || []).includes(header);
    phoneColumns.append(
      el('label', { class: 'check' }, [
        el('input', { type: 'checkbox', value: header, checked }),
        header,
      ])
    );
  });

  clear(extraColumns);
  preview.headers.forEach((header) => {
    const checked = (suggested.extra || []).includes(header);
    extraColumns.append(
      el('label', { class: 'check' }, [
        el('input', { type: 'checkbox', value: header, checked }),
        header,
      ])
    );
  });

  const nameInput = document.getElementById('campaign-name');
  const filename = String(preview.filename || 'Campaña').replace(/\.csv$/i, '');
  nameInput.value = filename.slice(0, 120);
  mappingForm.classList.remove('hidden');
}

async function loadCampaignOptions() {
  const { campaigns } = await api('/api/admin/campaigns');
  if (!state.campaignId) {
    const active = campaigns.find((campaign) => campaign.active);
    state.campaignId = active ? String(active.id) : '';
  }
  clear(campaignFilter);
  if (!campaigns.length) {
    campaignFilter.append(el('option', { value: '', text: 'Sin campañas' }));
    return;
  }
  campaigns.forEach((campaign) => {
    campaignFilter.append(
      el('option', {
        value: String(campaign.id),
        text: campaign.active ? `${campaign.name} (activa)` : campaign.name,
        selected: String(campaign.id) === String(state.campaignId),
      })
    );
  });
  if (!campaignFilter.value && campaigns[0]) {
    state.campaignId = String(campaigns[0].id);
    campaignFilter.value = state.campaignId;
  }
}

async function loadCampaigns() {
  hideAlert(campaignAlert);
  const { campaigns } = await api('/api/admin/campaigns');
  const table = el('table', {}, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Campaña' }),
        el('th', { text: 'Estado' }),
        el('th', { text: 'Disponibles' }),
        el('th', { text: 'En curso' }),
        el('th', { text: 'Completados' }),
        el('th', { text: 'Acciones' }),
      ]),
    ]),
  ]);
  const tbody = el('tbody');
  if (!campaigns.length) {
    tbody.append(
      el('tr', {}, [
        el('td', { colspan: '6', class: 'muted', text: 'Todavía no hay campañas. Importa un CSV.' }),
      ])
    );
  }
  campaigns.forEach((campaign) => {
    tbody.append(
      el('tr', {}, [
        dataCell('Campaña', {}, [
          el('strong', { text: campaign.name }),
          el('div', { class: 'muted', text: campaign.created_at || '' }),
        ]),
        dataCell('Estado', { text: campaign.active ? 'Activa' : 'Inactiva' }),
        dataCell('Disponibles', { text: String(campaign.available) }),
        dataCell('En curso', { text: String(campaign.in_progress) }),
        dataCell('Completados', { text: String(campaign.completed) }),
        dataCell('Acciones', {}, [
          el('div', { class: 'row-actions' }, [
            el('button', {
              class: 'btn btn-ghost',
              type: 'button',
              text: 'Resultados',
              onClick: () => openCampaignResults(campaign.id),
            }),
            campaign.active
              ? null
              : el('button', {
                  class: 'btn btn-primary',
                  type: 'button',
                  text: 'Activar',
                  onClick: () => activateCampaign(campaign.id),
                }),
          ]),
        ]),
      ])
    );
  });
  table.append(tbody);
  clear(document.getElementById('campaign-table')).append(scrollableTable(table));
}

function openCampaignResults(id) {
  state.campaignId = String(id);
  document.querySelector('.nav-btn[data-view="results"]').click();
}

function fillCampaignSelect(select, campaigns) {
  clear(select);
  if (!campaigns.length) {
    select.append(el('option', { value: '', text: 'Sin campañas' }));
    return;
  }
  if (!state.campaignId || !campaigns.some((campaign) => String(campaign.id) === String(state.campaignId))) {
    const active = campaigns.find((campaign) => campaign.active);
    state.campaignId = String((active || campaigns[0]).id);
  }
  campaigns.forEach((campaign) => {
    select.append(
      el('option', {
        value: String(campaign.id),
        text: campaign.active ? `${campaign.name} (activa)` : campaign.name,
        selected: String(campaign.id) === String(state.campaignId),
      })
    );
  });
}

async function loadResults() {
  hideAlert(resultsAlert);
  clear(resultsSummary);
  clear(resultsBreakdown);
  try {
    const { campaigns } = await api('/api/admin/campaigns');
    fillCampaignSelect(resultsCampaign, campaigns);
    if (!campaigns.length) {
      resultsBreakdown.append(
        el('p', { class: 'muted', text: 'Todavía no hay campañas. Importa un CSV para ver resultados.' })
      );
      return;
    }

    const data = await api(`/api/admin/campaigns/${state.campaignId}/results`);
    [
      ['Clientes contactados', data.clients.contacted, `de ${data.clients.total} en la campaña`],
      ['Números llamados', data.phones.called, `de ${data.phones.total} en la campaña`],
      ['Llamadas registradas', data.attempts, 'cada resultado elegido'],
    ].forEach(([title, value, note]) => {
      resultsSummary.append(
        el('div', { class: 'stat' }, [
          el('span', { class: 'muted', text: title }),
          el('b', { text: String(value) }),
          el('span', { class: 'stat-note', text: note }),
        ])
      );
    });

    resultsBreakdown.append(el('h2', { text: 'Resultados elegidos' }));
    if (!data.results.length) {
      resultsBreakdown.append(
        el('p', { class: 'muted', text: 'Esta campaña todavía no tiene llamadas registradas.', style: 'margin-top:12px' })
      );
      return;
    }

    const list = el('div', { class: 'result-list' });
    data.results.forEach((item) => {
      const share = data.attempts ? Math.round((item.count / data.attempts) * 100) : 0;
      list.append(
        el('div', {}, [
          el('div', { class: 'result-meta' }, [
            el('span', { text: label(item.result) }),
            el('strong', { text: `${item.count} · ${share}%` }),
          ]),
          el('div', { class: 'result-track' }, [
            el('div', { class: 'result-fill', style: `width:${share}%` }),
          ]),
        ])
      );
    });
    resultsBreakdown.append(list);
  } catch (error) {
    showAlert(resultsAlert, error.message);
  }
}

async function activateCampaign(id) {
  hideAlert(campaignAlert);
  try {
    const result = await api(`/api/admin/campaigns/${id}/activate`, { method: 'POST' });
    showAlert(campaignAlert, `${result.campaign.name} quedó activa.`, 'ok');
    state.campaignId = String(id);
    await loadCampaigns();
    await loadPool();
  } catch (error) {
    showAlert(campaignAlert, error.message);
  }
}

async function loadPool() {
  hideAlert(poolAlert);
  await loadCampaignOptions();
  const pageSize = window.matchMedia('(max-width: 640px)').matches ? 10 : 50;
  const query = new URLSearchParams({
    status: state.status,
    q: state.q,
    page: String(state.page),
    pageSize: String(pageSize),
    campaignId: state.campaignId,
  });
  const [counts, list] = await Promise.all([
    api('/api/admin/clients/summary'),
    api(`/api/admin/clients?${query}`),
  ]);

  clear(summary);
  [
    ['Total de clientes', counts.total],
    ['Disponibles', counts.available],
    ['En curso', counts.in_progress],
    ['Completados', counts.completed],
  ].forEach(([label, value]) => {
    summary.append(el('div', { class: 'stat' }, [el('span', { class: 'muted', text: label }), el('b', { text: String(value) })]));
  });

  const maxPage = Math.max(1, Math.ceil(list.total / list.pageSize));
  if (state.page > maxPage) {
    state.page = maxPage;
    return loadPool();
  }
  pageLabel.textContent = `Página ${list.page} de ${maxPage} · ${list.total} clientes`;

  const table = el('table', {}, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Cliente' }),
        el('th', { text: 'Estado' }),
        el('th', { text: 'Asesor' }),
        el('th', { text: 'Asignado' }),
        el('th', { text: 'Números' }),
      ]),
    ]),
  ]);
  const tbody = el('tbody');
  list.rows.forEach((row) => {
    const tr = el('tr', {}, [
      dataCell('Cliente', {}, [
        el('strong', { text: row.name }),
        row.external_id ? el('div', { class: 'muted mono', text: row.external_id }) : null,
      ]),
      dataCell('Estado', {}, [pill(row.status)]),
      dataCell('Asesor', { text: row.advisor_name || '—' }),
      dataCell('Asignado', { class: 'muted', text: row.assigned_at || '—' }),
      dataCell('Números', { text: `${row.phone_done} / ${row.phone_total}` }),
    ]);
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => loadClient(row.id));
    tbody.append(tr);
  });
  table.append(tbody);
  clear(clientTable).append(scrollableTable(table));
}

async function loadClient(id) {
  state.selectedId = id;
  const { client } = await api(`/api/admin/clients/${id}`);
  clear(clientDetails);
  clientDetails.classList.remove('hidden');

  const extraItems = Object.entries(client.extra || {}).map(([key, value]) =>
    el('div', {}, [el('span', { class: 'muted', text: `${key}: ` }), String(value)])
  );

  const phones = el('table', {}, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Número' }),
        el('th', { text: 'Estado' }),
        el('th', { text: 'Último resultado' }),
        el('th', { text: 'Último intento' }),
      ]),
    ]),
    el(
      'tbody',
      {},
      client.phones.map((phone) =>
        el('tr', {}, [
          dataCell('Número', { class: 'mono', text: phone.number }),
          dataCell('Estado', {}, [pill(phone.status)]),
          dataCell('Último resultado', { text: label(phone.last_result) || '—' }),
          dataCell('Último intento', { class: 'muted', text: phone.last_attempt_at || '—' }),
        ])
      )
    ),
  ]);

  const attempts = el('table', {}, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Cuándo' }),
        el('th', { text: 'Número' }),
        el('th', { text: 'Asesor' }),
        el('th', { text: 'Resultado' }),
        el('th', { text: 'Notas' }),
      ]),
    ]),
    el(
      'tbody',
      {},
      client.attempts.length
        ? client.attempts.map((attempt) =>
            el('tr', {}, [
              dataCell('Cuándo', { class: 'muted', text: attempt.attempted_at }),
              dataCell('Número', { class: 'mono', text: attempt.phone_number }),
              dataCell('Asesor', { text: attempt.advisor_name }),
              dataCell('Resultado', { text: label(attempt.result) }),
              dataCell('Notas', { text: attempt.notes || '' }),
            ])
          )
        : [el('tr', {}, [el('td', { colspan: '5', class: 'muted', text: 'Todavía no hay intentos de llamada.' })])]
    ),
  ]);

  clientDetails.append(
    el('div', { class: 'topbar' }, [
      el('div', {}, [
        el('div', { class: 'eyebrow', text: 'Detalle del cliente' }),
        el('h2', { text: client.name }),
      ]),
      client.status === 'in_progress'
        ? el('button', {
            class: 'btn btn-danger',
            type: 'button',
            text: 'Devolver al pool',
            onClick: () => returnToPool(client.id),
          })
        : null,
    ]),
    el('div', { class: 'meta-grid' }, [
      client.campaign?.name ? el('span', { text: client.campaign.name }) : null,
      pill(client.status),
      el('span', { text: client.advisor ? `Asesor: ${client.advisor.name}` : 'Sin asignar' }),
      client.assigned_at ? el('span', { text: `Asignado: ${client.assigned_at}` }) : null,
      el('span', { text: `Números: ${client.progress.completed} / ${client.progress.total}` }),
    ]),
    extraItems.length ? el('div', { class: 'stack', style: 'margin-bottom:16px' }, extraItems) : null,
    el('h3', { text: 'Teléfonos', style: 'margin:12px 0' }),
    scrollableTable(phones),
    el('h3', { text: 'Historial de llamadas', style: 'margin:18px 0 12px' }),
    scrollableTable(attempts)
  );
}

async function returnToPool(id) {
  hideAlert(poolAlert);
  try {
    await api(`/api/admin/clients/${id}/return-to-pool`, { method: 'POST' });
    showAlert(poolAlert, 'Cliente devuelto al pool disponible.', 'ok');
    await loadPool();
    await loadClient(id);
  } catch (error) {
    showAlert(poolAlert, error.message);
  }
}

async function loadUsers() {
  const { users } = await api('/api/admin/users');
  const table = el('table', {}, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Nombre' }),
        el('th', { text: 'Usuario' }),
        el('th', { text: 'Rol' }),
        el('th', { text: 'Estado' }),
        el('th', { text: 'Acciones' }),
      ]),
    ]),
  ]);
  const tbody = el('tbody');
  users.forEach((user) => {
    tbody.append(
      el('tr', {}, [
        dataCell('Nombre', { text: user.name }),
        dataCell('Usuario', { class: 'mono', text: user.username }),
        dataCell('Rol', { text: label(user.role) }),
        dataCell('Estado', { text: user.active ? 'Activo' : 'Desactivado' }),
        dataCell('Acciones', {}, [
          el('div', { class: 'row-actions' }, [
            el('button', {
              class: 'btn btn-ghost',
              type: 'button',
              text: user.active ? 'Desactivar' : 'Activar',
              onClick: () => toggleUser(user),
            }),
            el('button', {
              class: 'btn btn-ghost',
              type: 'button',
              text: 'Restablecer contraseña',
              onClick: () => resetPassword(user),
            }),
          ]),
        ]),
      ])
    );
  });
  table.append(tbody);
  clear(document.getElementById('users-table')).append(el('h2', { text: 'Cuentas' }), scrollableTable(table));
}

async function toggleUser(user) {
  await api(`/api/admin/users/${user.id}`, {
    method: 'PATCH',
    body: { active: !user.active },
  });
  loadUsers();
}

function resetPassword(user) {
  clear(modalRoot);
  const password = el('input', { type: 'password', minlength: '8' });
  const alertBox = el('div', { class: 'alert hidden' });
  const modal = el('div', { class: 'modal-back' }, [
    el('div', { class: 'modal stack' }, [
      el('h2', { text: `Restablecer contraseña de ${user.username}` }),
      el('label', { class: 'field' }, [el('span', { text: 'Nueva contraseña' }), password]),
      alertBox,
      el('div', { class: 'row-actions' }, [
        el('button', {
          class: 'btn btn-primary',
          type: 'button',
          text: 'Guardar contraseña',
          onClick: async () => {
            try {
              await api(`/api/admin/users/${user.id}`, {
                method: 'PATCH',
                body: { password: password.value },
              });
              clear(modalRoot);
            } catch (error) {
              showAlert(alertBox, error.message);
            }
          },
        }),
        el('button', {
          class: 'btn btn-ghost',
          type: 'button',
          text: 'Cancelar',
          onClick: () => clear(modalRoot),
        }),
      ]),
    ]),
  ]);
  modalRoot.append(modal);
}

async function init() {
  const { user } = await api('/api/me');
  whoami.textContent = `${user.name} · ${user.username}`;
  await loadPool();
}

init().catch(() => {
  window.location.href = '/login';
});
