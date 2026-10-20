# Language Trainer Cards

Flashcard-style vocabulary trainer for Obsidian, for **any language**. It turns
your own markdown notes — one note per word — into a study deck with mastery
tracking, and works in both directions: forward (word → translation) and
reverse (translation → word), with independent progress for each.

## Features

- Flashcard-style learning interface
- Two directions with independent grading: forward (word → translation, recognition) and reverse (translation → word, recall)
- Mastery tracking with pools: New (0–2★), Learning (3–4★), Mastered (5★+), and an Archive
- Progress persistence across sessions and devices (stored in the vault)
- Cross-platform support (desktop and mobile)
- Keyboard shortcuts for efficient studying
- **Add vocabulary word** command that scaffolds a correctly-formatted word note
- Works with any language — just point it at a folder of word notes

## Installation

1. Copy `main.js`, `manifest.json`, and `styles.css` to your vault's
   `.obsidian/plugins/language-trainer-cards/` directory
2. Reload Obsidian
3. Enable the plugin in Settings → Community plugins
4. Set the vocabulary folder in the plugin settings (default: `Italian`)
5. Run the command **Open trainer — forward (word → translation)** or
   **Open trainer — reverse (translation → word)** to start

## Vocabulary folder

The plugin reads every markdown file in the configured folder as one word.
Files and folders whose names start with `_` are ignored, so you can keep
indexes and reference notes next to the words (e.g. `Italian/_meta/Index.md`).

## Creating words

Each word is a markdown note. Use the **Add vocabulary word** command to fill a
form and create the note, or write the file by hand (see
[`templates/word-template.md`](templates/word-template.md)).

The plugin reads these blocks from a note:

```markdown
### house / home          ← translation (first ### line)
#noun                     ← part-of-speech tag (optional)


> [!info] Pronunciation
> /haʊs/ · HAUS


> [!example] Example
> **Das Haus ist groß.**
> *The house is big.*


> [!tip] Synonyms
> [[Heim]] · [[Zuhause]]
```

- **File name** (minus `.md`) → the word on the card.
- **`### ` line** → the translation shown on the back. Required for reverse mode.
- **Pronunciation** callout → `/IPA/ · Respelling` on one line (optional).
- **Example** callout → a bold sentence in the studied language, then an italic
  translation (optional; fold markers like `[!example]-` are fine).
- **Synonyms** callout → `[[wiki links]]` joined with ` · ` (optional; shown in
  reverse mode, where they act as alternative answers).
- **First `#tag` line** → part of speech hint (optional).

Anything else in the note — tables, extra notes, links — is ignored, so keep
whatever you like in your word files.

## Usage

- Click the prompt word or press **Space** to flip the card.
- The grade buttons adapt to the pool being studied:
  - **New** (0–2★): Don't know (−1★), Kind of (+1★), Know (→3★), Too easy (→5★ mastered)
  - **Learning** (3–4★): Don't know, Kind of, Too easy
  - **Mastered** (5★): Keep / Skip, Don't know (back to Learning), Archive (hide everywhere)
  - **Archived**: Know (keep archived), Don't know (release back to New at 0★)
- Number keys **1–4** trigger the visible buttons; **K** = Know, **D** = Don't know where offered.
- Press **R** or the **⇄** button to switch direction; each direction has its own mastery progress.
- Press **N** on the completion screen to start a new set.
- Progress is saved automatically.

## Data Storage

Mastery data is stored in `language-trainer-progress.json` in your vault root,
so it syncs across devices via Obsidian Sync or other sync methods.

## License

MIT
