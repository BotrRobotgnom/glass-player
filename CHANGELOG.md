# Changelog

The version scheme is described in [VERSIONING.md](VERSIONING.md).
Each version has `### Added`, `### Changed` and `### Fixed` parts (only the ones that apply).
The release notes on GitHub are built from this file automatically (see `scripts/release-notes.mjs`).

## 0.4.5

### Changed
- Debug log: the level name (DEBUG, INFO, WARN, ERROR) now has the colour of its filter button.

### Fixed
- The changelog is fetched from GitHub every time it is opened (it was cached for 10 minutes), so a release published a moment ago, pre-releases included, shows up at once.

## 0.4.4

### Changed
- "Add to playlist" and the version switch in the track panel are now small icon buttons next to like/dislike (the text shows on hover). The switch shows which service it goes to.

### Fixed
- The scrollbar of the track panel no longer runs over the rounded frame.

## 0.4.3

### Added
- Settings → Updates → "Pre-releases": off by default. When on, the app also offers GitHub releases marked as pre-release.
- The changelog lists pre-releases with a "Pre-release" tag. Without the setting they are only listed, never offered as an update.

### Fixed
- The same title by different artists no longer ends up in one versions block: a result joins a group only when it is a version of that group's main track (no chains through other results), and a remix must name the main track's artist.

## 0.4.2

### Fixed
- A different song with the same title no longer lands in a versions block: lengths must be comparable (a 4:29 track is not a 1:40 one) and the artist must match.
- Remixes whose title carries the remixer's name outside brackets ("... Mylancore remix", "... dj osama type remix") and the artist's name in any position now go into the versions block.
- Home and search still showed YouTube videos that refuse to be embedded (error 150): the embeddability check now also asks YouTube's embedded player, not only the web player.

## 0.4.1

### Added
- Search: remixes, slowed / sped up versions and other uploads of a result are moved out of the main list into one framed block under that result (first 5, "Show N more" for the rest). They no longer appear twice.
- Long names in the versions lists wrap to two lines, and the full name shows on hover.

### Changed
- Versions are matched more strictly: the words that name the song must be the same, so "Spin Again" is no longer taken for a version of "Spin".
- Exact duplicates (same recording, or the same ISRC when SoundCloud provides it) are folded into one, and the YouTube and SoundCloud copies of a version are joined into one row with both icons.

## 0.4.0

### Added
- "Other versions" under the playing track: remixes, slowed / sped up, live, acoustic, other uploads and covers of the same song, found on both YouTube Music and SoundCloud and labelled by kind. Click one to play it.
- Genre and tags of the playing track (SoundCloud provides them) shown as small chips under the badges.

### Notes
- Versions are found by matching the song's title words and artist, not from an official link (neither service has one), so the list can occasionally include or miss something.

## 0.3.4

### Fixed
- YouTube videos that can't be embedded (error 150) were still shown on Home and in search, and were found out only after trying to play them. They are now detected with YouTube's own "playable in embed" flag (the one the player obeys), the answers are remembered on disk, and Home never shows them.
- Search shows its results at once, then checks the YouTube videos in small batches and greys out the ones that can't be played as the answers arrive (no need to leave and come back).
- Clicking a track that can't be embedded no longer jumps into recommendations: the app looks for its SoundCloud twin and plays that, otherwise it says the track can't be played here and leaves the current music alone.
- When a picked track and its automatic recommendations were fetched at the same time, the queue could get two batches. It now waits for the first one.
- The "Artists" and "Playlists and albums" blocks in search sometimes failed for YouTube Music; each kind is now searched separately.

## 0.3.3

### Added
- The album name under a track (lists and the now-playing panel) opens the album page, like the artist name does. Older entries without a stored album id look the album up by name.

## 0.3.2

### Fixed
- Playing a single track from Home, from search results or from an artist's song list no longer queues the whole list. Only that track is queued, followed by 5 recommended tracks; when the queue ends, 5 more are added, and so on. Albums, playlists and the Liked list still queue everything, as before.

## 0.3.1

### Added
- Artist pages inside the app (YouTube Music and SoundCloud): photo, description, all songs, and shelves of albums, singles, playlists and related artists. Click an artist's name in any list or in the now-playing panel to open it; Back returns to where you were.
- Album and playlist pages with Play, Shuffle and "Save to my playlists", which copies the whole list into a playlist of your own.
- Search now also shows matching artists and playlists/albums next to the tracks. Playlists and albums can be saved straight from the result row.

### Changed
- Tracks remember their artist's id, so history, queue and playlists can open the artist page too (older entries look the artist up by name).

## 0.3.0

