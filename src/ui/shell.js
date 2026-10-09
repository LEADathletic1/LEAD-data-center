import { h, clear } from './dom.js';

const BRAND_SUB = 'Athlete testing archive — long-term history';

function brand() {
  return h('div', { class: 'brand' },
    h('div', { class: 'logo-mark', 'aria-hidden': 'true' }, 'L'),
    h('div', null,
      h('div', { class: 'brand-name' }, 'LEAD DATA CENTER'),
      h('div', { class: 'brand-sub mono' }, BRAND_SUB)));
}

// Full app frame after sign-in. Returns the element the active screen draws into.
export function mountShell(root, { email, mock, onSignOut }) {
  clear(root);
  const links = {
    library: h('a', { class: 'nav-link', href: '#/library' }, 'Library'),
    upload: h('a', { class: 'nav-link', href: '#/upload' }, 'Upload'),
  };
  const main = h('main', { class: 'view', id: 'view', tabindex: '-1' });
  root.appendChild(h('div', { class: 'shell' },
    mock ? h('div', { class: 'mock-bar mono', role: 'status' }, 'MOCK MODE — synthetic sample data held in this browser tab only. Nothing is sent anywhere.') : null,
    h('header', { class: 'topbar' },
      brand(),
      h('nav', { class: 'nav', 'aria-label': 'Main' },
        links.library, links.upload,
        h('div', { class: 'user' },
          h('span', { class: 'mono dim' }, email),
          mock ? null : h('button', { type: 'button', class: 'btn-ghost mono', onclick: onSignOut }, 'SIGN OUT')))),
    main));
  return {
    main,
    setActive(route) {
      for (const [k, el] of Object.entries(links)) {
        if (k === route) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
      }
    },
  };
}

// Pre-sign-in and error screens: one centered card, no navigation, no data.
export function mountGate(root, { title, body, extra }) {
  clear(root);
  const card = h('div', { class: 'gate-card' },
    brand(),
    h('h1', { class: 'gate-title' }, title),
    body ? h('p', { class: 'gate-body' }, body) : null,
    extra || null);
  root.appendChild(h('div', { class: 'gate' }, card));
  return card;
}
