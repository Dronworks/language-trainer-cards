# Language Trainer Cards Plugin — Implementation Summary

Flashcard-style vocabulary trainer for an Obsidian vault. Vocabulary lives as markdown files in a configurable folder (default `Italian/`). Progress is stored in the vault so it syncs across devices.

See `README.md` for the user-facing description; this file summarizes how the current implementation behaves.

## Features

1. **Cross-platform**: works on desktop and Android (`isDesktopOnly: false`).
2. **Configurable vocabulary folder**: default `Italian`, changeable in settings.
3. **Vault-based progress storage**: `language-trainer-progress.json` in the vault root.
4. **Two directions with independent progress**: forward (word → translation, recognition) and reverse (translation → word, recall).
5. **Mastery tracking**: six levels (0–5★), with New (0–2★), Learning (3–4★), and Mastered (5★+) pools.
6. **Per-mode buttons**: the grade buttons adapt to the pool being studied (see below).
7. **Archive**: mastered words can be archived (hidden from every pool) and reviewed/released via a dedicated Archived mode.
8. **Session persistence**: the current set, position, mode, and direction are saved and resumed on reopen; archived words are dropped from non-archived sessions.
9. **Undo**: the Back button reverses the most recent grade (including archive/release).
10. **Settings tab**: folder, words per session, training mode, pronunciation/examples toggles, reset session, reset progress.

## File scanning

- Scans `.md` files under the configured folder.
- Skips any file whose path **relative to the vocabulary folder** has a `_`-prefixed segment (e.g. `Italian/_meta/Index.md`). A `_` segment above the vocabulary folder does not affect loading.

## File parsing contract

Each vocabulary page is parsed by regex, so the format is a contract:

| Field | Source |
| --- | --- |
| Foreign term | filename (minus `.md`) |
| English translation | first `### ` line |
| Pronunciation | `> [!info] Pronunciation` → `> /IPA/ · Respelling` on one line |
| Example | `> [!example] Example` → `> **Italian sentence.**` then `> *English sentence.*` (fold marker `-` allowed after `]`) |
| Synonyms | `> [!tip] Synonyms` → `[[word]] · [[word]]` (wiki links; shown on the card in reverse mode, answer side) |
| Part of speech | first `#word` line (defaults to `unknown`) |

## Mastery model

Grade actions:

| Action | Effect |
| --- | --- |
| Don't know | `level = max(0, level-1)` |
| Kind of | `level = min(5, level+1)` |
| Know | `level = 3` |
| Too easy | `level = 5` |
| Keep / Skip | stay at 5, advance (Mastered mode only) |
| Don't know (Mastered) | `level = 3` — back to the Learning pool |
| Archive | set `archived: true` (levels frozen; Mastered mode only) |
| Know (Archived) | stays archived |
| Don't know (Archived) | release: `archived = false`, both directions reset to 0 |

A word is "known" at level ≥ 3 and "mastered" at level ≥ 5. Reverse mode only offers words that have a translation.

## Modes and buttons

| Mode | Pool | Buttons |
| --- | --- | --- |
| New | 0–2★ | Don't know, Kind of, Know, Too easy |
| Learning | 3–4★ | Don't know, Kind of, Too easy |
| Mastered | 5★ | Keep / Skip, Don't know, Archive |
| All | any non-archived | Don't know, Kind of, Know, Too easy |
| Archived | archived words | Know (keep), Don't know (release) |

Archived words are excluded from every pool except Archived mode. Archiving is global (per word, not per direction); Archived mode is direction-agnostic and always prompts with the foreign word.

## Card display

Pronunciation and part of speech travel with the foreign word: on the card front in forward mode (so the prompt can be read correctly), on the back in reverse mode (where the foreign word is the answer).

## Commands and shortcuts

- Commands: "Open trainer — forward (word → translation)", "Open trainer — reverse (translation → word)", "Add vocabulary word" (scaffolds a word note in the vocabulary folder), "Reload vocabulary".
- Ribbon icon: `graduation-cap`.
- Keyboard: Space/Enter flip, 1–4 map to the buttons shown in the current mode, K = Know and D = Don't know only where those buttons exist, R = switch direction (disabled in Archived mode), N = new set (completion screen only).

## Data storage

Progress is stored per word, per direction, with an optional entry-level `archived` flag:
```json
{
  "Italian/a.md": {
    "forward": { "known": false, "reviewDate": null, "masteryLevel": 0, "lastReviewed": null },
    "reverse": { "known": false, "reviewDate": null, "masteryLevel": 0, "lastReviewed": null },
    "archived": true
  }
}
```
The plugin also migrates the older flat format (`{ known, masteryLevel, ... }`) to this per-direction shape on load, and preserves the `archived` flag across the rebuild.

## Files

```
.obsidian/plugins/language-trainer/
├── manifest.json            # Plugin metadata
├── main.js                  # Core plugin logic
├── styles.css               # UI styling
├── README.md                # User-facing documentation
└── IMPLEMENTATION_SUMMARY.md  # This file
```

`data.json` is written by Obsidian to persist plugin settings; it is not part of the install set.
