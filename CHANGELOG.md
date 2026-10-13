# Changelog

The version scheme is described in [VERSIONING.md](VERSIONING.md).

## 0.0.1

First scaffold.

- Frosted-glass interface (Silver and Graphite themes) with a window effect (Acrylic / Mica on Windows 11, vibrancy on macOS) and a transparency slider.
- Search across YouTube Music and SoundCloud; paste-a-link support.
- YouTube priority: look for the official version of SoundCloud tracks.
- Queue, shuffle, repeat, seeking, volume.
- English interface with a locale system ready for more languages.
- Builds: installer and portable for Windows, AppImage for Linux (`build.bat`, `build.sh`).
- Auto-update through GitHub Releases, update check in Settings.
- Developer mode (Settings): a debug button opens a separate log window with search, level and source filters, copy, clear and a persistent log file.
- Themed, rounded dropdowns (readable in both themes).
- Video is hidden by default: a play button on the cover shows it for tracks that have a video; a setting plays it automatically.
- Tracks the owner doesn't allow to be embedded are detected before playback: dimmed in results and skipped when looking for the official version.