### Added
- Likes and dislikes: buttons next to the playing track, a "Liked" tab (liked and disliked lists), and a mark on tracks in every list. Liked tracks influence recommendations; disliked ones are hidden from Home and from similar tracks, and a disliked track that is playing is skipped.
- Search shows one list for both services, ordered by how well a result fits the query. The same song found on YouTube Music and SoundCloud is a single row.
- Rows show which services have the track (YouTube / SoundCloud icons next to the duration). A YouTube version that can't be embedded is grey; a track that can't be played anywhere is greyed out with a crossed-circle icon.
- The now-playing panel shows both platforms the same way.

### Changed
- Home never shows videos that can't be embedded. When the player itself refuses a video, the app remembers it and stops offering it on Home, in search pairs and in similar tracks.

## 0.2.8

### Fixed
- History and playlists could be lost when a save was interrupted and left an empty file. Saves are now flushed to disk before the file is replaced, the previous good copy is kept as `.bak`, and an unreadable file is restored from it instead of starting empty.

## 0.2.7

### Added
- Settings: "Priority" is now a three-position slider (YouTube Music / SoundCloud / none). SoundCloud priority looks for the SoundCloud version of a YouTube track.
- Home shelves can be dragged sideways with the left mouse button, and each shelf is shown as its own recessed block.

### Changed
- All scrollbars share the thin rounded style of the lists, including the Home shelves and the now-playing panel.
- A SoundCloud track that can't be played falls back to its YouTube Music version, with a clearer message when there is none.
- Similar tracks fall back to the artist's other tracks when SoundCloud has no "related" list for a track.

### Fixed
- A scrollbar flashed in the now-playing panel while resizing the window vertically.

## 0.2.6

### Changed
- The tray player now opens on a right click of the tray icon (instead of the left click) and replaces the old menu on Windows. A left click shows or hides the window. The player has Open window and Quit buttons in its corner.

## 0.2.5

### Fixed
- Publishing a release could mix up versions: a build for one version could land in the draft of another, with files and descriptions doubled and the draft shown under an "untagged-..." name. One step now creates the draft with its description, and the builds only upload to that exact draft. Published releases are never touched.

## 0.2.4

### Added
- When the queue ends, similar tracks are added and playback goes on, and again at every end of the queue (YouTube Music "up next" for YouTube tracks, SoundCloud related tracks for SoundCloud ones). Nothing already in the queue is repeated. Turn it off in Settings > General: "Keep playing similar tracks". With "repeat all" on, the queue loops as before.

## 0.2.3

### Added
- Clicking the tray icon opens a small player: cover, title and artist, a progress line (click it to seek) and horizontal Previous / Play-Pause / Next buttons. It closes when you click elsewhere or press Esc. The right-click menu stays (Show, Quit and the same controls).
- A "Clear queue" button in the Queue tab (the playing track stays).

### Changed
- Playing a track from History now plays only that track instead of filling the queue with the whole history.

## 0.2.2

### Changed
- Home lists are now horizontal rows of cards (cover, title, artist) that scroll sideways, with arrows next to each title, so you can reach the list you want without scrolling past every track.
- Home now always shows YouTube Music's own shelves (home page and Explore: popular, new releases and so on), not only for new users.

## 0.2.1

### Added
- A setting "Start with the system" (Settings > General): launches Glass Player when you sign in. It starts hidden in the tray when the tray icon is available.

## 0.2.0

### Added
- A Home tab (the first one) with recommendations built from your listening history on this computer: "For you" lists for YouTube Music and SoundCloud, and "Because you listened to ..." for your most played tracks. Tracks you already know and videos that cannot be played here are left out.
- YouTube suggestions come from YouTube Music's own "up next" lists for your tracks; SoundCloud suggestions from SoundCloud's related tracks.
- A "Trending on SoundCloud" list. With little history, shelves from the YouTube Music home page are shown too.
- A Refresh button on Home. Suggestions are cached for 30 minutes.

## 0.1.5

### Added
- A tray icon. Its tooltip shows the current track and time; its menu has the track, Previous / Play-Pause / Next, Show or Hide the window, and Quit. Clicking the icon shows or hides the window.
- A setting "Keep running in the tray": when on, the window's close button hides the window to the tray instead of quitting.
- Only one copy of the app runs at a time: starting it again brings the existing window back.

## 0.1.4

### Changed
- The clear (x) button in the search field also clears the results list.

### Fixed
- The big cover in the now-playing block is loaded in a higher resolution (YouTube Music and SoundCloud), so it is no longer blurry.
- A scrollbar no longer appears in the now-playing block: the square cover fits the available height.
- "Repeat all" and "Repeat one" looked the same; "Repeat one" now shows a "1" on the icon.

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
