# Folder Sidebar

Arc-style sidebar for Chrome: pinned grid, spaces, nested folders, open tabs.
Everything is stored as plain Chrome bookmarks under **Other bookmarks › Arc Sidebar**,
so it syncs with your Google account and survives if you remove the extension.

## Install
1. Unzip somewhere permanent (e.g. ~/Applications/folder-sidebar). Chrome loads it from that folder.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick the folder.
3. Chrome Settings › Appearance › Side panel › **Show on left**.
4. Click the extension's toolbar icon (pin it) or press **Option+S** to open the sidebar.
5. In the sidebar: **⋯ › Import from Arc…** and pick your StorableSidebar.json.

## Use
- Click a saved link: jumps to its tab if open, otherwise opens it. Cmd-click opens a fresh copy.
- × on an open saved link closes the tab and keeps the link.
- Drag open tabs into folders, the pinned grid, or onto a space icon to save them.
- Drag saved links/folders to reorder or nest. Hover a folder while dragging to open it.
- Drag an open saved link down into the tab list to unpin it.
- Double-click to rename. Right-click for everything else (new folder, delete, edit URL, space icon/color).
- Two-finger swipe sideways switches spaces. Search box filters every saved link in every space.

## Media drawer
Click ♫ at the bottom (next to the space icons) to open the drawer. Sources are set up in
**⋯ → Music Settings…**. When something is playing, a mini
player sits above the space icons; click it to open the drawer.

- **Chrome tabs** playing sound appear automatically, with mute and a jump-to-tab link. In Music Settings, click **Turn on**
  once to allow play/pause/skip on YouTube, YouTube Music, Tidal, Spotify web and SoundCloud.
- **Chromecasts** (anyone's casts, any app) need the helper on this Mac:
  `bash cast-helper/install.sh` — click Allow if macOS asks about local network devices.
  Remove with `bash cast-helper/uninstall.sh`. Log: `~/Library/Logs/FolderSidebarCast.log`.
- **Your Spotify**: click **Connect** and follow the steps (needs Premium and a free Spotify developer app).

## Updating
Edit the files, then hit the reload arrow on the extension in `chrome://extensions`.
