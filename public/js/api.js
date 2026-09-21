export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (body && !(body instanceof FormData) && typeof body !== 'string') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers,
    body,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'La solicitud falló');
  }
  return data;
}

export function showAlert(node, message, kind = 'error') {
  if (!node) return;
  node.className = `alert alert-${kind}`;
  node.textContent = message;
  node.classList.remove('hidden');
}

export function hideAlert(node) {
  if (!node) return;
  node.classList.add('hidden');
  node.textContent = '';
}
