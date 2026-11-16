# Layouter

A small macOS menu-bar app that sets up your windows automatically. It is native Swift with no dependencies. It sits idle until something happens, so it doesn't poll or use CPU in the background.

- **Profiles per environment** (work / home / laptop only). The profile is picked from the displays that are connected, and it re-applies when displays change or the Mac wakes.
- **Launches apps** from a list if they aren't already running. They open in the background.
- **Places windows by rule**: app (and an optional title regex) → display → desktop → layout.
- **Spaces support**: moves windows to desktop *N* on a given display.
- **Capture**: saves your current arrangement as a profile you can paste into the config.
- Has a launch-at-login toggle and URL commands (`layouter://apply?profile=work`) for Raycast, Alfred, Shortcuts or Stream Deck.

## Build & install

You need Xcode or the Command Line Tools (Swift 5.9+) on macOS 13 or later.

```bash
cd projects/layouter
./build.sh --install        # builds build/Layouter.app, copies to /Applications, launches
```

On first launch:

1. **Accessibility**: allow Layouter in System Settings › Privacy & Security › Accessibility. This is needed to move windows.
2. **Desktop shortcuts**: in System Settings › Keyboard › Keyboard Shortcuts › Mission Control, turn on **"Switch to Desktop 1…N"**. Layouter switches desktops with Ctrl+1…9.
3. **Create the desktops** your rules use, in Mission Control. Layouter can't create desktops.
4. Optional: turn on **Reduce motion** (Accessibility › Display). Desktop switches become instant, so you can lower `spaceSwitchDelay` to about 0.3.
5. Use the menu-bar icon › **Launch at Login**.

> With ad-hoc signing, macOS drops the Accessibility grant after every rebuild. If that happens, remove Layouter from the list and add it again. You can also sign with a stable identity: `SIGN_ID="Apple Development: …" ./build.sh --install`.

## Configure

The config file is `~/.config/layouter/config.json`. A starter copy is written there on first run. Open it from the menu with **Edit Config**, then use **Reload Config** (⌘R) after editing.

Quick start:
1. Arrange your windows by hand.
2. Choose **Show Displays & Desktops** to see the display references (refs) to use in the config.
3. Choose **Capture Current Layout**. This writes `captured-*.json` with a ready-made profile: display match, launch list, and one rule per window.
4. Rename the profile and paste it into `profiles`. Repeat on each desktop and merge the rules.

```jsonc
{
  "settleDelay": 1.5,        // wait after a display change / wake before applying
  "spaceSwitchDelay": 0.7,   // wait after each desktop switch
  "launchTimeout": 20,       // max wait for a launched app's first window
  "manageSpaces": true,      // false = ignore "space" in rules, never switch desktops
  "applyOnAppLaunch": true,  // place an app's windows when you open it later
  "gap": 0,                  // px between windows / screen edges
  "profiles": [
    {
      "name": "work",
      "match": { "count": 3, "displays": ["builtin", "DELL#1", "DELL#2"] },
      "launch": ["com.google.Chrome", "com.tinyspeck.slackmacgap"],
      "rules": [
        { "app": "com.google.Chrome", "title": "Jira|Confluence", "display": "DELL#1", "space": 2, "layout": "left-half" },
        { "app": "com.google.Chrome",                              "display": "DELL#1", "space": 1, "layout": "maximize" },
        { "app": "com.tinyspeck.slackmacgap",                      "display": "builtin", "space": 1, "layout": { "x": 0, "y": 0, "w": 0.6, "h": 1 } }
      ]
    }
  ]
}
```

**Choosing a profile.** Every profile whose `match` holds is a candidate: all `displays` refs must be connected, and `count` must equal the number of displays if it's set. The most specific one wins: having `count` scores highest, then the number of refs. You can also pick a profile by hand from **Use Profile**. That choice lasts until the displays change.

**Display refs**

| Ref | Means |
|---|---|
| `main` | the display with the menu bar |
| `builtin` | the MacBook screen |
| `external`, `external:2` | the first or second external display, counted left to right |
| `left`, `right`, `index:3` | position, counted left to right |
| `DELL U2723QE`, `DELL#2` | a match on part of the name. Use `#N` to tell identical monitors apart, counted left to right |
| `serial:123456` | the exact serial number |

**Rules.** Each window uses the first rule that matches its app and title, so put title-specific rules first.
- `app`: the bundle ID. To find one, run `osascript -e 'id of app "Slack"'`.
- `display`: optional. If you leave it out, the window stays on its current display.
- `space`: the desktop number **on that display**, starting at 1. Desktop 1 on your second monitor is `1`.
- `layout`: one of `maximize`, `left-half`, `right-half`, `top-half`, `bottom-half`, `left-third`, `center-third`, `right-third`, `left-two-thirds`, `right-two-thirds`, `top-left`, `top-right`, `bottom-left`, `bottom-right`, `center`. It can also be `{x,y,w,h}` as fractions of the usable area, with the origin at the top left. If you leave it out, the window keeps its size.

**URL commands**: `open -g "layouter://apply"`, `layouter://apply?profile=home`, `layouter://auto`, `layouter://capture`, `layouter://reload`.

The log is at `~/Library/Logs/Layouter.log` (menu › Open Log).

## How it works / limitations

- Windows are moved through the public Accessibility API.
- **Spaces.** macOS has no public API for Spaces. Layouter *reads* desktops through long-standing private CoreGraphics calls. It *moves* a window the way you would by hand: it holds the window's title bar and presses Ctrl+N. During an apply, you'll see the cursor jump and the desktops switch. When it's done, it goes back to the desktop you were on. Because of how this works:
  - It works without disabling SIP and doesn't inject anything into the Dock. That makes it sturdier than yabai-style tools, but slower: about one desktop switch for each window that has to move.
  - Only desktops 1–9 can be reached, because of the Ctrl+1…9 shortcuts. Desktop numbers run across all displays in Mission Control order.
  - Windows that are already on the right desktop are only resized. Repeat applies are quick.
  - Don't type or click during an apply. Applies usually take a few seconds.
- The Accessibility API can only see windows on desktops that are showing. Layouter finds which hidden desktops hold windows from apps in your rules, then visits only those.
- When an app has several windows and none of its rules has a `title`, all of its windows go to the same place.
- Fullscreen-app spaces are ignored.
