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
let queue = { previous: null, remaining: 0 };

document.getElementById('logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});

const STATS = [
  ['IDENTIFICACION', 'Cédula'],
  ['deuda_total', 'Deuda'],
  ['Valor última Factura', 'Última factura'],
  ['Pagado mes anterior ($)', 'Mes anterior'],
  ['cliente_bueno', 'Cliente'],
  ['FECHA_NACIM', 'Nacimiento'],
];

function extraValue(extra, key) {
  const found = Object.entries(extra || {}).find(([name]) => name.toLowerCase() === key.toLowerCase());
  if (!found || found[1] == null || found[1] === '') return '';
  return String(found[1]);
}

function placeLine(extra) {
  const street = extraValue(extra, 'Direccion');
  const where = [extraValue(extra, 'Canton'), extraValue(extra, 'Parroquia')].filter(Boolean).join(', ');
  return [street, where].filter(Boolean).join(' · ');
}

function statEntries(client) {
  const stats = [];
  if (client.external_id) stats.push({ label: 'Cuenta', value: client.external_id });
  for (const [key, title] of STATS) {
    const value = extraValue(client.extra, key);
    if (value) stats.push({ label: title, value });
  }
  return stats;
}

function formatWhen(value) {
  if (!value) return '';
  return String(value).slice(0, 16);
}

function renderEmpty(message) {
  currentClient = null;
  awaitingFeedback = null;
  clear(stage).append(
    el('section', { class: 'empty-state panel' }, [
      el('div', { class: 'eyebrow', text: 'AgenDial' }),
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

function applyQueue(data) {
  queue = {
    previous: data?.previous || null,
    remaining: Number(data?.remaining) || 0,
  };
}

function previousCard() {
  const previous = queue.previous;
  if (!previous) {
    return el('aside', { class: 'margin-note' }, [
      el('div', { class: 'kicker', text: 'Anterior' }),
      el('p', { class: 'margin-quiet', text: 'Este es el primero de tu turno.' }),
    ]);
  }
  return el('aside', { class: 'margin-note' }, [
    el('div', { class: 'kicker', text: 'Anterior' }),
    el('p', { class: 'margin-name', text: previous.name }),
    el('div', { class: 'margin-meta' }, [
      previous.external_id ? el('span', { text: previous.external_id }) : null,
      previous.completed_at ? el('span', { text: formatWhen(previous.completed_at) }) : null,
      el('span', { text: `${previous.phone_done} de ${previous.phone_total} números` }),
    ]),
  ]);
}

function queueArrow() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute(
    'd',
    'M12.6 12L8.7 8.1q-.275-.275-.275-.7t.275-.7t.7-.275t.7.275l4.6 4.6q.15.15.213.325t.062.375t-.062.375t-.213.325l-4.6 4.6q-.275.275-.7.275t-.7-.275t-.275-.7t.275-.7z'
  );
  svg.append(path);
  const wrap = el('div', { class: 'queue-arrow' });
  wrap.append(svg);
  return wrap;
}

function aheadCard() {
  const count = queue.remaining;
  if (!count) {
    return el('aside', { class: 'margin-note margin-ahead' }, [
      el('p', { class: 'margin-quiet', text: 'No queda nadie más en esta campaña.' }),
    ]);
  }
  const noun = count === 1 ? 'sigue en la campaña' : 'siguen en la campaña';
  return el('aside', { class: 'margin-note margin-ahead' }, [
    queueArrow(),
    el('p', { class: 'queue-count', text: String(count) }),
    el('p', { class: 'margin-quiet', text: noun }),
  ]);
}

function renderClient(client, flash) {
  currentClient = client;
  if (
    awaitingFeedback &&
    !client.phones.some((phone) => phone.id === awaitingFeedback && !phone.last_result)
  ) {
    awaitingFeedback = null;
  }

  const stats = statEntries(client);
  const place = placeLine(client.extra);
  clear(stage);

  if (flash) {
    stage.append(el('div', { class: 'alert alert-ok', text: flash, style: 'margin-bottom:16px' }));
  }
  if (lastError) {
    stage.append(el('div', { class: 'alert alert-error', text: lastError, style: 'margin-bottom:16px' }));
    lastError = null;
  }

  stage.append(
    el('div', { class: 'desk' }, [
      previousCard(),
      el('section', { class: 'sheet' }, [
        el('div', { class: 'kicker', text: client.campaign?.name || 'Cliente actual' }),
        el('h1', { class: 'client-name', text: client.name }),
        place ? el('p', { class: 'place', text: place }) : null,
        stats.length
          ? el(
              'dl',
              { class: 'stat-row' },
              stats.map((stat) =>
                el('div', {}, [el('dt', { text: stat.label }), el('dd', { text: stat.value })])
              )
            )
          : null,
        el('div', { class: 'numbers-head' }, [
          el('h2', { text: 'Números' }),
          el('span', { text: `${client.progress.completed} de ${client.progress.total}` }),
        ]),
        el(
          'div',
          { class: 'phone-list' },
          client.phones.map((phone, index) => renderPhone(phone, index + 1, client))
        ),
      ]),
      aheadCard(),
    ])
  );
}

function renderPhone(phone, index, client) {
  const number = normalizePhoneNumber(phone.number) || phone.number;
  const needsFeedback = awaitingFeedback === phone.id && !phone.last_result;
  const done = Boolean(phone.last_result);
  const sourceKey = String(phone.source || '').toLowerCase();
  const card = el('article', { class: `dial${needsFeedback ? ' active' : ''}${done ? ' done' : ''}` });

  card.append(
    el('div', { class: 'dial-main' }, [
      el('div', { class: 'dial-kicker' }, [
        el('span', { text: String(index).padStart(2, '0') }),
        phone.source ? el('span', { class: `tag tag-${sourceKey}`, text: phone.source }) : null,
      ]),
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
        applyQueue(response);
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
  applyQueue(data);
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
