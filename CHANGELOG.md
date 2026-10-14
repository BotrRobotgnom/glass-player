# Changelog

The version scheme is described in [VERSIONING.md](VERSIONING.md).
Each version has `### Added`, `### Changed` and `### Fixed` parts (only the ones that apply).
The release notes on GitHub are built from this file automatically (see `scripts/release-notes.mjs`).

## 0.1.3

### Added
- A clear (x) button at the right of the search field.

### Changed
- The cover in the now-playing block is square when there is no video, and smoothly changes to 16:9 when the video is shown.
- When the YouTube version of a track is known not to play (embedding disabled), the switch button is disabled and says "YouTube version unavailable".

## 0.1.2

### Added
- Settings is now a full window with sections: General, Appearance, Updates and Developer. Switches sit on the right, labels on the left.
- In narrow windows the volume control collapses to the speaker icon; hover it to get a vertical slider over the player.
- Playlists show their total time at the right of each row and in the header.
- Playlist rows show Play, Shuffle and Edit buttons while hovered.

### Changed
- Deleting a playlist is only possible from inside it, with a plain "Delete" button (click twice to confirm).

### Fixed
- Removing the track that is playing from the queue now stops it and starts the next one.
- The trash icon in the playlist header is centred.

## 0.1.1

### Added
- "What's new" window: opens by itself when an update is found, and from Settings > Changelog. Release notes come from GitHub (with images and videos you add to a release), newer versions on top marked "New", then a line showing your installed version and the older ones folded. Offline it falls back to the changelog bundled with the app. Buttons: Update / Restart & update, Close, Skip this version.
- Settings: "Check for updates automatically" checkbox next to the Changelog and Check buttons.
- History: remove a single track (the red button that replaces the duration on hover).

### Changed
- Track lists: the duration sits at the far right, hover buttons appear to its left, and the remove button (history, queue, playlist) takes the duration's place in red.

### Fixed
- Debug log window: a switched-off level filter is now clearly different from a hovered one (faded, dashed, hollow dot), and the source dropdown is centred.
- The update check ignores stray "untagged-…" releases and picks the newest properly tagged one.

## 0.1.0

### Added
- Listening history. A play counts after 30 seconds of real listening (or half of a short track). Per-track stats (play count, last played) are kept forever, because they are tiny; only the chronological "recent" log is capped at the latest 5000 plays. Three views: Recent, Most played, Forgotten (played at least twice, not heard for 30+ days). Clear history with a double click.
- Local playlists: create, rename, add a cover image (cropped to a square, saved as 512 px), delete. Without an own image the cover is a mosaic of the first tracks. Add any track from results, queue, history or the now-playing panel with the playlist button; play or shuffle a whole playlist.
- Data is stored as JSON in the app data folder (`history.json`, `playlists.json`, `covers/`), written atomically; a corrupt file is kept aside instead of being overwritten.

### Fixed
- The update check no longer fails with a wall of HTTP headers when GitHub has no published release. The app now asks the GitHub API first, shows "No published release on GitHub yet" (or "Couldn't reach GitHub" when offline) and only starts electron-updater when a newer version really exists. Errors are shortened in the UI and the log and reported once.

## 0.0.2

### Added
- Search as you type, with suggestions from YouTube Music (arrow keys, Enter, Esc); links still wait for Enter.

### Changed
- Turning a source on or off now hides its results at once and refreshes the search.

### Fixed
- The volume setting is now kept when the next track starts (YouTube and SoundCloud reset it on load).
- Switching between the YouTube and SoundCloud versions keeps the playback position, and if the other version can't be played the player goes back to the previous one at the same moment.
- Older answers no longer overwrite newer search results.

## 0.0.1

### Added
- First scaffold: frosted-glass interface (Silver and Graphite themes) with a window effect (Acrylic / Mica on Windows 11, vibrancy on macOS) and a transparency slider.
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
