---
name: add-word
description: Add or update a vocabulary word page for the Language Trainer Cards Obsidian plugin — word and phrase notes with translation, pronunciation, example, and synonym links. Use when the user gives a word or phrase to add to their vocabulary folder.
---

# Add a vocabulary word

Word pages live as one markdown file per word in the plugin's configured
vocabulary folder (default `Italian/`). The plugin parses pages with regexes,
so the layout below is a **parsing contract** — keep the callout types and
punctuation exactly, or cards silently lose fields.

## 1. Page name

- One page per **base form**, lowercase: verbs → infinitive, nouns → singular,
  adjectives → the citation form, contractions → the base word.
- A multi-word combination with its **own meaning** is a phrase page, named
  exactly as the phrase. Combinations with no new meaning are not pages — put
  them as a note on the base word's page.
- File name (minus `.md`) is the word on the flashcard. Characters that are
  invalid in file names (`/ \ : * ? " < > |`) must be replaced with `-`.
- If the page already exists, **update it** instead of creating a duplicate.

## 2. Page layout

Copy `templates/word-template.md` and fill it in. Order:

```markdown
### <translation(s) in the user's language, separated by " / ">
#<part of speech>


> [!info] Pronunciation
> /<IPA>/ · <Respelling>


> [!example] Example
> **<short sentence in the studied language>**
> *<translation of the sentence>*


> [!abstract]- Forms        ← optional, for words that inflect


> [!quote] Phrases          ← optional, links to phrase pages containing this word


> [!tip] Synonyms           ← optional, wiki links only


> [!note] Notes             ← optional, "- " bullets: grammar, irregularities, usage
```

## 3. What the plugin parses (keep exact)

- **File name** → the word on the card.
- **First `### ` line** → translation on the back. Required for reverse mode.
- **`> [!info] Pronunciation`** → `/IPA/ · Respelling` on one line, joined with
  ` · ` (middle dot U+00B7).
- **`> [!example] Example`** → bold foreign sentence, then a later italic
  translation. A fold marker (`> [!example]-`) is allowed and still parses.
- **`> [!tip] Synonyms`** → `[[word]] · [[word]]` wiki links only; shown in
  reverse mode as alternative answers.
- **First `#tag` line** → part of speech hint.

Everything else (Forms, Phrases, Notes, free text) is ignored by the parser —
keep it for the reader.

## 4. Pronunciation

Use your language's conventions; the plugin only needs `/IPA/ · Respelling` on
one line.

- **IPA**: mark stress (ˈ) and syllable breaks (.) per your language's rules.
- **Respelling**: a simple hint the user can read at a glance — hyphenated
  syllables with the stressed one in CAPITALS (e.g. *cioè* → `cho-E`).

## 5. Links — keep them two-way

- **Synonyms**: link only real synonyms. Always add the reverse link on the
  other word's `> [!tip] Synonyms` callout.
- **Phrases**: from a word page, link phrase pages that contain it; on a phrase
  page, note what it is made of and link the parts that have pages.
- After editing links, re-apply the folding rule: a callout with **3 or fewer
  content lines stays open**; more than 3 lines is collapsed with `-`
  (`> [!abstract]- Forms`). Pronunciation is always open.

## 6. Finish

Report which pages were created or updated and any links added to existing pages.
