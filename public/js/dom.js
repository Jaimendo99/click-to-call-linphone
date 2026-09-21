export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

const LABELS = {
  available: 'Disponible',
  in_progress: 'En curso',
  completed: 'Completado',
  pending: 'Pendiente',
  call_back: 'Volver a llamar',
  admin: 'Administrador',
  advisor: 'Asesor',
  'No Answer': 'No contesta',
  Answered: 'Contestó',
  'Wrong Number': 'Número equivocado',
  'Call Back': 'Volver a llamar',
  'Not Interested': 'No interesado',
  Interested: 'Interesado',
  'Disconnected / Invalid': 'Desconectado / inválido',
};

export function label(value) {
  if (value == null || value === '') return '';
  return LABELS[value] || String(value);
}

export function pill(status) {
  return el('span', { class: `pill pill-${status}`, text: label(status) });
}
