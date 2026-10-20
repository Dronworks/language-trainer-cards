# Language Trainer Cards

An Obsidian plugin for training vocabulary with flashcards and mastery tracking.

## Features

- Flashcard-style learning interface
- Two directions with independent grading: forward (IT → EN, recognition) and reverse (EN → IT, recall)
- Mastery tracking with multiple levels
- Progress persistence across sessions
- Cross-platform support (desktop and Android)
- Automatic sync via Obsidian vault storage
- Keyboard shortcuts for efficient studying
- Customizable settings

## Installation

1. Copy this folder to your Obsidian vault's `.obsidian/plugins/` directory
2. Reload Obsidian
3. Enable the plugin in Settings → Community plugins
4. Use the command "Open trainer — forward (IT → EN)" or "Open trainer — reverse (EN → IT)" to start

## Usage

- Click on the prompt word or press Space to flip the card and see translation/pronunciation/example
- The grade buttons adapt to the training mode (pool):
  - **New** (0–2★): Don't know (−1★), Kind of (+1★), Know (→3★), Too easy (→5★ mastered)
  - **Learning** (3–4★): Don't know, Kind of, Too easy
  - **Mastered** (5★): Keep / Skip, Don't know (back to Learning), Archive (hide the word everywhere)
  - **Archived**: Know (keep archived), Don't know (release back to the New pool at 0★)
- Number keys 1–4 trigger the visible buttons; K = Know, D = Don't know where offered
- Press R or the ⇄ button to switch direction: forward (IT → EN) or reverse (EN → IT)
- Each direction has its own independent mastery progress; archiving is per word (both directions)
- Press N on the completion screen to start a new set
- Progress is automatically saved

## Data Storage

Mastery data is stored in `language-trainer-progress.json` in your vault root, ensuring it syncs across devices via Obsidian Sync or other sync methods.

## Development

This plugin was created for personal vocabulary training using markdown files in a configurable folder (default: `Italian/`). Each vocabulary file should follow the standard format with translation, pronunciation, and example sections. The plugin works with any language by simply changing the vocabulary folder in settings.

## License

MIT