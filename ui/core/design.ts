// The user's design: the draft over the saved config, its undo history, the
// half of a light/dark pair it shows, and its live preview in Ghostty.
import type {Appearance} from "@/core/bindings";
import {checkTheme, editDraft, isDraftIntent} from "./edits";
import {
  EMPTY_DRAFT,
  History,
  type HistoryChange,
  type HistorySnapshot,
  sameDraft,
} from "./history";
import type {Host} from "./host";
import {
  type Persisted,
  readPersisted,
  withFavorite,
  withRecentTheme,
} from "./persisted";
import {PreviewCalls} from "./preview";
import {draftKeys, previewText, pruned} from "./resolve";
import type {ConfigRead, SavedConfig} from "./saved";
import type {ApplyStatus, Draft, Intent} from "./types";

/** What a window reload keeps of the design. */
type Stash = {
  draft: Draft;
  history: HistorySnapshot;
  appearance: Appearance;
  appearanceChosen: boolean;
};

/** The intents the design applies. */
export type DesignIntent = Exclude<
  Intent,
  {type: "install-preview" | "rescan-fonts"}
>;

/**
 * The design over `config`. Nothing previews until `start`. `onStatus` runs
 * when Ghostty reports a new status for the preview.
 */
export class Design {
  started = false;
  draft = EMPTY_DRAFT;
  appearance: Appearance = "dark";
  /**
   * Set while the user shows the half of a light/dark pair the system does not
   * pick.
   */
  appearanceChosen = false;
  private readonly history = new History();
  /** Compare with saved: Ghostty shows the saved config meanwhile. */
  private paused = false;
  private apply: ApplyStatus = {state: "idle"};
  private persisted: Persisted;
  private readonly preview: PreviewCalls;
  private readonly reported: Partial<Stash> & {version?: number} = {};

  constructor(
    private readonly host: Host,
    private readonly config: Pick<SavedConfig, "sources" | "include">,
    persisted: string | null,
    onStatus: () => void,
  ) {
    this.persisted = readPersisted(persisted);
    this.preview = new PreviewCalls((status) => {
      // While paused, the state shows `paused` instead.
      if (this.paused) return;
      this.apply = status;
      onStatus();
    });
  }

  /** What the design adds to the session's state. */
  state() {
    return {
      draft: this.draft,
      history: this.history.entries(),
      apply: this.paused ? ({state: "paused"} as const) : this.apply,
      appearance: this.appearance,
      ...this.persisted,
    };
  }

  /** The text the preview file shows for the draft. */
  previewText() {
    const {appearance, appearanceChosen} = this;
    return previewText(this.config.sources, this.draft, {
      appearance,
      appearanceChosen,
    });
  }

  /**
   * Starts previewing, from the system's appearance and from the stash of the
   * page before a reload.
   */
  start(system: Appearance, stash: string | null) {
    this.appearance = system;
    if (stash !== null) {
      // The page reloaded, so the preview file still holds the old page's last
      // preview. The first sync then always applies or reverts.
      this.preview.text = null;
      try {
        const restored = JSON.parse(stash) as Stash;
        this.draft = pruned(this.config.sources, restored.draft);
        this.history.restore(restored.history);
        this.appearance = restored.appearance;
        this.appearanceChosen = restored.appearanceChosen;
      } catch (error) {
        console.error("ghostty-designer: cannot restore the draft:", error);
      }
    }
    this.started = true;
    this.sync();
  }

  async applyIntent(intent: DesignIntent) {
    if (isDraftIntent(intent)) {
      const {change, next} = editDraft(this.config.sources, this.draft, intent);
      await this.commit(change, next);
      return;
    }
    const {library} = this.config.sources;
    switch (intent.type) {
      case "undo": {
        this.step(this.history.undo());
        break;
      }
      case "redo": {
        this.step(this.history.redo());
        break;
      }
      case "revert": {
        await this.revertAll();
        break;
      }
      case "appearance": {
        this.appearance = intent.appearance;
        // Explicit colours for the half the system picks would stop Ghostty following it.
        const system = await this.host.systemAppearance();
        this.appearanceChosen = intent.appearance !== system;
        this.show();
        break;
      }
      case "pause": {
        this.paused = intent.paused;
        if (!this.paused) this.show();
        else if (this.installed()) this.revert();
        break;
      }
      case "favorite": {
        checkTheme(library, intent.theme);
        await this.persist(
          withFavorite(this.persisted, intent.theme, intent.on),
        );
        break;
      }
      case "reference": {
        if (intent.theme !== null) checkTheme(library, intent.theme);
        await this.persist({...this.persisted, reference: intent.theme});
        break;
      }
    }
  }

