const { Plugin, Modal, Setting, Notice, PluginSettingTab, TFile, TFolder } = require('obsidian');

const DEFAULT_SETTINGS = {
	folder: 'Italian',
	wordsPerSession: 20,     // renamed from dailyWordLimit
	trainingMode: 'new',     // 'new' | 'review' | 'mastered' | 'all' | 'archived'
	direction: 'forward',    // 'forward' (word→translation) | 'reverse' (translation→word)
	showPronunciation: true,
	showExamples: true,
	session: null            // { set: [wordId...], index: number, mode: string, direction: string }
};

module.exports = class LanguageTrainerPlugin extends Plugin {
	async onload() {
		// Load settings and migrate old setting name
		const loaded = await this.loadData() || {};
		if (loaded.dailyWordLimit !== undefined && loaded.wordsPerSession === undefined) {
			loaded.wordsPerSession = loaded.dailyWordLimit;
		}
		delete loaded.dailyWordLimit;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		await this.saveSettings();

		// Commands to open the trainer — one per direction
		// (same settings for both modes, but grading is tracked separately)
		this.addCommand({
			id: 'open-language-trainer',
			name: 'Open trainer — forward (word → translation)',
			callback: () => {
				this.openTrainer('forward');
			}
		});

		this.addCommand({
			id: 'open-language-trainer-reverse',
			name: 'Open trainer — reverse (translation → word)',
			callback: () => {
				this.openTrainer('reverse');
			}
		});

		// Command to scaffold a new vocabulary word note in the configured folder
		this.addCommand({
			id: 'add-vocabulary-word',
			name: 'Add vocabulary word',
			callback: () => {
				new AddWordModal(this).open();
			}
		});

		// Ribbon icon — left sidebar on desktop, side menu on phone
		this.addRibbonIcon('graduation-cap', 'Open Language Trainer Cards', () => {
			this.openTrainer();
		});

		// Command to reload vocabulary (after changing the folder setting)
		this.addCommand({
			id: 'reload-language-trainer-vocabulary',
			name: 'Reload vocabulary',
			callback: async () => {
				this.vocabulary = await this.loadVocabulary();
				this.vocabularyLoaded = true;
				new Notice(`Language Trainer: ${this.vocabulary.length} words loaded from "${this.settings.folder}"`);
			}
		});

		// Settings tab
		this.addSettingTab(new LanguageTrainerSettingTab(this.app, this));

		// Vocabulary loads lazily on first trainer open — reading every word
		// file at startup makes Obsidian slow to launch on large folders
		this.vocabulary = [];
		this.vocabularyLoaded = false;
		this.progress = await this.loadProgress();
	}

	async ensureVocabularyLoaded() {
		if (!this.vocabularyLoaded) {
			this.vocabulary = await this.loadVocabulary();
			this.vocabularyLoaded = true;
		}
	}

	onunload() {
		// Cleanup if needed
	}

	openTrainer(direction) {
		if (direction && direction !== this.settings.direction) {
			this.settings.direction = direction;
			// Direction change invalidates the saved session
			this.settings.session = null;
			this.saveSettings(); // fire-and-forget
		}
		new LanguageTrainerModal(this).open();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async loadVocabulary() {
		const vocabulary = [];
		const folder = (this.settings.folder || 'Italian').replace(/^\/+|\/+$/g, '');
		// Walk only the vocabulary folder's tree (not the whole vault).
		// Files and folders whose names start with "_" are skipped, so
		// reference notes (e.g. Italian/_meta/Index.md) never become cards.
		const files = [];
		const root = this.app.vault.getAbstractFileByPath(folder);
		const walk = (f) => {
			for (const child of f.children) {
				if (child instanceof TFolder) {
					if (!child.name.startsWith('_')) walk(child);
				} else if (child instanceof TFile && child.extension === 'md' && !child.name.startsWith('_')) {
					files.push(child);
				}
			}
		};
		if (root instanceof TFolder) walk(root);

		for (const file of files) {
			try {
				const content = await this.app.vault.read(file);
				const word = this.parseVocabularyFile(file.path, content);
				if (word) {
					vocabulary.push(word);
				}
			} catch (error) {
				console.error(`Error parsing vocabulary file ${file.path}:`, error);
			}
		}

		if (vocabulary.length === 0) {
			new Notice(`Language Trainer: no words found in folder "${folder}". Check the folder setting.`);
		}

		return vocabulary;
	}

	parseVocabularyFile(filePath, content) {
		// Extract term from filename (without extension)
		const filename = filePath.split('/').pop().replace('.md', '');
		const foreignTerm = filename;

		// Extract translation (first line after ### )
		const translationMatch = content.match(/^###\s+(.+)/m);
		const translation = translationMatch ? translationMatch[1].trim() : '';

		// Extract pronunciation
		const pronunciationMatch = content.match(/\[!info\]\s+Pronunciation\s*[\s\S]*?>\s*\/(.+)\/\s*·\s*(.+)/);
		const pronunciation = pronunciationMatch ? {
			ipa: pronunciationMatch[1],
			respelling: pronunciationMatch[2]
		} : null;

		// Extract example:
		// > [!example] Example
		// > **Foreign language sentence.**
		// > *Native-language translation.*
		const exampleMatch = content.match(/\[!example\][-+]?\s+Example\s*[\s\S]*?>\s*\*\*(.+?)\*\*\s*[\s\S]*?>\s*\*(.+?)\*/);
		const example = exampleMatch ? {
			foreign: exampleMatch[1].trim(),
			english: exampleMatch[2].trim()
		} : null;

		// Extract synonyms:
		// > [!tip] Synonyms
		// > [[foo]] · [[bar]]
		const synonymsMatch = content.match(/\[!tip\][-+]?\s+Synonyms\s*\n((?:>[^\n]*(?:\n|$))*)/);
		const synonyms = synonymsMatch
			? [...synonymsMatch[1].matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(m => m[1].trim()).filter(Boolean)
			: [];

		// Extract part of speech
		const posMatch = content.match(/^#(\w+)/m);
		const partOfSpeech = posMatch ? posMatch[1] : 'unknown';

		return {
			id: filePath,
			foreign: foreignTerm,
			translation: translation,
			pronunciation: pronunciation,
			example: example,
			synonyms: synonyms,
			partOfSpeech: partOfSpeech,
			filePath: filePath
		};
	}

	freshDirectionProgress() {
		return { known: false, reviewDate: null, masteryLevel: 0, lastReviewed: null };
	}

	async loadProgress() {
		let raw;
		try {
			raw = JSON.parse(await this.app.vault.adapter.read('language-trainer-progress.json'));
		} catch (error) {
			// File doesn't exist yet, which is fine
			return {};
		}

		// Migrate old flat format { known, masteryLevel, ... }
		// → per-direction format { forward: {...}, reverse: {...} }
		const progress = {};
		let migrated = false;
		for (const id of Object.keys(raw)) {
			const e = raw[id];
			if (e && typeof e === 'object' && !e.forward && !e.reverse) {
			progress[id] = {
				forward: {
					known: !!e.known,
					reviewDate: e.reviewDate ?? null,
					masteryLevel: e.masteryLevel || 0,
					lastReviewed: e.lastReviewed || null
				},
				reverse: this.freshDirectionProgress()
			};
			if (e.archived) progress[id].archived = true;
			migrated = true;
		} else if (e && typeof e === 'object') {
			// Already per-direction — make sure both directions exist.
			// Preserve the entry-level `archived` flag (global, not per direction).
			progress[id] = {
				forward: e.forward || this.freshDirectionProgress(),
				reverse: e.reverse || this.freshDirectionProgress()
			};
			if (e.archived) progress[id].archived = true;
		}
		}

		if (migrated) {
			await this.app.vault.adapter.write('language-trainer-progress.json', JSON.stringify(progress, null, 2));
		}
		return progress;
	}

	async saveProgress() {
		const progressJson = JSON.stringify(this.progress, null, 2);
		// adapter.write creates the file if missing and overwrites if present
		await this.app.vault.adapter.write('language-trainer-progress.json', progressJson);
	}

	updateWordProgress(wordId, grade, direction = 'forward') {
		if (!this.progress[wordId]) {
			this.progress[wordId] = {};
		}
		const entry = this.progress[wordId];
		if (!entry[direction]) {
			entry[direction] = this.freshDirectionProgress();
		}
		let wp = entry[direction];
		const wasMastered = wp.masteryLevel >= 5;
		let demoted = false;

		switch (grade) {
			case 'dontknow':
				wp.masteryLevel = Math.max(0, wp.masteryLevel - 1);
				wp.known = wp.masteryLevel >= 3;
				demoted = wasMastered && wp.masteryLevel < 5;
				break;
			case 'kindof':
				wp.masteryLevel = Math.min(5, wp.masteryLevel + 1);
				wp.known = wp.masteryLevel >= 3;
				break;
			case 'know':
				wp.masteryLevel = 3;
				wp.known = true;
				demoted = wasMastered;
				break;
			case 'tooeasy':
				wp.masteryLevel = 5;
				wp.known = true;
				break;
			case 'keep':
				// Mastered-mode "still know": stay mastered, just advance
				wp.masteryLevel = 5;
				wp.known = true;
				break;
			case 'return':
				// Mastered-mode "don't know": send back to the Learning pool
				wp.masteryLevel = 3;
				wp.known = true;
				demoted = wasMastered;
				break;
			case 'archive':
				// Hide the word from every pool; mastery levels stay frozen
				entry.archived = true;
				break;
			case 'release':
				// Archived-mode "don't know": back to the New pool, from scratch
				entry.archived = false;
				entry.forward = this.freshDirectionProgress();
				entry.reverse = this.freshDirectionProgress();
				wp = entry[direction];
				break;
			case 'keeparchived':
				// Archived-mode "know": stays archived, no changes
				break;
		}

		wp.lastReviewed = new Date().toISOString();
		this.saveProgress();

		// Return info about what happened
		return {
			graduated: !wasMastered && wp.masteryLevel >= 5,
			demoted: demoted
		};
	}

	getWordProgress(wordId, direction = 'forward') {
		const entry = this.progress[wordId];
		return (entry && entry[direction]) || this.freshDirectionProgress();
	}
};

class LanguageTrainerModal extends Modal {
	constructor(plugin) {
		super(plugin.app);
		this.plugin = plugin;
		this.currentSet = [];   // array of word IDs
		this.setIndex = 0;
		this.setMode = null;    // trainingMode used when this set was generated
		this.showingAnswer = false;
		this.sessionGraduations = 0; // count of words graduated to mastered during this set
		this.history = [];      // stack of applied grades for undo (Back button)
		this._keyHandler = null;
		this._confirmOpen = false; // true while the direction-switch confirmation is shown
	}

	async onOpen() {
		this.contentEl.addClass('language-trainer-modal');

		await this.plugin.ensureVocabularyLoaded();

		if (!this.tryResumeSession()) {
			this.generateNewSet();
		}

		this.showingAnswer = false;
		this.displayWord();

		this._keyHandler = (event) => this.handleKey(event);
		document.addEventListener('keydown', this._keyHandler);
	}

	onClose() {
		if (this._keyHandler) {
			document.removeEventListener('keydown', this._keyHandler);
			this._keyHandler = null;
		}
		this.contentEl.empty();
	}

	direction() {
		return this.plugin.settings.direction === 'reverse' ? 'reverse' : 'forward';
	}

	addDirectionToggle() {
		const isForward = this.direction() === 'forward';
		const btn = this.contentEl.createEl('button', {
			cls: 'direction-toggle',
			text: `⇄ ${isForward ? 'word → translation' : 'translation → word'}`
		});
		btn.title = 'Switch direction (R)';
		btn.addEventListener('click', () => this.switchDirection());
	}

	switchDirection() {
		// Mid-set (at least one grade applied) → confirm first, since the
		// current set position and undo history will be discarded
		if (this.history.length > 0) {
			this.confirmSwitch().then(confirmed => {
				if (confirmed) this.applyDirectionSwitch();
			});
			return;
		}
		this.applyDirectionSwitch();
	}

	applyDirectionSwitch() {
		this.plugin.settings.direction = this.direction() === 'forward' ? 'reverse' : 'forward';
		this.plugin.settings.session = null;
		this.plugin.saveSettings(); // fire-and-forget
		this.history = [];
		this.generateNewSet(); // builds and saves a session in the new direction
		this.showingAnswer = false;
		this.displayWord();
	}

	confirmSwitch() {
		return new Promise((resolve) => {
			this._confirmOpen = true; // block trainer keyboard shortcuts while open
			let decided = false;
			const modal = new Modal(this.app);
			modal.onOpen = () => {
				const { contentEl } = modal;
				contentEl.createEl('h2', { text: 'Switch direction?' });
				contentEl.createEl('p', { text: 'Your current set position and undo history will be discarded. Grades you already made are kept.' });

				const buttonContainer = contentEl.createDiv();
				const switchBtn = buttonContainer.createEl('button', { text: 'Switch' });
				switchBtn.addEventListener('click', () => {
					decided = true;
					modal.close();
					resolve(true);
				});
				const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
				cancelBtn.addEventListener('click', () => {
					decided = true;
					modal.close();
					resolve(false);
				});
			};
			modal.onClose = () => {
				this._confirmOpen = false;
				if (!decided) resolve(false); // closed via Escape/X — treat as cancel
			};
			modal.open();
		});
	}

	handleKey(event) {
		if (this._confirmOpen) return; // confirmation modal is open — ignore trainer shortcuts
		if (event.target && event.target.isContentEditable) return;
		if (event.target && (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA')) return;

		switch (event.key) {
			case ' ':
			case 'Enter':
				event.preventDefault();
				this.toggleAnswer();
				break;
			case '1':
			case '2':
			case '3':
			case '4': {
				event.preventDefault();
				// Number keys map to the buttons actually shown in this mode,
				// so a hidden action can never be triggered by keyboard
				const grades = this.getModeGrades();
				const idx = parseInt(event.key, 10) - 1;
				if (idx < grades.length) {
					this.markGrade(grades[idx].key);
				}
				break;
			}
			case 'k':
			case 'K':
				// Only when the Know button is actually offered in this mode
				if (!this.getModeGrades().some(g => g.key === 'know')) break;
				event.preventDefault();
				this.markGrade('know');
				break;
			case 'd':
			case 'D':
				if (!this.getModeGrades().some(g => g.key === 'dontknow')) break;
				event.preventDefault();
				this.markGrade('dontknow');
				break;
			case 'r':
			case 'R':
				// Direction is meaningless in Archived mode
				if (this.plugin.settings.trainingMode === 'archived') break;
				event.preventDefault();
				this.switchDirection();
				break;
			case 'n':
			case 'N':
				// Only meaningful on the completion screen: start a new set
				if (this.setIndex >= this.currentSet.length && this.getEligibleWords().length > 0) {
					event.preventDefault();
					this.generateNewSet();
					this.showingAnswer = false;
					this.displayWord();
				}
				break;
		}
	}

	tryResumeSession() {
		const session = this.plugin.settings.session;
		if (!session || !session.set || session.set.length === 0) return false;
		// Mode or direction changed in settings → discard old session
		if (session.mode !== this.plugin.settings.trainingMode) return false;
		if ((session.direction || 'forward') !== this.direction()) return false;
		// Drop words that no longer exist in vocabulary, and words whose
		// archived state no longer matches this session's mode
		const vocabIds = new Set(this.plugin.vocabulary.map(w => w.id));
		const mode = this.plugin.settings.trainingMode;
		const validSet = session.set.filter(id => {
			if (!vocabIds.has(id)) return false;
			const archived = !!(this.plugin.progress[id] && this.plugin.progress[id].archived);
			return mode === 'archived' ? archived : !archived;
		});
		if (validSet.length === 0) return false;

		this.currentSet = validSet;
		// NOTE: do NOT clamp to length-1 — index == length means "set was complete",
		// and displayWord() will show the completion screen.
		this.setIndex = Math.min(session.index || 0, validSet.length);
		this.setMode = session.mode;
		return true;
	}

	saveSession() {
		this.plugin.settings.session = {
			set: this.currentSet,
			index: this.setIndex,
			mode: this.setMode,
			direction: this.direction()
		};
		this.plugin.saveSettings(); // fire-and-forget
	}

	getEligibleWords() {
		const mode = this.plugin.settings.trainingMode;
		const dir = this.direction();
		return this.plugin.vocabulary.filter(w => {
			const entry = this.plugin.progress[w.id];
			const archived = !!(entry && entry.archived);
			// Archived mode works through archived words only (direction-agnostic)
			if (mode === 'archived') return archived;
			// Archived words are excluded from every other pool
			if (archived) return false;
			// Reverse mode needs a translation prompt to show
			if (dir === 'reverse' && !w.translation) return false;
			const level = this.plugin.getWordProgress(w.id, dir).masteryLevel;
			if (mode === 'new') return level < 3;
			if (mode === 'review') return level >= 3 && level < 5;
			if (mode === 'mastered') return level >= 5;
			return true; // 'all'
		});
	}

	generateNewSet() {
		const mode = this.plugin.settings.trainingMode;
		const limit = this.plugin.settings.wordsPerSession;
		const eligible = this.getEligibleWords();

		this.setMode = mode;
		if (eligible.length === 0) {
			this.currentSet = [];
			this.setIndex = 0;
			this.sessionGraduations = 0;
			this.history = [];
			this.saveSession();
			return false;
		}

		const shuffled = this.shuffleArray(eligible.map(w => w.id));
		this.currentSet = shuffled.slice(0, Math.min(limit, shuffled.length));
		this.setIndex = 0;
		this.sessionGraduations = 0;
		this.history = [];
		this.saveSession();
		return true;
	}

	shuffleArray(array) {
		const a = [...array];
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[a[i], a[j]] = [a[j], a[i]];
		}
		return a;
	}

	countKnownInSet() {
		const dir = this.direction();
		return this.currentSet.filter(id => this.plugin.getWordProgress(id, dir).masteryLevel >= 3).length;
	}

	// Part of speech is a small hint label, never word-sized. Inline styles so
	// this holds even if styles.css hasn't reloaded/synced on a device yet
	// (the CSS class remains for theming).
	stylePosTag(el) {
		el.style.fontSize = '0.85rem';
		el.style.fontWeight = 'normal';
		el.style.fontStyle = 'italic';
		el.style.color = 'var(--text-faint)';
		el.style.letterSpacing = '0.5px';
	}

	// Button set depends on the training mode (pool) being studied
	getModeGrades() {
		const mode = this.plugin.settings.trainingMode;
		if (mode === 'archived') {
			return [
				{ label: "Don't know", key: 'release', cls: 'dont-know-button' },
				{ label: 'Know', key: 'keeparchived', cls: 'know-button' }
			];
		}
		if (mode === 'mastered') {
			return [
				{ label: 'Keep / Skip', key: 'keep', cls: 'know-button' },
				{ label: "Don't know", key: 'return', cls: 'dont-know-button' },
				{ label: 'Archive', key: 'archive', cls: 'kindof-button' }
			];
		}
		if (mode === 'review') {
			return [
				{ label: "Don't know", key: 'dontknow', cls: 'dont-know-button' },
				{ label: 'Kind of', key: 'kindof', cls: 'kindof-button' },
				{ label: 'Too easy', key: 'tooeasy', cls: 'tooeasy-button' }
			];
		}
		// 'new' and 'all'
		return [
			{ label: "Don't know", key: 'dontknow', cls: 'dont-know-button' },
			{ label: 'Kind of', key: 'kindof', cls: 'kindof-button' },
			{ label: 'Know', key: 'know', cls: 'know-button' },
			{ label: 'Too easy', key: 'tooeasy', cls: 'tooeasy-button' }
		];
	}

	displayWord() {
		this.contentEl.empty();

		if (this.currentSet.length === 0) {
			this.showEmptyPoolUI();
			return;
		}
		if (this.setIndex >= this.currentSet.length) {
			this.showSetCompleteUI();
			return;
		}

		const wordId = this.currentSet[this.setIndex];
		const word = this.plugin.vocabulary.find(w => w.id === wordId);
		if (!word) { // word file deleted mid-session — skip
			this.setIndex++;
			this.saveSession();
			this.displayWord();
			return;
		}

		const poolSize = this.getEligibleWords().length;
		const dir = this.direction();
		const mode = this.plugin.settings.trainingMode;
		const wp = this.plugin.getWordProgress(wordId, dir);

		// Header
		const headerDiv = this.contentEl.createDiv({ cls: 'modal-title' });
		headerDiv.createSpan({ text: `Word ${this.setIndex + 1} of ${this.currentSet.length}` });
		this.contentEl.createDiv({ cls: 'progress-text',
			text: mode === 'archived'
				? `${poolSize} words in archive`
				: `${poolSize} words in pool · ${this.countKnownInSet()} known in this set` });

		// Direction toggle (forward ⇄ reverse) — hidden in Archived mode,
		// which is direction-agnostic
		if (mode !== 'archived') {
			this.addDirectionToggle();
		}

		// Mastery dots (5 stages; word graduates at 5)
		const level = wp.masteryLevel;
		const stage = level >= 5 ? 'Mastered' : level >= 3 ? 'Learning' : 'New';
		const dotsDiv = this.contentEl.createDiv({ cls: 'mastery-dots' });
		const dots = '●'.repeat(Math.min(level, 5)) + '○'.repeat(5 - Math.min(level, 5));
		if (mode === 'archived') {
			dotsDiv.createSpan({ text: 'Archived' });
		} else if (level >= 5) {
			dotsDiv.createSpan({ text: `Mastered (${level}★)` });
		} else {
			dotsDiv.createSpan({ text: `${dots} · ${stage}` });
		}

		// Main prompt display (click to flip):
		// forward shows the foreign word, reverse shows the translation
		// Archived mode always prompts with the foreign word (direction-agnostic)
		const isForward = mode === 'archived' ? true : dir === 'forward';
		const wordDiv = this.contentEl.createDiv({ cls: 'language-word' });
		wordDiv.createSpan({ text: isForward ? word.foreign : word.translation });
		// Pronunciation and part of speech travel with the foreign word:
		// on the front in forward mode; on the back in reverse mode (where the
		// foreign word is the answer, so front display would give it away).
		if (isForward && word.pronunciation && this.plugin.settings.showPronunciation) {
			const frontPron = wordDiv.createDiv({ cls: 'pronunciation front-pronunciation' });
			frontPron.createSpan({ text: `/${word.pronunciation.ipa}/` });
			frontPron.createSpan({ text: ` · ${word.pronunciation.respelling}` });
		}
		if (isForward && word.partOfSpeech && word.partOfSpeech !== 'unknown') {
			const posDiv = wordDiv.createDiv({ cls: 'pos-tag', text: word.partOfSpeech });
			this.stylePosTag(posDiv); // inline so it can't inherit the 3em word size
		}
		wordDiv.createDiv({ cls: 'tap-hint', text: 'tap to reveal' });
		wordDiv.addEventListener('click', () => {
			this.toggleAnswer();
		});

		// Answer container (initially hidden)
		this.answerDiv = this.contentEl.createDiv({ cls: 'answer-container' });
		this.answerDiv.style.display = 'none';

		if (isForward) {
			if (word.translation) {
				const translationDiv = this.answerDiv.createDiv({ cls: 'translation' });
				translationDiv.createSpan({ text: word.translation });
			}
		} else {
			// In reverse mode the foreign word itself is the answer —
			// pronunciation and part of speech belong here, with that word
			const translationDiv = this.answerDiv.createDiv({ cls: 'translation' });
			translationDiv.createSpan({ text: word.foreign });
			if (word.partOfSpeech && word.partOfSpeech !== 'unknown') {
				const posSpan = translationDiv.createSpan({ text: ` · ${word.partOfSpeech}`, cls: 'pos-tag' });
				this.stylePosTag(posSpan);
			}
		}

		if (!isForward && word.pronunciation && this.plugin.settings.showPronunciation) {
			const pronDiv = this.answerDiv.createDiv({ cls: 'pronunciation' });
			pronDiv.createSpan({ text: `IPA: /${word.pronunciation.ipa}/` });
			pronDiv.createSpan({ text: ` · Respelling: ${word.pronunciation.respelling}` });
		}

		if (word.example && this.plugin.settings.showExamples) {
			const exampleDiv = this.answerDiv.createDiv({ cls: 'example' });
			exampleDiv.createSpan({ text: word.example.foreign, cls: 'example-foreign' });
			exampleDiv.createEl('br');
			exampleDiv.createSpan({ text: word.example.english, cls: 'example-english' });
		}

	// Synonyms are other foreign words, so they only make sense in reverse
	// mode (translation → word) where the foreign word is the answer — an
	// alternative answer set. They live on the answer side, revealed on flip.
		if (!isForward && word.synonyms && word.synonyms.length > 0) {
			const synDiv = this.answerDiv.createDiv({ cls: 'synonyms' });
			synDiv.createSpan({ text: 'Synonyms: ' });
			synDiv.createSpan({ text: word.synonyms.join(' · '), cls: 'synonyms-list' });
		}

		// Buttons
		const buttonContainer = this.contentEl.createDiv({ cls: 'button-container' });

		const grades = this.getModeGrades();
		grades.forEach(g => {
			const btn = buttonContainer.createEl('button', { text: g.label, cls: g.cls });
			btn.addEventListener('click', () => {
				this.markGrade(g.key);
			});
		});

		// Back button — undo the last grade (only when there is something to undo)
		if (this.history.length > 0) {
			const backBtn = buttonContainer.createEl('button', { text: '← Back', cls: 'back-button' });
			backBtn.addEventListener('click', () => {
				this.goBack();
			});
		}

		this.updateDisplay();
	}

	toggleAnswer() {
		this.showingAnswer = !this.showingAnswer;
		this.updateDisplay();
	}

	updateDisplay() {
		if (this.answerDiv) {
			// Inline style so no theme/CSS can reveal the answer early
			this.answerDiv.style.display = this.showingAnswer ? '' : 'none';
		}
	}

	markGrade(grade) {
		const wordId = this.currentSet[this.setIndex];
		// Snapshot the word's progress BEFORE grading, so Back can undo it
		// (deep copy — progress is nested per direction)
		const hadEntry = Object.prototype.hasOwnProperty.call(this.plugin.progress, wordId);
		const prev = hadEntry ? JSON.parse(JSON.stringify(this.plugin.progress[wordId])) : null;

		const result = this.plugin.updateWordProgress(wordId, grade, this.direction());
		this.history.push({
			index: this.setIndex,
			wordId: wordId,
			hadEntry: hadEntry,
			prev: prev,
			graduated: result.graduated
		});

		if (result.graduated) this.sessionGraduations = (this.sessionGraduations || 0) + 1;

		let msg;
		if (result.graduated) msg = 'Word mastered!';
		else if (result.demoted) msg = 'Demoted to Learning';
		else if (grade === 'dontknow') msg = '-1 star';
		else if (grade === 'kindof') msg = '+1 star';
		else if (grade === 'know') msg = 'Moved to Learning (3★)';
		else if (grade === 'tooeasy') msg = 'Moved to Mastered';
		else if (grade === 'keep') msg = 'Kept';
		else if (grade === 'return') msg = 'Back to Learning';
		else if (grade === 'archive') msg = 'Archived';
		else if (grade === 'release') msg = 'Back to New pool';
		else msg = 'Kept archived';
		new Notice(msg);

		// Grading always moves on to the next word
		this.nextWord();
	}

	nextWord() {
		this.setIndex++;
		this.showingAnswer = false;
		this.saveSession();
		this.displayWord(); // handles set-complete when index >= length
	}

	goBack() {
		if (this.history.length === 0) {
			new Notice('Nothing to undo');
			return;
		}

		const last = this.history.pop();
		// Restore the word's previous progress
		if (last.hadEntry) {
			this.plugin.progress[last.wordId] = last.prev;
		} else {
			delete this.plugin.progress[last.wordId];
		}
		this.plugin.saveProgress();

		if (last.graduated) {
			this.sessionGraduations = Math.max(0, (this.sessionGraduations || 0) - 1);
		}

		this.setIndex = last.index;
		this.showingAnswer = false;
		this.saveSession();
		new Notice('Grade undone');
		this.displayWord();
	}

	showSetCompleteUI() {
		const dir = this.direction();
		const mode = this.plugin.settings.trainingMode;
		const knownCount = this.currentSet.filter(id => this.plugin.getWordProgress(id, dir).masteryLevel >= 3).length;
		const poolRemaining = this.getEligibleWords().length;

		this.contentEl.createDiv({ cls: 'modal-title', text: 'Set complete!' });
		if (mode !== 'archived') {
			this.addDirectionToggle();
		}
		this.contentEl.createDiv({ cls: 'progress-text',
			text: mode === 'archived'
				? `Reviewed ${this.currentSet.length} archived words · ${poolRemaining} left in archive`
				: `Reviewed ${this.currentSet.length} words · ${knownCount} known · ${poolRemaining} left in pool` +
					(this.sessionGraduations > 0 ? ` · ${this.sessionGraduations} newly mastered` : '') });

		const buttonContainer = this.contentEl.createDiv({ cls: 'button-container' });

		if (poolRemaining > 0) {
			const newSetBtn = buttonContainer.createEl('button', { text: 'Start New Set', cls: 'know-button' });
			newSetBtn.addEventListener('click', () => {
				this.generateNewSet();
				this.showingAnswer = false;
				this.displayWord();
			});
		} else {
			const msg = mode === 'new'
				? 'New pool is empty! Switch to Learning or Mastered mode.'
				: mode === 'review'
				? 'Learning pool is empty. Grade new words with Kind of or Know first.'
				: mode === 'archived'
				? 'Archive is empty.'
				: 'Pool is empty.';
			this.contentEl.createDiv({ cls: 'progress-text', text: msg });
		}

		// Allow undoing the last grade from the completion screen too
		if (this.history.length > 0) {
			const undoBtn = buttonContainer.createEl('button', { text: '← Undo last grade', cls: 'back-button' });
			undoBtn.addEventListener('click', () => {
				this.goBack();
			});
		}

		const closeBtn = buttonContainer.createEl('button', { text: 'Close', cls: 'next-button' });
		closeBtn.addEventListener('click', () => this.close());
	}

	showEmptyPoolUI() {
		const mode = this.plugin.settings.trainingMode;
		const msg = mode === 'new'
			? 'No words in New pool (0–2★). Try Learning or Mastered mode.'
			: mode === 'review'
			? 'No words in Learning (3–4★). Grade new words with Kind of or Know to move them here.'
			: mode === 'mastered'
			? 'No mastered words yet. Words graduate at 5★ — or use Too easy to skip ahead.'
			: mode === 'archived'
			? 'No archived words. Archive words from Mastered mode to hide them.'
			: 'No vocabulary found. Check the folder setting.';
		this.contentEl.createDiv({ cls: 'modal-title', text: 'No words to study' });
		if (mode !== 'archived') {
			this.addDirectionToggle();
		}
		this.contentEl.createDiv({ cls: 'progress-text', text: msg });
		const buttonContainer = this.contentEl.createDiv({ cls: 'button-container' });
		const closeBtn = buttonContainer.createEl('button', { text: 'Close', cls: 'next-button' });
		closeBtn.addEventListener('click', () => this.close());
	}
}

class AddWordModal extends Modal {
	constructor(plugin) {
		super(plugin.app);
		this.plugin = plugin;
		this.fields = {
			word: '',
			translation: '',
			pos: '',
			ipa: '',
			respelling: '',
			exampleForeign: '',
			exampleEnglish: '',
			synonyms: ''
		};
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Add vocabulary word' });

		const addField = (label, key, placeholder = '') => {
			new Setting(contentEl)
				.setName(label)
				.addText(text => text
					.setPlaceholder(placeholder)
					.onChange(value => { this.fields[key] = value.trim(); }));
		};

		addField('Word', 'word', 'word or phrase in the studied language (file name)');
		addField('Translation', 'translation', 'meaning in your language');
		addField('Part of speech', 'pos', 'verb, noun, … (optional)');
		addField('Pronunciation IPA', 'ipa', 'e.g. ˈnɔt.te (optional, needs respelling too)');
		addField('Pronunciation respelling', 'respelling', 'e.g. NOT-te (optional, needs IPA too)');
		addField('Example sentence', 'exampleForeign', 'in the studied language (optional)');
		addField('Example translation', 'exampleEnglish', 'in your language (optional)');
		addField('Synonyms', 'synonyms', 'comma-separated, in the studied language (optional)');

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Create word')
				.setCta()
				.onClick(async () => {
					try {
						const err = await this.create();
						if (err) new Notice(err);
					} catch (e) {
						new Notice(`Could not create the word: ${e.message}`);
					}
				}));
	}

	sanitizeFilename(name) {
		// Strip characters Obsidian/file systems reject in file names
		return name.replace(/[\\\/:*?"<>|]/g, '-').trim();
	}

	async create() {
		const f = this.fields;
		if (!f.word) return 'Word is required';
		if (!f.translation) return 'Translation is required';

		const folder = (this.plugin.settings.folder || 'Italian').replace(/^\/+|\/+$/g, '');
		const filename = this.sanitizeFilename(f.word);
		if (!filename) return 'The word has no usable file-name characters';

		if (!this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}

		const path = `${folder}/${filename}.md`;
		if (this.app.vault.getAbstractFileByPath(path)) {
			return `File already exists: ${path}`;
		}

		await this.app.vault.create(path, this.buildContent());
		this.plugin.vocabulary = await this.plugin.loadVocabulary();
		this.plugin.vocabularyLoaded = true;
		new Notice(`Added "${filename}" (${this.plugin.vocabulary.length} words in "${folder}")`);
		this.close();
		return null;
	}

	buildContent() {
		const f = this.fields;
		const blocks = [];

		let head = `### ${f.translation}`;
		if (f.pos) head += `\n#${f.pos.replace(/^#/, '')}`;
		blocks.push(head);

		// The parser needs both halves of the pronunciation line (/IPA/ · Respelling),
		// so the block goes in only when both were provided
		if (f.ipa && f.respelling) {
			blocks.push(`> [!info] Pronunciation\n> /${f.ipa}/ · ${f.respelling}`);
		}

		if (f.exampleForeign && f.exampleEnglish) {
			blocks.push(`> [!example] Example\n> **${f.exampleForeign}**\n> *${f.exampleEnglish}*`);
		}

		const synonyms = f.synonyms.split(',').map(s => s.trim()).filter(Boolean);
		if (synonyms.length > 0) {
			blocks.push(`> [!tip] Synonyms\n> ${synonyms.map(s => `[[${s}]]`).join(' · ')}`);
		}

		return blocks.join('\n\n\n') + '\n';
	}

	onClose() {
		this.contentEl.empty();
	}
}

class LanguageTrainerSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Language Trainer Cards Settings' });

		new Setting(containerEl)
			.setName('Vocabulary folder')
			.setDesc('Folder containing vocabulary markdown files')
			.addText(text => text
				.setPlaceholder('Enter folder name')
				.setValue(this.plugin.settings.folder)
				.onChange(async (value) => {
					this.plugin.settings.folder = value.trim().replace(/^\/+|\/+$/g, '') || 'Italian';
					await this.plugin.saveSettings();
					// Reload vocabulary with the new folder
					this.plugin.vocabulary = await this.plugin.loadVocabulary();
					this.plugin.vocabularyLoaded = true;
					new Notice(`Language Trainer: ${this.plugin.vocabulary.length} words loaded from "${this.plugin.settings.folder}"`);
				}));

		new Setting(containerEl)
			.setName('Words per session')
			.setDesc('Number of words in each study set')
			.addText(text => text
				.setPlaceholder('Enter number')
				.setValue(String(this.plugin.settings.wordsPerSession))
				.onChange(async (value) => {
					const num = parseInt(value, 10);
					if (!isNaN(num) && num > 0) {
						this.plugin.settings.wordsPerSession = num;
						// Changing set size invalidates current session
						this.plugin.settings.session = null;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Training mode')
			.setDesc('New: 0–2★ · Learning: 3–4★ · Mastered: 5★+ · Archived: hidden words')
			.addDropdown(dropdown => dropdown
				.addOption('new', 'New words (0–2★)')
				.addOption('review', 'Learning (3–4★)')
				.addOption('mastered', 'Mastered (5★+)')
				.addOption('all', 'All words')
				.addOption('archived', 'Archived words')
				.setValue(this.plugin.settings.trainingMode)
				.onChange(async (value) => {
					this.plugin.settings.trainingMode = value;
					// Changing mode invalidates current session
					this.plugin.settings.session = null;
					await this.plugin.saveSettings();
					new Notice(`Training mode set to "${value}". Open the trainer to start a new set.`);
				}));

		new Setting(containerEl)
			.setName('Show pronunciation')
			.setDesc('Display IPA and respelling pronunciation guides')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showPronunciation)
				.onChange(async (value) => {
					this.plugin.settings.showPronunciation = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Show examples')
			.setDesc('Display example sentences')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showExamples)
				.onChange(async (value) => {
					this.plugin.settings.showExamples = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Reset current session')
			.setDesc('Discard the in-progress set; next open starts a fresh set')
			.addButton(cb => cb
				.setButtonText('Reset Session')
				.onClick(async () => {
					this.plugin.settings.session = null;
					await this.plugin.saveSettings();
					new Notice('Session reset');
				}));

		new Setting(containerEl)
			.setName('Reset progress')
			.setDesc('Clear all mastery data and start fresh')
			.addButton(cb => cb
				.setButtonText('Reset Progress')
				.setWarning()
				.onClick(async () => {
					if (await this.confirmReset()) {
						this.plugin.progress = {};
						await this.plugin.saveProgress();
						new Notice('Progress reset successfully');
					}
				}));
	}

	async confirmReset() {
		return new Promise((resolve) => {
			const modal = new Modal(this.app);
			modal.onOpen = () => {
				let { contentEl } = modal;
				contentEl.createEl('h2', { text: 'Confirm Reset' });
				contentEl.createEl('p', { text: 'Are you sure you want to reset all progress? This cannot be undone.' });

				const buttonContainer = contentEl.createEl('div');
				buttonContainer.createEl('button', {
					text: 'Cancel',
					event: {
						click: () => {
							modal.close();
							resolve(false);
						}
					}
				});
				buttonContainer.createEl('button', {
					text: 'Reset',
					event: {
						click: () => {
							modal.close();
							resolve(true);
						}
					}
				});
			};
			modal.onClose = () => {
				// Clean up
			};
			modal.open();
		});
	}
}