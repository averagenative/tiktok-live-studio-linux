# Changelog

## 0.2.0 (unreleased)

### Features

- **Scene themes.** **Set up TikTok scenes** opens a picker with five themes (Neon, Synthwave, Arcade, Cozy, and Minimal) that previews all seven scenes with your handle, a game stand-in, and your webcam or the robot before you apply one. Applying another theme later swaps the artwork and keeps your sources and layout.
- **Animal avatars.** Pick a robot, cat, fox, or panda as your avatar. The animals talk, blink, cheer, and gesture like the robot, and each has its own outfit: the cat games in a headset with a boom mic, the fox wears a backwards cap and foam headphones, and the panda has studio headphones, glasses, and a bow tie. Switching avatars updates OBS right away.
- Every avatar takes on the scene theme's colors.
- The OBS sources and the scene named after the robot are renamed in place: **Screen + Robot** becomes **Screen + Avatar**, and **Robot**, **Robot (wide)**, and **Robot (full)** become **Avatar**, **Avatar (wide)**, and **Avatar (full)**.
- Scene text is drawn into the artwork with bundled fonts, so OBS no longer needs Montserrat installed. Setups from 0.1.0 lose their OBS text sources when you apply a theme, because the frames now carry the text.

## 0.1.0

First release. LIVE Studio for Linux is unofficial and unsupported, and isn't made by, affiliated with, or endorsed by TikTok or ByteDance. It talks to TikTok the way the official LIVE Studio app does, which may break at any time or go against TikTok's terms. Use it at your own risk.

You need an account that TikTok has granted LIVE Studio access. Going LIVE from the phone app is a separate permission. The app shows your LIVE Studio status and opens TikTok's own application page if you don't have access yet.

### Features

- Log in on TikTok's own login page. The app keeps only the session cookie TikTok sets.
- Start and end a TikTok LIVE: create the room, keep the 5-second heartbeat, and finish the room on **End LIVE**, when OBS stops streaming, or when you quit.
- Route requests to your account's regional servers, including US accounts on `*.tiktokv.us`.
- Drive OBS through obs-websocket 5: set the RTMP server and key, start and stop the stream, and switch to the **TikTok Vertical** profile while LIVE.
- **Set up TikTok scenes** builds a 1080x1920 NVENC profile and a styled scene collection (Starting Soon, Camera, Screen + Camera, Screen + Robot, Screen, Be Right Back, Ending) with noise suppression, a compressor, and a limiter on the mic. Running it again repairs whatever is missing and leaves your own sources alone.
- A voice-reactive robot avatar that can replace your webcam, driven by your mic level from OBS. It cheers with both arms up when you're loud, and tilts, turns, nods, shrugs, and brushes off its shoulder on its own.
- A pinned window for keeping any web page, such as your LIVE page, on top of your game. On TikTok LIVE pages it can show only the viewers and comments panel, on a see-through backing with adjustable strength. It's always muted, and links that leave the LIVE page, like **Moderator**, open in a separate window.
- **Hide private info** hides your account, the OBS address, the pinned page address, stream details, and the log, for when you share your whole screen.
- Five themes, including a light one.

### Install

Download `live-studio-linux-0.1.0-x86_64.AppImage`, check it against `SHA256SUMS`, make it executable, and run it:

```sh
sha256sum -c SHA256SUMS
chmod +x live-studio-linux-0.1.0-x86_64.AppImage
./live-studio-linux-0.1.0-x86_64.AppImage
```