  /** Follows a config read that counts. */
  configRead({answered, latest, system}: ConfigRead) {
    if (this.appearanceChosen && system) {
      this.appearanceChosen = false;
      this.appearance = system;
    }
    // An edit outside the designer can save what the draft sets. Only the
    // latest read prunes: an older one, kept for its waiters, may hold a saved
    // value a newer save replaced, and pruning against it would drop a draft
    // edit made since.
    if (latest) {
      const kept = pruned(this.config.sources, this.draft);
      if (!sameDraft(kept, this.draft)) this.draft = kept;
    }
    // Instances pick up a new include on reload.
    if (answered.includes("install") && this.installed()) this.show();
    else this.sync();
  }

  /** The files hold the draft, or the original config: the draft clears. */
  clear() {
    // Without the include, Ghostty reads no preview file to clear.
    if (this.installed()) this.revert();
    this.draft = EMPTY_DRAFT;
    this.history.clear();
  }

  remember(theme: string) {
    return this.persist(withRecentTheme(this.persisted, theme)).catch(
      console.error,
    );
  }

  /** A status Ghostty reports for the preview text scheduled with `id`. */
  status(id: string, status: ApplyStatus) {
    this.preview.status(id, status);
  }

  /**
   * Shows the preview again when what it depends on changed it: its text, or
   * whether the include loads it. A removed include clears it, so instances
   * stop showing the draft.
   */
  sync() {
    if (!this.started) return;
    const text = this.installed() ? this.previewText() : "";
    if (text === this.preview.text) return;
    if (this.installed()) this.show();
    else if (!this.paused) this.revert();
  }

  /**
   * Tells the close guard the change count, with the stash a window reload
   * restores.
   */
  report() {
    const {draft, appearance, appearanceChosen, reported} = this;
    const {version} = this.history;
    if (
      reported.draft === draft &&
      reported.version === version &&
      reported.appearance === appearance &&
      reported.appearanceChosen === appearanceChosen
    ) {
      return;
    }
    Object.assign(reported, {draft, version, appearance, appearanceChosen});
    const history = this.history.snapshot();
    const stash: Stash = {draft, history, appearance, appearanceChosen};
    this.host
      .reportDraft(draftKeys(draft).length, JSON.stringify(stash))
      .catch(console.error);
  }

  private installed() {
    return this.config.include !== "absent";
  }

  private show() {
    // Ghostty reads the preview file only through the include line.
    if (!this.started || this.paused || !this.installed()) return;
    const text = this.previewText();
    this.preview.schedule(text, (id) => this.host.previewApply(id, text));
  }

  /** Clears the preview, so instances show the saved config. */
  private revert() {
    this.preview.schedule("", (id) => this.host.previewRevert(id));
  }

  private persist(next: Persisted) {
    this.persisted = next;
    return this.host.writeState(JSON.stringify(next));
  }

  /** Records a draft change as an undo step, then previews the draft. */
  private async commit(change: HistoryChange, next: Draft) {
    const ended = this.history.record(this.draft, next, change);
    if (sameDraft(next, this.draft)) return;
    this.draft = next;
    this.show();
    if (ended !== null) await this.remember(ended);
  }

  private step(moved: Draft | undefined) {
    if (!moved) return;
    this.draft = moved;
    this.show();
  }

  /** Back to the saved config, and to the system's half of a pair. */
  private async revertAll() {
    const unpinned = this.appearanceChosen;
    if (unpinned) {
      this.appearanceChosen = false;
      this.appearance = await this.host.systemAppearance();
    }
    if (!sameDraft(this.draft, EMPTY_DRAFT)) {
      await this.commit({label: "Revert all changes"}, EMPTY_DRAFT);
    } else if (unpinned) {
      this.show();
    }
  }
}
