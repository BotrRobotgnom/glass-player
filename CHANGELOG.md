# Changelog

The version scheme is described in [VERSIONING.md](VERSIONING.md).

## 0.0.2

- Fixed: the volume setting is now kept when the next track starts (YouTube and SoundCloud reset it on load).
- Fixed: switching between the YouTube and SoundCloud versions keeps the playback position, and if the other version can't be played the player goes back to the previous one at the same moment.
- Search as you type, with suggestions from YouTube Music (arrow keys, Enter, Esc); links still wait for Enter.
- Turning a source on or off now hides its results at once and refreshes the search.
- Older answers no longer overwrite newer search results.

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
