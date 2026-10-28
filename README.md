# LIVE Studio for Linux (unofficial)

A small Linux desktop app that starts a TikTok LIVE and points OBS Studio at it, so you can go LIVE from Linux without a TikTok stream key.

> **Unofficial and unsupported.** This project is not made by, affiliated with, or endorsed by TikTok or ByteDance. TikTok publishes LIVE Studio for Windows and macOS only. This app talks to TikTok's servers the same way the official LIVE Studio app does, using your own login. TikTok can change or block that at any time, and using a client TikTok didn't make might go against [TikTok's Terms of Service](https://www.tiktok.com/legal/page/us/terms-of-service/en). Your account is your responsibility. There is no warranty and no support. If you need something reliable, use TikTok's official tools.

## Status

Version 0.1.0 is untested against a real LIVE. The request formats come from reading the JavaScript that ships inside the official LIVE Studio 1.38.0 for macOS, and the unit tests cover the logic, but the first end-to-end LIVE with a real account is still to be done. Expect rough edges, and check the **Log** panel when something fails.

## What it does

- Opens TikTok's own login page in a window, so you sign in on TikTok and the app only keeps the session cookie TikTok sets.
- Checks whether your account is allowed to go LIVE from LIVE Studio.
- Creates a LIVE room with your title and topic, and gets the RTMP server and stream key for that room.
- Drives OBS through its built-in WebSocket server: sets the custom RTMP server and key, optionally switches the canvas to 1080x1920, starts the stream, and restores your previous OBS settings afterwards.
- Sends the heartbeat TikTok expects every 5 seconds while you're LIVE, and ends the room cleanly when you click **End LIVE**, stop streaming in OBS, or quit the app.

OBS does all of the capture, scenes, and encoding. This app only handles the TikTok side.

## Requirements

- Linux x86_64.
- [OBS Studio](https://obsproject.com/) 28 or later. Version 28 and later include obs-websocket 5.
- A TikTok account that can go LIVE. You need to meet TikTok's own LIVE requirements (age, followers, region, no restrictions). This app does not get around them: if TikTok says your account can't go LIVE, the app shows that message and stops.
- Node.js 20 or later and npm, to build from source.

## Build and run

1. Clone the repository and install the dependencies:

   ```sh
   git clone https://github.com/averagenative/tiktok-live-studio-linux.git
   cd tiktok-live-studio-linux
   npm install
   ```

2. Run the checks, then start the app:

   ```sh
   make check
   make run
   ```

3. To build an AppImage and add it to your application menu:

   ```sh
   make appimage
   make install
   ```

   `make install` copies the AppImage to `~/Applications` and registers a `.desktop` entry and an icon.

## Set up OBS

1. In OBS, open **Tools > WebSocket Server Settings**.
2. Select **Enable WebSocket server**.
3. Click **Show Connect Info** and copy the server password.
4. In this app's **OBS** panel, paste the password and click **Connect**.

The default host and port (`127.0.0.1`, `4455`) match OBS's defaults.

If you'd rather not let the app control OBS, clear **Drive OBS automatically**. When you go LIVE, the app shows the server and stream key. Paste them into OBS under **Settings > Stream > Service: Custom**, start streaming, and then click **I've started streaming in OBS**.

## Go LIVE

1. Click **Log in to TikTok** and sign in. The window closes after TikTok sets your session.
2. Check that the **Account** panel shows **LIVE access: ready**.
3. Set up your scene in OBS. For a vertical LIVE, select **Vertical (portrait) LIVE** and either set a 1080x1920 canvas yourself or select **Switch the OBS canvas to 1080x1920 while LIVE**.
4. Enter a title, pick a topic if you want one, and click **Go LIVE**.
5. The badge changes from **PREPARING** to **LIVE** after OBS reports that the stream is running.
6. To finish, click **End LIVE**. Stopping the stream in OBS or quitting the app also ends the LIVE.

## Troubleshooting

- **LIVE access shows an error.** That message comes from TikTok. It usually means the account doesn't meet the LIVE requirements or has a restriction. This app can't change that.
- **"TikTok refused to create the LIVE".** The **Log** panel shows the `status_code` and `logid` from TikTok. Open an issue with those, and remove anything personal first.
- **OBS won't connect.** Make sure the WebSocket server is enabled in OBS and that the password matches. If OBS runs as a Flatpak, the default `127.0.0.1:4455` still works.
- **The LIVE ends by itself after a short time.** TikTok ends a room when the heartbeat stops. Check the log for `ping failed` lines, which point to a network problem.
- **Login loops or shows a captcha.** Complete it in the login window. If it keeps failing, click **Log out** to clear the saved session and try again.

## Privacy and what this app doesn't do

- It doesn't include or redistribute any TikTok or ByteDance code, assets, or binaries. Everything in this repository is original.
- It never sees your TikTok password. You type it into TikTok's own page.
- It stores the TikTok session cookies in the app's own Electron profile under `~/.config/LIVE Studio for Linux/`. Click **Log out** to delete them.
- It stores the OBS WebSocket password with Electron `safeStorage`, which uses your desktop keyring (libsecret) when one is available.
- It doesn't forge request signatures, register a fake device, or work around TikTok's anti-abuse systems. It sends the same plain requests the official app's JavaScript builds, with `device_id=0`, which the official app also falls back to. If TikTok starts requiring signatures for these endpoints, this app stops working.
- It sends no telemetry.

For the request details, see [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Development

- `make check` runs a syntax check and the unit tests (`node --test`).
- `make hooks` sets `core.hooksPath` to `.githooks`, so `git push` runs `make check` first.
- The code is plain CommonJS with no build step: `src/main.js` (Electron main process), `src/tiktok.js` (webcast API client), `src/obs.js` (obs-websocket 5 client), `src/session.js` (the LIVE lifecycle), and `src/renderer/` (UI).

## License

[MIT](LICENSE). TikTok and LIVE Studio are trademarks of their owners and are used here only to describe what this app works with.
