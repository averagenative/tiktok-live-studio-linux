'use strict';

// The plugins that ship with the app, in the order their cards appear.
// Only these load; see host.js for why there's no user plugins folder.
module.exports = [
  require('./launch-obs'),
  require('./twitch'),
];
