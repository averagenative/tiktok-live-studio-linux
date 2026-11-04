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

// With two panes (TikTok and a plugin's, like Twitch chat), the gap between
// them shows this divider. Dragging it sets how much room the top pane gets.
const BAR = 28;
const divider = document.getElementById('divider');
let gap = 6;
pin.onLayout(({ divider: d }) => {
  divider.hidden = !d;
  if (!d) return;
  gap = d.height;
  divider.style.top = `${d.y}px`;
  divider.style.height = `${d.height}px`;
});
let dragging = false;
let queued = null;
divider.addEventListener('pointerdown', (e) => {
  divider.setPointerCapture(e.pointerId);
  dragging = true;
});
divider.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const area = window.innerHeight - BAR - gap;
  if (area <= 0) return;
  const ratio = (e.clientY - BAR - gap / 2) / area;
  if (queued === null) {
    requestAnimationFrame(() => {
      pin.split(queued);
      queued = null;
    });
  }
  queued = ratio;
});
const endDrag = () => { dragging = false; };
divider.addEventListener('pointerup', endDrag);
divider.addEventListener('pointercancel', endDrag);
