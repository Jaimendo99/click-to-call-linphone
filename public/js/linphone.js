import { buildLinphoneCallUri } from '/lib/phone.js';

export function callWithLinphone(phoneNumber) {
  const uri = buildLinphoneCallUri(phoneNumber);
  const link = document.createElement('a');
  link.setAttribute('href', uri);
  link.setAttribute('rel', 'noopener noreferrer');
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  return uri;
}
