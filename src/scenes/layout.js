'use strict';

// Scene geometry shared by the OBS setup (Node) and the scene artwork
// (browser): the 1080x1920 canvas, the windows cut into each scene's frame,
// and where each scene's text sits. Sources sit under the frame, sized a few
// pixels past each window, so the frame gives them their corners.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SceneLayout = factory();
})(typeof self !== 'undefined' ? self : this, () => {
  const W = 1080;
  const H = 1920;

  // r is the corner radius at a theme's default roundness.
  const HOLES = {
    camera: { x: 60, y: 210, w: 960, h: 1280, r: 52 },
    sc_cam: { x: 150, y: 170, w: 780, h: 439, r: 40 },
    sc_screen: { x: 30, y: 650, w: 1020, h: 574, r: 36 },
    screen: { x: 20, y: 560, w: 1040, h: 585, r: 36 },
    sr_screen: { x: 20, y: 170, w: 1040, h: 585, r: 36 },
  };

  // The free-standing robot under the game in "Screen + Robot".
  const ROBOT_FULL = { x: 0, y: 790, w: W, h: H - 790 };

  // Every scene in the order OBS lists them. holes: windows in the frame and
  // what shows through each. text: lines drawn on the frame, centered on y;
  // lines with {handle} are left out when there's no handle.
  const hole = (key, shows) => ({ key, shows, ...HOLES[key] });
  const handleAt = (y) => ({ role: 'handle', text: '{handle}', y });
  const SCENES = [
    {
      name: 'Starting Soon',
      holes: [],
      text: [{ role: 'title', text: 'STARTING SOON', y: 820 }, handleAt(990), { role: 'subtitle', text: 'LIVE in a moment', y: 1080 }],
    },
    { name: 'Camera', holes: [hole('camera', 'camera')], text: [handleAt(1570)] },
    { name: 'Screen + Camera', holes: [hole('sc_screen', 'game'), hole('sc_cam', 'camera')], text: [handleAt(1300)] },
    { name: 'Screen + Robot', robot: true, holes: [hole('sr_screen', 'game')], text: [handleAt(822)] },
    { name: 'Screen', holes: [hole('screen', 'game')], text: [handleAt(1240)] },
    { name: 'Be Right Back', holes: [], text: [{ role: 'title', text: 'BE RIGHT BACK', y: 820 }, handleAt(990)] },
    {
      name: 'Ending',
      holes: [],
      text: [{ role: 'title', text: 'THANKS FOR', y: 770 }, { role: 'title', text: 'WATCHING', y: 880 },
        { role: 'handle', text: 'follow {handle}', y: 1040 }],
    },
  ];

  const BG_FILE = 'bg.png';
  const frameFile = (sceneName) => `frame-${sceneName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.png`;
  const artFiles = () => [BG_FILE, ...SCENES.map((s) => frameFile(s.name))];

  return { W, H, HOLES, ROBOT_FULL, SCENES, BG_FILE, frameFile, artFiles };
});
