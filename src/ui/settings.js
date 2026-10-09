import { h } from './dom.js';
import * as api from '../api.js';

const MIN = 12;

export function render(main) {
  const msg = h('p', { class: 'mono small', role: 'alert' });
  const field = (label, id, autocomplete) => h('label', { class: 'field', for: id },
    h('span', { class: 'mono dim label-sm' }, label),
    h('input', { id, type: 'password', class: 'input wide', autocomplete, maxlength: '200', required: true }));
  const current = field('CURRENT PASSWORD', 'pw-current', 'current-password');
  const next = field('NEW PASSWORD (AT LEAST ' + MIN + ' CHARACTERS)', 'pw-new', 'new-password');
  const again = field('NEW PASSWORD AGAIN', 'pw-again', 'new-password');
  const button = h('button', { type: 'submit', class: 'btn-primary' }, 'Change Password');
  const val = (f) => f.querySelector('input').value;
  const form = h('form', { class: 'stack panel narrow', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    msg.className = 'mono small error-text';
    if (!val(current)) { msg.textContent = 'Enter your current password.'; return; }
    if (val(next).length < MIN) { msg.textContent = 'The new password must be at least ' + MIN + ' characters.'; return; }
    if (val(next) !== val(again)) { msg.textContent = 'The two new passwords do not match.'; return; }
    button.disabled = true; msg.textContent = '';
    try {
      await api.changePassword(val(current), val(next));
      // Every session is now invalid, this one included. Send everyone back to sign in.
      window.dispatchEvent(new CustomEvent('lead:auth-lost', { detail: { message: 'Password changed. Everyone is signed out. Sign in with the new password.' } }));
    } catch (ex) {
      msg.textContent = ex.message;
      button.disabled = false;
    }
  } },
    h('h3', { class: 'panel-title' }, 'Change password'),
    h('p', { class: 'muted small' }, 'Changing the password signs everyone out, on every device. Share the new one only with people who should have access.'),
    current, next, again, msg, button);
  main.appendChild(h('div', { class: 'page' }, h('div', { class: 'content' },
    h('div', null, h('h2', { class: 'screen-title' }, 'Settings'), h('p', { class: 'muted' }, 'Shared password for everyone who uses the LEAD Data Center.')),
    form)));
}
