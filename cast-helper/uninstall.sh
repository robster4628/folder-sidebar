#!/bin/bash
# Stops and removes the Folder Sidebar cast helper.
LABEL="com.foldersidebar.casthelper"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/Library/Application Support/FolderSidebarCast"
echo "Cast helper removed. (Log left at ~/Library/Logs/FolderSidebarCast.log)"
