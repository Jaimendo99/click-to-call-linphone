import { api, hideAlert, showAlert } from './api.js';

const form = document.getElementById('login-form');
const alertBox = document.getElementById('login-alert');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert(alertBox);
  const data = new FormData(form);
  try {
    const result = await api('/auth/login', {
      method: 'POST',
      body: {
        username: data.get('username'),
        password: data.get('password'),
      },
    });
    window.location.href = result.user.role === 'admin' ? '/admin' : '/advisor';
  } catch (error) {
    showAlert(alertBox, error.message);
  }
});
