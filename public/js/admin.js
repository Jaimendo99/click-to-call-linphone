import { api, hideAlert, showAlert } from './api.js';
import { clear, el, label, pill } from './dom.js';

const state = {
  status: '',
  q: '',
  page: 1,
  selectedId: null,
};

const whoami = document.getElementById('whoami');
const summary = document.getElementById('summary');
const clientTable = document.getElementById('client-table');
const clientDetails = document.getElementById('client-details');
const poolAlert = document.getElementById('pool-alert');
const importAlert = document.getElementById('import-alert');
const userAlert = document.getElementById('user-alert');
const pageLabel = document.getElementById('page-label');
const mappingForm = document.getElementById('mapping-form');
const mappingFields = document.getElementById('mapping-fields');
const phoneColumns = document.getElementById('phone-columns');
const extraColumns = document.getElementById('extra-columns');
const modalRoot = document.getElementById('modal-root');

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
    document.getElementById('view-import').classList.toggle('hidden', view !== 'import');
    document.getElementById('view-users').classList.toggle('hidden', view !== 'users');
    if (view === 'users') loadUsers();
    if (view === 'pool') loadPool();
  });
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
        mapping: {
          name: document.getElementById('map-name').value || null,
          external_id: document.getElementById('map-external').value || null,
          phones: selectedPhones,
          extra,
        },
      },
    });
    mappingForm.classList.add('hidden');
    showAlert(
      importAlert,
      `Importados: ${result.summary.imported}. Duplicados omitidos: ${result.summary.skippedDuplicate}. Sin teléfono: ${result.summary.skippedNoPhone}.`,
      'ok'
    );
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

  mappingForm.classList.remove('hidden');
}

async function loadPool() {
  hideAlert(poolAlert);
  const query = new URLSearchParams({
    status: state.status,
    q: state.q,
    page: String(state.page),
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
      el('td', {}, [
        el('strong', { text: row.name }),
        row.external_id ? el('div', { class: 'muted mono', text: row.external_id }) : null,
      ]),
      el('td', {}, [pill(row.status)]),
      el('td', { text: row.advisor_name || '—' }),
      el('td', { class: 'muted', text: row.assigned_at || '—' }),
      el('td', { text: `${row.phone_done} / ${row.phone_total}` }),
    ]);
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => loadClient(row.id));
    tbody.append(tr);
  });
  table.append(tbody);
  clear(clientTable).append(table);
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
          el('td', { class: 'mono', text: phone.number }),
          el('td', {}, [pill(phone.status)]),
          el('td', { text: label(phone.last_result) || '—' }),
          el('td', { class: 'muted', text: phone.last_attempt_at || '—' }),
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
              el('td', { class: 'muted', text: attempt.attempted_at }),
              el('td', { class: 'mono', text: attempt.phone_number }),
              el('td', { text: attempt.advisor_name }),
              el('td', { text: label(attempt.result) }),
              el('td', { text: attempt.notes || '' }),
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
      pill(client.status),
      el('span', { text: client.advisor ? `Asesor: ${client.advisor.name}` : 'Sin asignar' }),
      client.assigned_at ? el('span', { text: `Asignado: ${client.assigned_at}` }) : null,
      el('span', { text: `Números: ${client.progress.completed} / ${client.progress.total}` }),
    ]),
    extraItems.length ? el('div', { class: 'stack', style: 'margin-bottom:16px' }, extraItems) : null,
    el('h3', { text: 'Teléfonos', style: 'margin:12px 0' }),
    phones,
    el('h3', { text: 'Historial de llamadas', style: 'margin:18px 0 12px' }),
    attempts
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
        el('th', { text: '' }),
      ]),
    ]),
  ]);
  const tbody = el('tbody');
  users.forEach((user) => {
    tbody.append(
      el('tr', {}, [
        el('td', { text: user.name }),
        el('td', { class: 'mono', text: user.username }),
        el('td', { text: label(user.role) }),
        el('td', { text: user.active ? 'Activo' : 'Desactivado' }),
        el('td', { class: 'row-actions' }, [
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
      ])
    );
  });
  table.append(tbody);
  clear(document.getElementById('users-table')).append(el('h2', { text: 'Cuentas' }), table);
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
