'use strict';

const pin = window.pinShell;

document.getElementById('close').addEventListener('click', () => pin.close());
document.getElementById('reload').addEventListener('click', () => pin.reload());

// Frameless windows have no resize border, so the grip resizes from the
// bottom-right: the window's top-left stays put and only the size changes
// (Wayland apps can't move their own windows, but they can resize them).
const grip = document.getElementById('grip');
let start = null;
grip.addEventListener('pointerdown', async (e) => {
  grip.setPointerCapture(e.pointerId);
  const [width, height] = await pin.size();
  start = { x: e.screenX, y: e.screenY, width, height };
});
grip.addEventListener('pointermove', (e) => {
  if (!start) return;
  pin.resize(start.width + (e.screenX - start.x), start.height + (e.screenY - start.y));
});
const stop = () => { start = null; };
grip.addEventListener('pointerup', stop);
grip.addEventListener('pointercancel', stop);
