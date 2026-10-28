# Protocol notes

These notes describe what the official TikTok LIVE Studio 1.38.0 for macOS sends when it starts and ends a LIVE, and what this app copies. They come from reading the Electron app's JavaScript bundles. No TikTok code is included in this repository.

TikTok can change any of this without notice.

## Get the official app for reference

The macOS `.dmg` from TikTok's download page is a small native downloader. It asks TikTok's settings service which package to fetch:

```sh
curl -sG 'https://webcast.tiktokv.com/service/settings/v3/' \
  --data-urlencode aid=8311 \
  --data-urlencode device_platform=mac \
  --data-urlencode version_code=0.0.0 \
  --data-urlencode channel=local_test
```

The response has `data.settings.live_studio_downloader_mac` and `data.settings.live_studio_downloader_windows`, each with a `url`, `md5`, and `version`. The macOS package is an Electron app with its JavaScript unpacked under `Contents/Resources/app/`.

## Client identity

Every webcast request carries these query parameters:

| Parameter | Value |
|---|---|
| `aid` | `8311` |
| `app_name` | `tiktok_live_studio` |
| `channel` | `studio` |
| `device_platform` | `mac` or `windows` |
| `version_code` | `1.38.0` |
| `webcast_sdk_version` | `1380` (the version with the dots removed) |
| `live_mode` | `6` (LIVE Studio room mode) |
| `language`, `app_language`, `webcast_language` | UI language, for example `en` |
| `device_id`, `install_id` | From device registration, or `0` if registration failed |
| `priority_region` | The user's region, when known |
| `timezone_name` | IANA time zone |
| `screen_width`, `screen_height`, `browser_*` | Renderer details |

Headers:

| Header | Value |
|---|---|
| `content-type` | `application/x-www-form-urlencoded; charset=UTF-8` |
| `sdk_aid` | `8311` |
| `x-ss-stub` | Lowercase hex MD5 of the request body (POST, PUT, and PATCH only) |
| `x-tt-store-region` | The user's region, when known |

The base URL is `https://webcast.tiktokv.com`.

The official app also runs two native components that this app leaves out:

- Device registration at `https://log.tiktokv.com/service/2/desktop/device_register/`. The payload is encrypted with a proprietary scheme. If registration fails, the official app keeps working with `device_id=0`, and this app always uses `0`.
- ByteDance's MetaSec SDK on top of the TTNet network stack (`ttnetWithMetaSec: true`), which can add signature headers to requests. This app doesn't add or forge any signatures.

## Regional hosts

A logged-in session only works on the webcast hosts of the account's data center (IDC). US accounts run on separate infrastructure under `*.tiktokv.us`. On the global host, a request with a US session gets HTTP 403, while the same request without a session gets the normal `20003` (not logged in) answer.

The official app never sees this in its JavaScript: it always calls `webcast.tiktokv.com`, and its native network stack (TTNet, `libsscronet`) rewrites the host from a dispatch config it downloads at startup. This app reads the IDC from the `tt-target-idc` or `store-idc` cookie that TikTok sets at login and maps it:

| IDC | Webcast host |
|---|---|
| `useast5` (TTP) | `webcast16-normal-useast5.tiktokv.us` |
| `useast8` | `webcast16-normal-useast8.tiktokv.us` |
| `alisg` | `webcast16-normal-c-alisg.tiktokv.com` |
| `useast1a` (`maliva`) | `webcast16-normal-c-useast1a.tiktokv.com` |
| `no1a` (`ie`, `useast2a`) | `webcast16-normal-no1a.tiktokv.eu` |

If that host doesn't accept the session either, the app tries the other hosts with the `create_info` precheck and keeps the first one that recognizes the login. To force a host, set `webcastHost` in the settings file.

## Login

The official app shows `https://www.tiktok.com/ucenter_web/live_studio/login` in a window and lets TikTok's page handle the login. Afterwards it copies the session cookies (`sessionid`, `sessionid_ss`, `sid_tt`, `sid_guard`, `uid_tt`, `odin_tt`, and the rest) from `.tiktok.com` onto the `tiktokv.com` API domains. It also sets `sessionid` from `sessionid_ss` when only the latter exists.

This app opens `https://www.tiktok.com/login` in its own Electron session. It sends the `.tiktok.com` cookies to the API as an explicit `Cookie` header instead of copying them between domains.

Without a session, the API answers with `status_code` `20003` (`User doesn't login`).

## Start and run a LIVE

1. `GET /webcast/room/create_info/?live_studio=1`

   This is the precheck: permission flags, the default title, and the topic. If `status_code` isn't `0`, `data.prompts` or `data.message` explains why.

2. `POST /webcast/room/create/` (form body)

   The fields the official app sends by default, with the values this app uses:

   | Field | Value |
   |---|---|
   | `title` | Your title |
   | `live_studio` | `1` |
   | `gen_replay` | `true` |
   | `chat_auth`, `gift_auth` | `1` (on; `2` is off) |
   | `chat_l2` | `1` (hide spam) |
   | `star_comment_switch` | `true` |
   | `cover_uri` | Empty string |
   | `close_room_when_close_stream` | `false` |
   | `hashtag_id` | Topic ID, or `0` |
   | `game_tag_id` | Game ID, or `0` |
   | `multi_stream_scene` | `0` |
   | `multi_stream_source` | `1` for vertical, `0` for horizontal |

   The official app sends more optional fields (age restriction, branded content, subscriber-only settings, and others). This app leaves them out.

   In the response, `data.stream_url.push_urls[0]` is the preferred push URL, which can use ByteDance transports such as `rtmpq`. `data.stream_url.rtmp_push_url` is the plain RTMP fallback, and this app uses that one. OBS needs it split at the last `/`: everything up to and including it is the server, and the rest (including any query string) is the stream key.

   Other `status_code` values the official app handles: `10018` (punished), `2403`, `30005` (hold living), and `30011` (illegal avatar).

3. `POST /webcast/room/ping/anchor/` every 5 seconds (form body `status`, `room_id`, `stream_id`)

   `room_id` comes from `data.living_room_attrs.room_id_str`, and `stream_id` from `data.stream_id_str`. `status` is the anchor's state:

   | `status` | Meaning |
   |---|---|
   | `0` | default |
   | `1` | prepare (room created, stream not yet up) |
   | `2` | living |
   | `3` | pause |
   | `4` | finish |

   Response `status_code` values: `4003150` means the room is LIVE, `30003` means it has finished, and `30003001` means another device finished it.

4. To end the LIVE, the official app stops its stream and sends one last ping with `status=4`. If pings stop altogether, TikTok ends the room on its own after a timeout.
