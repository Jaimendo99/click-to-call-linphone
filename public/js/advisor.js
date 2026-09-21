import { api } from './api.js';
import { clear, el, label, pill } from './dom.js';
import { normalizePhoneNumber } from '/lib/phone.js';
import { callWithLinphone } from './linphone.js';

const stage = document.getElementById('stage');
const whoami = document.getElementById('whoami');

let callResults = [];
let currentClient = null;
let awaitingFeedback = null;
let lastError = null;

document.getElementById('logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});

function extraLines(extra) {
  const preferred = [
    'Direccion',
    'Canton',
    'Parroquia',
    'IDENTIFICACION',
    'deuda_total',
    'cliente_bueno',
    'FECHA_NACIM',
    'company',
    'city',
    'email',
  ];
  const skip = new Set([
    'latitud',
    'longitud',
    'coverage_distance_m',
    'coverage_inside',
    'cov_name',
    'offering_contacto',
    'offering_fijo',
    'servicios_fijo',
    'is_fijo',
  ]);
  const items = [];
  const seen = new Set();
  for (const key of preferred) {
    if (extra[key]) {
      items.push(`${key}: ${extra[key]}`);
      seen.add(key.toLowerCase());
    }
  }
  for (const [key, value] of Object.entries(extra)) {
    const normalized = key.toLowerCase();
    if (seen.has(normalized) || skip.has(normalized) || !value) continue;
    items.push(`${key}: ${value}`);
  }
  return items;
}

function renderEmpty(message) {
  currentClient = null;
  awaitingFeedback = null;
  clear(stage).append(
    el('section', { class: 'empty-state panel' }, [
      el('div', { class: 'eyebrow', text: 'Cola' }),
      el('h1', { class: 'client-name', text: message || 'No hay clientes disponibles.' }),
      el('p', { class: 'muted', text: 'Actualiza o inténtalo de nuevo cuando se importen más clientes.' }),
      el('button', {
        class: 'btn btn-primary',
        type: 'button',
        text: 'Intentar de nuevo',
        style: 'margin-top:16px',
        onClick: () => loadCurrent(),
      }),
    ])
  );
}

function resultOptions() {
  return [
    el('option', { value: '', text: 'Elige un resultado' }),
    ...callResults.map((result) => el('option', { value: result, text: result })),
  ];
}

function renderClient(client, flash) {
  currentClient = client;
  if (
    awaitingFeedback &&
    !client.phones.some((phone) => phone.id === awaitingFeedback && !phone.last_result)
  ) {
    awaitingFeedback = null;
  }

  const extra = extraLines(client.extra || {});
  clear(stage);

  if (flash) {
    stage.append(el('div', { class: 'alert alert-ok', text: flash, style: 'margin-bottom:16px' }));
  }
  if (lastError) {
    stage.append(el('div', { class: 'alert alert-error', text: lastError, style: 'margin-bottom:16px' }));
    lastError = null;
  }

  stage.append(
    el('div', { class: 'eyebrow', text: 'Cliente actual' }),
    el('h1', { class: 'client-name', text: client.name }),
    el('div', { class: 'meta-grid' }, [
      client.external_id ? el('span', { class: 'mono', text: client.external_id }) : null,
      ...extra.map((line) => el('span', { text: line })),
    ]),
    el('div', {
      class: 'progress-line',
      text: `Teléfonos completados: ${client.progress.completed} / ${client.progress.total}`,
    }),
    el(
      'div',
      { class: 'phone-list' },
      client.phones.map((phone, index) => renderPhone(phone, index + 1, client))
    )
  );
}

function renderPhone(phone, index, client) {
  const number = normalizePhoneNumber(phone.number) || phone.number;
  const needsFeedback = awaitingFeedback === phone.id && !phone.last_result;
  const done = Boolean(phone.last_result);
  const card = el('article', { class: `phone-card${needsFeedback ? ' active' : ''}` });

  card.append(
    el('div', { class: 'phone-head' }, [
      el('div', {}, [
        el('div', { class: 'muted', text: `Teléfono ${index}` }),
        el('div', { class: 'phone-number', text: number }),
      ]),
      el('div', { class: 'row-actions' }, [
        pill(done ? phone.status : 'pending'),
        done
          ? null
          : el('button', {
              class: 'btn btn-call',
              type: 'button',
              text: 'Llamar',
              onClick: () => startCall(phone),
            }),
      ]),
    ])
  );

  if (done) {
    card.append(
      el('div', { class: 'muted' }, [
        `Último resultado: ${label(phone.last_result)}`,
        phone.notes ? ` · ${phone.notes}` : '',
      ])
    );
  }

  if (needsFeedback) {
    const select = el('select', {}, resultOptions());
    const notes = el('textarea', { placeholder: 'Nota opcional' });
    const error = el('div', { class: 'alert alert-error hidden' });
    const save = el('button', {
      class: 'btn btn-primary',
      type: 'button',
      text: 'Guardar y continuar',
    });
    save.addEventListener('click', async () => {
      if (!select.value) {
        error.classList.remove('hidden');
        error.textContent = 'Elige un resultado antes de continuar.';
        return;
      }
      save.disabled = true;
      try {
        const response = await api(`/api/advisor/phone-numbers/${phone.id}/attempt`, {
          method: 'POST',
          body: { result: select.value, notes: notes.value },
        });
        awaitingFeedback = null;
        if (!response.client) {
          renderEmpty(response.message);
          return;
        }
        const flash = response.clientCompleted
          ? `${client.name} completado. Se asignó el siguiente cliente.`
          : null;
        renderClient(response.client, flash);
      } catch (err) {
        error.classList.remove('hidden');
        error.textContent = err.message;
        save.disabled = false;
      }
    });
    card.append(
      el('div', { class: 'feedback' }, [
        el('label', { class: 'field' }, [el('span', { text: 'Resultado' }), select]),
        el('label', { class: 'field' }, [el('span', { text: 'Notas' }), notes]),
        error,
        save,
      ])
    );
  }

  return card;
}

function startCall(phone) {
  try {
    callWithLinphone(phone.number);
  } catch (error) {
    lastError = error.message;
  }
  awaitingFeedback = phone.id;
  if (currentClient) renderClient(currentClient);
}

async function loadCurrent() {
  const data = await api('/api/advisor/current-client');
  if (!data.client) {
    renderEmpty(data.message);
    return;
  }
  renderClient(data.client);
}

async function init() {
  const [{ user }, results] = await Promise.all([
    api('/api/me'),
    api('/api/call-results'),
  ]);
  whoami.textContent = user.name;
  callResults = results.results;
  await loadCurrent();
}

init().catch(() => {
  window.location.href = '/login';
});
