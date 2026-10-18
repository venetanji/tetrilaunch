# Provisional Steam achievements

This is the first proposed achievement list for App ID **5270760**. Names,
descriptions and art can be edited before publishing in Steamworks. The 21 API
names are shared with the game implementation: changing one also requires a
matching code and regression-test change.

`catalog.json` is the source for the English copy, visibility, tier and icon
family. The generated CSV files retain the exact headers from the owner's
downloaded Steamworks templates, encoded as UTF-8 with a BOM and CRLF line
endings. The original downloads in the repository root are untouched.

## Proposed list

Each tier from **1 through 10** has an achievement for unlocking it. Tier 1 is
available at the start, so **First Floor** is the welcoming first achievement;
tiers 2 through 10 are named **Moving Up: Tier N**. Their API names are
`TIER_1_UNLOCKED` through `TIER_10_UNLOCKED`.

The four skill achievements are earned once across eligible game modes:

| Name | Requirement |
| --- | --- |
| Clear Passage | Win all 10 bays of a Deep Run or Skydeck run without ever entering congestion. |
| Clean Slate | Empty the board with a line clear; demolition alone does not qualify. |
| Triple Sweep | Clear at least 3 lines in one clear event. |
| Quad Sweep | Clear at least 4 lines in one clear event. |

A four-line clear earns both Triple Sweep and Quad Sweep. Board clears and
multiline clears count during real daily Contracts, Deep Runs and Skydeck runs.
Clear Passage requires a full run, and congestion history persists across bay
retries. Flight School, system drills, Tier S practice and Sandbox cannot award
skill achievements. These skills are not inferred from older saves, which do not
record the necessary evidence.

| Name | API name | Requirement |
| --- | --- | --- |
| First Delivery | `FIRST_CONTRACT` | Win a real daily Contract. |
| Half the Workshop | `SYSTEMS_HALF` | Own at least 5 of the 10 Workshop systems. |
| Fully Equipped | `SYSTEMS_ALL` | Own all 10 Workshop systems. |
| Above and Beyond | `SKYDECK_OPEN` | Finish the tier ladder and hold all 10 seals. |
| Top Deck | `SKYDECK_WIN` | Win a real Skydeck run. |
| Signal Found | `SECRET_TIER_S` | Discover the hidden Tier S through its beacon gesture. Hidden in Steam. |
| Unbroken | `FULL_CHAIN` | Win a Deep Run or Skydeck bay with every clear in one chain, no lost cargo and no congestion. |

Workshop ownership includes stowed systems and the stock Reactor. Upgrading a
system repeatedly still counts as one system. Temporary refit upgrades and
retired unlock cards do not add to this count. Unbroken uses the game's existing
`fullChain` verdict when the bay objective is met.

## Import into Steamworks

1. Upload `5270760-achievements-definitions.csv` in **Achievement Definitions CSV**.
2. Upload `5270760-achievements-localization.csv` in **Achievement Localization CSV**.
3. Upload the PNG files inside `icons.zip` in **Achievement Icons**. The archive
   is a convenience for extracting/selecting all 42 images; upload the PNGs if
   the dashboard does not accept ZIP files.
4. Review the proposed list and icons in Steamworks before publishing the changes.

Every achievement uses `Client` permission, has no set or progress stat, and is
not archived. `SECRET_TIER_S` is the only row marked as a spoiler. English is the
only currently configured localization language; configure additional Steamworks
languages before extending the CSV.

`5270760-achievement-sets-localization.csv` deliberately contains only its header:
there are no achievement sets yet. Skip that import. Sets must first be created
in Steamworks, and their assigned IDs must be used before adding set localization
or filling the `setid` column in definitions.

## Art and reproducibility

`icons/` contains **42 opaque RGB PNGs at 256 x 256**, named exactly
`API_NAME_ACHIEVED.png` and `API_NAME_UNACHIEVED.png`. Unachieved images are
grayscale versions of the achieved icons, dimmed to 70%. Both states are supplied,
so the dashboard's automatic grayscale generation is optional.

The art follows the game's square-ended glyphs, neon palette, dark grid and
stepped industrial frames. Tier numerals use geometry, and the achievement
families retain distinct silhouettes in grayscale. The contact sheet shows
achieved art at 128 px alongside each unachieved icon at 64 px.

From `app/`, regenerate or verify without changing the imports in Steamworks:

```sh
node scripts/steam-achievements.mjs
node scripts/steam-achievements.mjs --check
```

The generator uses the existing `sharp` dependency from `@capacitor/assets`, as
the project's other asset scripts do. It adds no dependencies and does not
require a browser or image service. If dependencies were installed with lifecycle
scripts disabled, run `npm rebuild sharp --foreground-scripts` first.

Check mode verifies the 21 API names, exact generated CSV content, icon file
parity, every PNG's dimensions and RGB color space, grayscale unachieved pixels,
and archive/contact-sheet consistency. `contact-sheet.png` is for review only;
it is not an achievement icon to upload.

Publishing these definitions is separate from shipping the Steam app. The
runtime cannot award IDs that have not been created and published for this App
ID. A real Steam client playtest must still confirm the native API unlock and
Steam overlay notification after the definitions are configured.
