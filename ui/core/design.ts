// The user's design: the draft over the saved config, its undo history, the
// half of a light/dark pair it shows, and its live preview in Ghostty.
import type {Appearance} from "@/core/bindings";
import {checkTheme, editDraft, isDraftIntent} from "./edits";
import {inputError} from "./errors";
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
  withThemeMoved,
} from "./persisted";
import {PreviewCalls} from "./preview";
import {draftKeys, previewText, pruned, savedThemeNames} from "./resolve";
import type {ConfigRead, SavedConfig} from "./saved";
import {replaceTheme} from "./theme";
import {checkThemeName} from "./theme-library";
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
  #started = false;
  #draft = EMPTY_DRAFT;
  #appearance: Appearance = "dark";
  /**
   * Set while the user shows the half of a light/dark pair the system does not
   * pick.
   */
  private appearanceChosen = false;
  /** The half the system's appearance picks. */
  private system: Appearance = "dark";
  private readonly history = new History();
  /** Compare with saved: Ghostty shows the saved config meanwhile. */
  private paused = false;
  private apply: ApplyStatus = {state: "idle"};
  private persisted: Persisted;
  private readonly preview: PreviewCalls;
  private readonly reported: Partial<Stash> & {version?: number} = {};

  constructor(
    private readonly host: Host,
    private readonly config: Pick<
      SavedConfig,
      "sources" | "include" | "renameTheme" | "deleteTheme"
    >,
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

  get started() {
    return this.#started;
  }

  get draft() {
    return this.#draft;
  }

  /** The half of a light/dark pair the design shows. */
  get appearance() {
    return this.#appearance;
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
    this.system = system;
    this.#appearance = system;
    if (stash !== null) {
      // The page reloaded, so the preview file still holds the old page's last
      // preview. The first sync then always applies or reverts.
      this.preview.text = null;
      try {
        const restored = JSON.parse(stash) as Stash;
        this.#draft = pruned(this.config.sources, restored.draft);
        this.history.restore(restored.history);
        this.#appearance = restored.appearance;
        this.appearanceChosen = restored.appearanceChosen;
      } catch (error) {
        console.error("ghostty-designer: cannot restore the draft:", error);
      }
    }
    this.#started = true;
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
        this.#appearance = intent.appearance;
        // Explicit colours for the half the system picks would stop Ghostty following it.
        this.appearanceChosen = intent.appearance !== this.system;
        this.show();
        break;
      }
      case "pause": {
        this.paused = intent.paused;
        if (!this.paused) this.show();
        else if (this.live()) this.revert();
        break;
      }
      case "live-preview": {
        await this.persist({...this.persisted, livePreview: intent.on});
        this.sync();
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
      case "rename-theme": {
        const {theme, to} = intent;
        this.checkOwnTheme(theme);
        // The theme does not block its own name, so a rename may change case.
        const themes = library.themes.filter((item) => item.name !== theme);
        checkThemeName({...library, themes}, to);
        await this.config.renameTheme(theme, to, () =>
          this.followTheme(theme, to),
        );
        break;
      }
      case "delete-theme": {
        const {theme} = intent;
        this.checkOwnTheme(theme);
        await this.config.deleteTheme(theme, () =>
          this.followTheme(theme, null),
        );
        break;
      }
    }
  }

  /** Follows a config read that counts. */
  configRead({answered, latest}: ConfigRead) {
    // An edit outside the designer can save what the draft sets. Only the
    // latest read prunes: an older one, kept for its waiters, may hold a saved
    // value a newer save replaced, and pruning against it would drop a draft
    // edit made since.
    if (latest) {
      const kept = pruned(this.config.sources, this.draft);
      if (!sameDraft(kept, this.draft)) this.#draft = kept;
    }
    // Instances pick up a new include on reload.
    if (answered.includes("install") && this.installed()) this.show();
    else this.sync();
  }

  /**
   * The files hold the draft, or the original config: the draft clears, and the
   * preview no longer shows a chosen half of a pair.
   */
  clear() {
    // Without the include, Ghostty reads no preview file to clear.
    if (this.installed()) this.revert();
    this.#draft = EMPTY_DRAFT;
    this.history.clear();
    this.followSystemHalf();
  }

  /**
   * Follows a switch of the system's appearance. A chosen half stays until the
   * system picks it too.
   */
  async followSystem() {
    const system = await this.host.systemAppearance();
    this.system = system;
    if (!this.appearanceChosen) this.#appearance = system;
    this.appearanceChosen = this.appearance !== system;
    this.sync();
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
   * whether it is live. Live preview turned off or a removed include clears it,
   * so instances stop showing the draft.
   */
  sync() {
    if (!this.started) return;
    const text = this.live() ? this.previewText() : "";
    if (text === this.preview.text) return;
    if (this.live()) this.show();
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

  /** Refuses a theme that is not the user's, or one the saved config names. */
  private checkOwnTheme(theme: string) {
    const {sources} = this.config;
    const found = sources.library.themes.find((item) => item.name === theme);
    if (found?.source !== "user") {
      throw inputError(`${theme} is not one of your themes`);
    }
    if (savedThemeNames(sources).includes(theme)) {
      throw inputError(`Your saved config uses ${theme}`);
    }
  }

  /**
   * Follows a user theme renamed to `to`, or deleted when `to` is null: the
   * draft and its history, and the theme's favourite, recent use and pin. The
   * draft follows before the themes read again, so no preview names a theme
   * that is gone.
   */
  private async followTheme(theme: string, to: string | null) {
    const follow = (draft: Draft) => {
      const setting =
        draft.theme === null ? null : replaceTheme(draft.theme, theme, to);
      return setting === draft.theme ? draft : {...draft, theme: setting};
    };
    this.#draft = follow(this.draft);
    this.history.mapDrafts(follow);
    await this.persist(withThemeMoved(this.persisted, theme, to));
  }

  private installed() {
    return this.config.include !== "absent";
  }

  /** Ghostty reads the preview file only through the include line. */
  private live() {
    return this.persisted.livePreview && this.installed();
  }

  private show() {
    if (!this.started || this.paused || !this.live()) return;
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
    this.#draft = next;
    this.show();
    if (ended !== null) await this.remember(ended);
  }

  private step(moved: Draft | undefined) {
    if (!moved) return;
    this.#draft = moved;
    this.show();
  }

  /** Back to the system's half of a pair. */
  private followSystemHalf() {
    this.appearanceChosen = false;
    this.#appearance = this.system;
  }

  /** Back to the saved config, and to the system's half of a pair. */
  private async revertAll() {
    const wasChosen = this.appearanceChosen;
    this.followSystemHalf();
    if (!sameDraft(this.draft, EMPTY_DRAFT)) {
      await this.commit({label: "Discard all changes"}, EMPTY_DRAFT);
    } else if (wasChosen) {
      this.show();
    }
  }
}
