'use strict';

// Draws the Plugins card and each plugin's own card from the plain data the
// plugins send (src/plugins/host.js). Plugin code never runs in this window.
//
// Item types:
//   group   { items }                     a column in a wide card
//   row     { items }                     side by side
//   heading { text }
//   text    { text, tone?: ok|err|warn, small?, private? }
//   code    { text, private? }            big monospace, like a login code
//   button  { id, label, style?: primary|danger, disabled?, valueFrom? }
//   toggle  { id, label, checked, disabled? }
//   input   { id, label, value?, placeholder?, secret?, private?, disabled?, submit? }
//   select  { id, label, value, options: [{ value, label }], disabled? }
//
// Elements are kept between updates (keyed by item id), so a refresh doesn't
// steal focus or wipe what you're typing.

function createPluginUi({ api, list, before, isPrivate, onError }) {
  const MASK = '•'.repeat(8);
  const cards = new Map(); // plugin id -> { section, title, dot, body, nodes }
  let snap = { plugins: [], cards: {} };

  async function act(el, fn, card) {
    if (el) el.disabled = true;
    try {
      await fn();
      if (card) card.err.hidden = true;
    } catch (e) {
      onError(e);
      // Shown on the card too: the log is easy to miss.
      if (card) {
        card.err.textContent = e.message;
        card.err.hidden = false;
      }
    } finally {
      if (el) el.disabled = el.dataset.off === '1';
    }
  }

  const send = (pluginId, id, value, el) => act(el, () => api.pluginAction(pluginId, id, value), cards.get(pluginId));

  function setDisabled(el, on) {
    el.dataset.off = on ? '1' : '';
    el.disabled = !!on;
  }

  // ---- building blocks -------------------------------------------------------

  function build(type, pluginId, card) {
    const node = { type };
    switch (type) {
      case 'group':
        node.el = document.createElement('div');
        node.el.className = 'plugin-group';
        node.box = node.el;
        break;
      case 'row':
        node.el = document.createElement('div');
        node.el.className = 'row';
        node.box = node.el;
        break;
      case 'heading':
        node.el = document.createElement('h3');
        node.el.className = 'plugin-heading';
        break;
      case 'text':
        node.el = document.createElement('p');
        break;
      case 'code':
        node.el = document.createElement('code');
        node.el.className = 'plugin-code';
        break;
      case 'button':
        node.el = document.createElement('button');
        node.el.type = 'button';
        node.el.addEventListener('click', () => {
          const from = node.item.valueFrom && card.nodes.get(`input:${node.item.valueFrom}`);
          send(pluginId, node.item.id, from ? from.input.value : undefined, node.el);
        });
        break;
      case 'toggle': {
        node.el = document.createElement('label');
        node.el.className = 'check';
        node.input = document.createElement('input');
        node.input.type = 'checkbox';
        node.span = document.createElement('span');
        node.el.append(node.input, node.span);
        node.input.addEventListener('change', () => send(pluginId, node.item.id, node.input.checked, node.input));
        break;
      }
      case 'input': {
        node.el = document.createElement('label');
        node.span = document.createElement('span');
        node.input = document.createElement('input');
        node.input.spellcheck = false;
        node.input.autocomplete = 'off';
        node.el.append(node.span, node.input);
        node.input.addEventListener('change', () => {
          const { value } = node.input;
          // Secrets go to the plugin and leave the field; its placeholder says they're saved.
          if (node.item.secret) node.input.value = '';
          send(pluginId, node.item.id, value, null);
        });
        node.input.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || !node.item.submit) return;
          e.preventDefault();
          send(pluginId, node.item.submit, node.input.value, null);
        });
        break;
      }
      case 'select': {
        node.el = document.createElement('label');
        node.span = document.createElement('span');
        node.input = document.createElement('select');
        node.el.append(node.span, node.input);
        node.input.addEventListener('change', () => send(pluginId, node.item.id, node.input.value, node.input));
        break;
      }
      default:
        node.el = document.createElement('div');
    }
    return node;
  }

  function patch(node, item, pluginId, card, key) {
    node.item = item;
    const priv = isPrivate();
    const shown = (text) => (item.private && priv ? MASK : String(text ?? ''));
    switch (node.type) {
      case 'group':
      case 'row':
        renderItems(node.box, item.items || [], pluginId, card, key);
        break;
      case 'heading':
        node.el.textContent = item.text || '';
        break;
      case 'text':
        node.el.textContent = shown(item.text);
        node.el.className = ['status', item.small ? 'small' : '', item.tone || ''].filter(Boolean).join(' ');
        break;
      case 'code':
        node.el.textContent = shown(item.text);
        break;
      case 'button':
        node.el.textContent = item.label || '';
        node.el.className = item.style === 'primary' || item.style === 'danger' ? item.style : '';
        setDisabled(node.el, item.disabled);
        break;
      case 'toggle':
        node.span.textContent = item.label || '';
        node.input.checked = !!item.checked;
        setDisabled(node.input, item.disabled);
        break;
      case 'input':
        node.span.textContent = item.label || '';
        node.input.type = item.secret ? 'password' : 'text';
        node.input.placeholder = item.placeholder || '';
        node.input.classList.toggle('private-field', !!item.private);
        // Only fields the plugin fills in get overwritten, and never mid-typing.
        if (!item.secret && 'value' in item && document.activeElement !== node.input && node.applied !== item.value) {
          node.input.value = item.value ?? '';
          node.applied = item.value;
        }
        setDisabled(node.input, item.disabled);
        break;
      case 'select': {
        node.span.textContent = item.label || '';
        const opts = item.options || [];
        const sig = JSON.stringify(opts);
        if (node.sig !== sig) {
          node.sig = sig;
          node.input.replaceChildren(...opts.map((o) => new Option(o.label, o.value)));
        }
        node.input.value = item.value ?? '';
        setDisabled(node.input, item.disabled);
        break;
      }
      default:
        break;
    }
  }

  // Moves nodes only when the order actually changed: moving a focused
  // element would blur it.
  function sync(box, els) {
    const same = box.children.length === els.length && els.every((el, i) => box.children[i] === el);
    if (!same) box.replaceChildren(...els);
  }

  function renderItems(box, items, pluginId, card, prefix) {
    const els = [];
    items.filter(Boolean).forEach((item, i) => {
      const local = item.id ? `${item.type}:${item.id}` : `${item.type}#${i}`;
      const key = item.id && (item.type === 'input' || item.type === 'select') ? local : `${prefix}/${local}`;
      let node = card.nodes.get(key);
      if (!node || node.type !== item.type) {
        node = build(item.type, pluginId, card);
        card.nodes.set(key, node);
      }
      card.used.add(key);
      patch(node, item, pluginId, card, key);
      els.push(node.el);
    });
    sync(box, els);
  }

  // ---- cards -----------------------------------------------------------------

  function cardFor(id) {
    let c = cards.get(id);
    if (c) return c;
    const section = document.createElement('section');
    section.className = 'card plugin-card';
    section.dataset.plugin = id;
    const h2 = document.createElement('h2');
    const title = document.createElement('span');
    const dot = document.createElement('span');
    h2.append(title, dot);
    const body = document.createElement('div');
    body.className = 'plugin-body';
    const err = document.createElement('p');
    err.className = 'status small err';
    err.hidden = true;
    section.append(h2, body, err);
    c = { section, title, dot, body, err, nodes: new Map(), used: new Set() };
    cards.set(id, c);
    return c;
  }

  function renderCard(id, data) {
    const c = cardFor(id);
    c.section.classList.toggle('wide', !!data.wide);
    c.title.textContent = data.title || id;
    c.dot.className = data.dot ? `dot${data.dot === 'on' ? ' on' : data.dot === 'err' ? ' err' : ''}` : '';
    c.used = new Set();
    renderItems(c.body, data.items || [], id, c, '');
    for (const k of [...c.nodes.keys()]) if (!c.used.has(k)) c.nodes.delete(k);
    return c.section;
  }

  function renderList() {
    const rows = snap.plugins.map((p) => {
      const row = document.createElement('label');
      row.className = 'plugin-item';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!p.enabled;
      box.addEventListener('change', () => act(box, async () => {
        try {
          render(await api.setPluginEnabled(p.id, box.checked));
        } catch (e) {
          box.checked = !box.checked;
          throw e;
        }
      }));
      const text = document.createElement('span');
      const name = document.createElement('span');
      name.className = 'strong';
      name.textContent = p.name;
      const desc = document.createElement('span');
      desc.className = 'desc';
      desc.textContent = p.description;
      text.append(name, desc);
      if (p.error) {
        const err = document.createElement('span');
        err.className = 'desc err';
        err.textContent = `Couldn't start: ${p.error}`;
        text.append(err);
      }
      row.append(box, text);
      return row;
    });
    list.replaceChildren(...rows);
  }

  function render(next) {
    if (next) snap = next;
    renderList();
    const keep = new Set();
    let anchor = before;
    // Cards go just before `before`, in plugin order.
    for (const p of [...snap.plugins].reverse()) {
      const data = p.enabled && snap.cards[p.id];
      if (!data) continue;
      keep.add(p.id);
      const section = renderCard(p.id, data);
      if (section.nextElementSibling !== anchor || !section.isConnected) anchor.before(section);
      anchor = section;
    }
    for (const [id, c] of cards) {
      if (keep.has(id)) continue;
      c.section.remove();
      cards.delete(id);
    }
  }

  return { render };
}
