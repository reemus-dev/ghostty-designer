import type {HostMessage} from "@/core/bindings";
import {buildCatalog} from "./catalog";
import {Design} from "./design";
import {asError, errorText} from "./errors";
import type {Host} from "./host";
import {requestQueue} from "./live";
import {
  colorsAfterSave,
  colorsToSave,
  draftKeys,
  draftTheme,
  provenance,
  savedTheme,
  savedThemeNames,
} from "./resolve";
import {type SavedConfig, savedConfig, saveReviews} from "./saved";
import {resolveThemePair, themeColors} from "./theme";
import {
  checkThemeName,
  matchTheme,
  readabilityWarnings,
  type ThemeLibrary,
} from "./theme-library";
import type {
  SavePlan,
  SaveResult,
  SaveThemeSource,
  SessionMessage,
  SessionState,
  Snapshot,
  ThemeColors,
} from "./types";
import {layer, sameValues} from "./values";

export type Session = Awaited<ReturnType<typeof startSession>>;

type ColorState = Pick<SessionState, "colorMatch" | "warnings">;

const LIVE_MS = 100;

/** Resolves with the load's error, or null once it succeeds. */
const failure = (loading: Promise<void>) =>
  loading.then(() => null).catch((error: unknown) => asError(error));

/**
 * Theme match and readability of colours, preferring the `current` theme among
 * equals. It keeps its last result, because matching scans every theme.
 */
function cachedColorState() {
  let cache: {library: ThemeLibrary; key: string; value: ColorState} | null =
    null;
  return (
    library: ThemeLibrary,
    colors: ThemeColors,
    current: string | null,
  ): ColorState => {
    const key = JSON.stringify([colors, current]);
    if (cache?.library !== library || cache.key !== key) {
      const colorMatch = matchTheme(colors, library.themes, current);
      const warnings = readabilityWarnings(colors);
      cache = {library, key, value: {colorMatch, warnings}};
    }
    return cache.value;
  };
}

/** The colour states of what shows, and of the user's own colours. */
const colorStates = () => ({
  shown: cachedColorState(),
  own: cachedColorState(),
});

/** What the panel renders, from the saved config and the design over it. */
function sessionState(
  config: SavedConfig,
  design: Design,
  instances: number,
  colors: ReturnType<typeof colorStates>,
): SessionState {
  const {sources} = config;
  const {draft, appearance} = design;
  const {catalog, library} = sources;
  const resolved = colorsAfterSave(sources, draft.theme, appearance);
  const shown = layer(sources.saved, resolved.values, draft.values);
  const savedColors = colorsAfterSave(sources, null, appearance).values;
  const ownColors = themeColors(
    layer(savedColors, draft.values),
    catalog.colorDefaults,
  );
  const savedSetting = savedTheme(sources);
  const savedPair =
    savedSetting === null ? null : resolveThemePair(savedSetting);
  const setting = draft.theme ?? savedSetting;
  const themePair = setting === null ? null : resolveThemePair(setting);
  const from = provenance(sources, draft, resolved);
  // Picking the saved theme again changes something only while lines hide it.
  let themeHidden: SessionState["themeHidden"] = null;
  if (
    draft.theme === null &&
    draftTheme(sources, {theme: savedSetting, values: draft.values}) !== null
  ) {
    themeHidden = Object.values(from).includes("theme") ? "some" : "all";
  }
  return {
    ...design.state(),
    saved: layer(sources.saved, savedColors),
    effective: shown,
    provenance: from,
    changes: draftKeys(draft).length,
    previewInstalled: config.include !== "absent",
    previewShadowed: config.include === "shadowed",
    themeSetting: setting,
    themePair,
    themeHidden,
    savedThemes: savedThemeNames(sources),
    canRestoreOriginal: config.canRestoreOriginal,
    instances,
    ...colors.shown(
      library,
      themeColors(shown, catalog.colorDefaults),
      themePair?.[appearance] ?? null,
    ),
    own: {
      colors: ownColors,
      ...colors.own(library, ownColors, savedPair?.[appearance] ?? null),
    },
  };
}

/**
 * The design session of the window. It loads the catalog, the themes and the
 * saved config through `host`, then turns intents into draft changes that
 * preview live. `listener` receives every message for the panel, in order.
 *
 * Requests (intents, save plans, saves, saved themes, restores and switches of
 * the system's appearance) run one at a time, so each sees the effects of those
 * before. Live intents wait in their slot until the slot is free, or until
 * another request comes, which applies after them. A request that writes files
 * holds later requests until the session has read them back, so they edit
 * against what it wrote. A save plan takes the draft in turn, then validates
 * and plans it while later requests run, and only the newest plan stays up for
 * review. Reloads may overlap: `latestLoads` decides which results count, and
 * `PreviewCalls` which preview statuses do.
 */
