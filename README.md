# Glass Player

A desktop player built on Electron: YouTube Music (priority) and SoundCloud in one window, with a frosted-glass interface.

## Run

```bash
npm install
npm start
```

Requires Node.js 20+ and an internet connection.

## Features

- Search YouTube Music (official audio tracks) and SoundCloud at once; toggle each source at the top.
- Paste a link to a YouTube track, or to a SoundCloud track, playlist or artist page.
- **YouTube priority**: when you play a SoundCloud track, the player looks for its official version on YouTube Music (matching title, artist and duration). If it finds one, it plays that and marks it "Official version"; a button under the title switches back to SoundCloud. Can be turned off in Settings.
- If a YouTube video forbids embedding and a SoundCloud version exists, the player switches to it automatically.
- Queue, shuffle, repeat, seeking, volume, Space to pause, media keys.
- Settings (the sliders icon): transparency, window effect, theme (Silver / Graphite), update check.

## Window effect and transparency

Two separate settings:

- **Window effect** makes the operating system draw a blurred copy of whatever is behind the app (a frosted-glass look).
- **Transparency** controls how much of that blurred backdrop shows through the interface tint (default 30%).

| Platform | Effects |
|---|---|
| Windows 11 (22H2 or newer) | Acrylic (see-through blur), Mica (wallpaper tint only, not see-through), Off |
| macOS | Blur (vibrancy), Off |
| Windows 10, Linux | Off: the window is opaque |

With the effect off, transparency has nothing to show through, so the slider is disabled.

On Windows the blur is drawn by the system, and [Microsoft documents](https://learn.microsoft.com/windows/uwp/style/acrylic) that acrylic turns into a flat colour when the app window loses focus, when "Transparency effects" is off (Settings > Personalization > Colors), in Battery Saver mode, and on low-end hardware. So the blur is visible only while the player is the active window.

## Developer mode and logs

Settings > **Developer mode** reveals extra options: a **debug button** in the title bar and **verbose logging**.
The button opens a separate log window with search (all words must match), level and source filters,
copy (the filtered lines), clear and "Show log file". Everything is also written to `glass-player.log`
(rotated at 2 MB) in the app's logs folder: `%APPDATA%\Glass Player\logs` on Windows, `~/.config/Glass Player/logs` on Linux.

## How it works

| File | Role |
|---|---|
| `src/main/main.js` | window, IPC, search, matching with official tracks |
| `src/main/youtube.js` | YouTube Music search via `youtubei.js` |
| `src/main/soundcloud.js` | SoundCloud search and link resolving |
| `src/main/match.js` | track similarity scoring (pure logic) |
| `src/main/updater.js` | update checks through GitHub Releases |
| `src/main/server.js` | local server, so the YouTube iframe does not fail with error 153 |
| `src/renderer/engines.js` | playback engines: YouTube IFrame API and SoundCloud Widget API |
| `src/renderer/app.js` | interface, queue, controls |
| `src/renderer/locales/` | interface strings (English is the default) |

Sound is played by the official embedded YouTube and SoundCloud players. No streams are downloaded or decrypted.

### Languages

The interface is English. Strings live in `src/renderer/locales/en.js` and are looked up through `i18n.js`, so another language is a new file in that folder plus a `<script>` tag in `index.html`.

## Build

| Platform | Command | Output in `dist/` |
|---|---|---|
| Windows | `build.bat` (or `npm run dist`) | `GlassPlayer-Setup-<version>.exe` (installer), `GlassPlayer-Portable-<version>.exe`, `latest.yml` |
| Linux | `./build.sh` (or `npm run dist:linux`) | `GlassPlayer-<version>.AppImage`, `latest-linux.yml` |
| macOS | `npm run dist:mac` (on a Mac only) | `.dmg`; without an Apple signature macOS will block it |

User data (settings, volume) lives in the user profile: `%APPDATA%\Glass Player` on Windows, `~/.config/Glass Player` on Linux. The uninstaller leaves it alone.

Build from a clone whose `origin` points to GitHub: `electron-builder` reads the owner and repository name from it for auto-update. A build made without `origin` still runs, but its update check reports that updates are not set up.

## Releases and updates

1. Bump the version (`npm version <new> --no-git-tag-version`), add an entry to `CHANGELOG.md`, commit.
2. `git tag v<new>` and `git push origin v<new>`. GitHub Actions (`.github/workflows/release.yml`) builds Windows and Linux and creates a **draft** release.
3. Check the files and press **Publish** on the Releases page. Only then is the version visible and available for updating.

The installed Windows build and the Linux AppImage update themselves: the app checks for new releases at startup, downloads the update in the background and installs it on quit or via the button in Settings. The portable build and runs from source cannot update themselves; the app only tells you about a new version and opens the release page.

Builds are not code-signed yet, so Windows SmartScreen may show a warning on first launch.

## Known limitations

- YouTube Music search goes through the unofficial `youtubei.js`, and SoundCloud takes a public `client_id` from its own site. If either service changes its internal API, `youtube.js` and `soundcloud.js` are what will break.
- YouTube's embedded player shows ads, as any embed does.
- There is no account sign-in yet (no likes or personal playlists).

## License

The code is open to read, but this is **not** open source in the OSI sense. The project is licensed under [PolyForm Noncommercial 1.0.0](LICENSE):

- you may read, run, modify and fork the code, and share it, for personal and noncommercial use;
- you may **not** sell the app, its copies or derivative works, or use them commercially;
- copyright stays with the author. All copies and forks must keep the `LICENSE` file and the `Required Notice` line.

Commercial use is possible only with separate written permission from the author.

YouTube and SoundCloud belong to their owners. This project is not affiliated with them, and users are responsible for following their terms of service.

## Versions

The scheme is described in [VERSIONING.md](VERSIONING.md); the history is in [CHANGELOG.md](CHANGELOG.md). Current version: 0.0.1.

## What's next

Saved playlists and history, account sign-in, mini mode, sorting, volume normalization, code signing, more interface languages.