export async function startSession(
  host: Host,
  listener: (message: SessionMessage) => void,
) {
  const early: HostMessage[] = [];
  let receive = (message: HostMessage) => void early.push(message);
  const start = await host.connect((message) => receive(message));
  const catalog = buildCatalog(start.defaultsWithDocs);
  let {fonts, instances} = start;

  /** A failure no request answers: a background read or write. */
  const fail = (error: unknown) =>
    listener({type: "error", message: errorText(error)});

  // The config and the design need each other. These callbacks run only for
  // reads, which start once `design` and `publish` exist.
  const config = savedConfig(host, catalog, start.configPath, {
    config: (read) => {
      design.configRead(read);
      if (read.answered.length === 0) publish();
    },
    themes: ({themes}) => {
      listener({type: "themes", themes});
      design.sync();
      publish();
    },
    fail,
  });
  const design = new Design(host, config, start.persisted, () => publish());
  const reviews = saveReviews(host, config, start.configPath);
  const colors = colorStates();

  const state = () => sessionState(config, design, instances, colors);
  const publish = () => {
    // Nothing publishes until the first reads are in.
    if (!design.started) return;
    design.report();
    listener({type: "state", state: state()});
  };

  const requests = requestQueue(async (intent) => {
    if (intent.type === "install-preview") await config.install(publish);
    else if (intent.type === "rescan-fonts") await host.rescanFonts();
    else await design.applyIntent(intent);
    publish();
  }, LIVE_MS);

  receive = (message) => {
    switch (message.type) {
      case "config-changed": {
        config.configChanged();
        break;
      }
      case "themes-changed": {
        config.themesChanged();
        break;
      }
      case "fonts": {
        fonts = message.fonts;
        listener({type: "fonts", fonts: message.fonts});
        break;
      }
      case "instances": {
        if (message.count === instances) return;
        instances = message.count;
        publish();
        break;
      }
      case "appearance-changed": {
        void requests.serial(() => design.followSystem()).then(publish, fail);
        break;
      }
      case "preview-status": {
        design.status(message.id, message.apply);
        break;
      }
      case "close-requested":
      case "switch-requested":
        listener(message);
    }
  };
  for (const message of early.splice(0)) receive(message);

  /**
   * After a save or restore the files hold the result, so the draft and preview
   * clear, then the session reads the config back. The write happened, so a
   * failed read is a background error. Ghostty applies a new font-size only to
   * terminals not zoomed by hand (src/config/Config.zig:250-254), so zoom
   * resets when the saved font-size changed.
   */
  const settle = async () => {
    const fontSize = config.sources.saved["font-size"] ?? [];
    design.clear();
    reviews.clear();
    // The close guard reads the count before the read publishes.
    design.report();
    try {
      await config.readConfig("settle", publish);
    } catch (error) {
      fail(error);
      publish();
      return;
    }
    // The host resets zoom too when the reverted preview set a font size. A
    // second reset changes nothing.
    if (!sameValues(fontSize, config.sources.saved["font-size"] ?? [])) {
      // Not awaited: the first Apple Event waits for the user's consent.
      host.resetFontSize().catch(console.error);
    }
  };

  const [system, ...failures] = await Promise.all([
    host.systemAppearance(),
    failure(config.readThemes()),
    failure(config.readConfig("load")),
  ]);
  design.start(system, start.stash);
  design.report();
  for (const error of failures) if (error) fail(error);

  const snapshot: Snapshot = {
    platform: start.platform,
    configPath: start.configPath,
    edited: start.edited,
    options: catalog.options,
    colorDefaults: catalog.colorDefaults,
    themes: config.sources.library.themes,
    fonts,
    state: state(),
  };

  return {
    /** What the panel shows first. Messages keep it current. */
    snapshot,

    /** Applies an intent. Its state follows as a message. */
    intent: requests.intent,

    /**
     * Applies an intent from a drag, a scrub or typing, at most one per option
     * every 100 ms, and always the last. Any other request applies after it.
     */
    live: requests.live,

    /** Plans a save of the current draft, which `save` then applies as reviewed. */
    async planSave(): Promise<SavePlan> {
      const plan = await requests.serial(() =>
        reviews.begin(design.draft, design.previewText()),
      );
      return plan();
    },

    /**
     * Applies the reviewed plan `planId`, after backing up the saved colours as
     * a user theme when `backup` asks for it.
     */
    save(planId: string, backup: boolean): Promise<SaveResult> {
      return requests.serial(async () => {
        const review = await reviews.confirm(planId, () => design.draft);
        const backupTheme =
          backup && review.plan.replacesColors
            ? await config.backUpColors(design.appearance)
            : null;
        const result = await host.applySave(review.edits);
        // A read during the write may already have pruned the saved theme from
        // the draft.
        if (review.draft.theme !== null) {
          await design.remember(review.draft.theme);
        }
        await settle();
        if (backupTheme !== null) await config.readThemes().catch(fail);
        return {...result, backupTheme};
      });
    },

    /** Saves the colours of `source` as a new user theme. */
    saveTheme(name: string, source: SaveThemeSource) {
      return requests.serial(() => {
        const {sources} = config;
        checkThemeName(sources.library, name);
        const {draft, appearance} = design;
        const saved = colorsToSave(sources, source, draft, appearance);
        return config.writeTheme(name, saved);
      });
    },

    /** Puts back the config files as they were before the first save. */
    restoreOriginal() {
      return requests.serial(async () => {
        await host.restoreOriginal();
        await settle();
      });
    },
  };
}
