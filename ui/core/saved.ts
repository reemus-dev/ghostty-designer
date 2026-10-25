// The saved config and the theme library as the session last read them, and
// the writes to them: the preview include, user themes and reviewed saves.
import type {Appearance, LoadedConfig} from "@/core/bindings";
import {type Catalog, parseShowConfig} from "./catalog";
import {lastDefinitions, parseConfig} from "./config-file";
import {inputError, SessionError} from "./errors";
import {EMPTY_DRAFT, sameDraft} from "./history";
import type {Host} from "./host";
import {latestLoads} from "./latest";
import {pruned, shownAfterSave, type Sources, themePairValues} from "./resolve";
import {
  type PlannedSave,
  planSave,
  previewIncludeEdit,
  themeText,
} from "./save";
import {hasThemeName, type ThemeLibrary, themeLibrary} from "./theme-library";
import type {Draft, SavePlan, Values} from "./types";

/**
 * What a request waits for a config read for: `load` is the first read,
 * `install` the preview include and `settle` a save or restore.
 */
export type ReadKind = "load" | "install" | "settle";

/** A config read that counts, for the session to act on. */
export type ConfigRead = {
  /** The kinds of the requests it answers. */
  answered: ReadKind[];
  /** No later read has started. */
  latest: boolean;
};

type Read = {
  loaded: LoadedConfig;
  shown: string;
};

const parseFiles = ({files}: Pick<LoadedConfig, "files">) =>
  files.map((file) => parseConfig(file.path, file.text, file.utf8));

/** Font families Ghostty fills from font-family when unset. */
const STYLE_FAMILY_KEYS = [
  "font-family-bold",
  "font-family-italic",
  "font-family-bold-italic",
];

/**
 * Reads the config and the themes through `host`, and keeps the sources of the
 * reads that count. Reads may overlap: `latestLoads` decides which count.
 */
export function savedConfig(
  host: Host,
  catalog: Catalog,
  configPath: string,
  on: {
    config: (read: ConfigRead) => void;
    themes: (library: ThemeLibrary) => void;
    /** A failed read that answers no request. */
    fail: (error: Error) => void;
  },
) {
  let sources: Sources = {
    catalog,
    files: [],
    saved: {},
    library: themeLibrary([], catalog.colorDefaults),
  };
  let include: LoadedConfig["preview"] = "absent";
  let includeReset: LoadedConfig["previewClearedBy"] = null;
  let canRestoreOriginal = false;

  const keepRead = ({loaded, shown}: Read) => {
    const files = parseFiles(loaded);
    const saved = Object.fromEntries(
      Object.entries(parseShowConfig(shown).values).map(([key, list]) => [
        key,
        catalog.normalize(key, list),
      ]),
    );
    // +show-config reports a style family the config leaves unset as the
    // font-family it is filled from (src/config/Config.zig:4502-4516).
    for (const key of STYLE_FAMILY_KEYS) {
      if (lastDefinitions(files, key).every((def) => def.line.value === "")) {
        saved[key] = [];
      }
    }
    sources = {...sources, files, saved};
    include = loaded.preview;
    includeReset = loaded.previewClearedBy;
    canRestoreOriginal = loaded.canRestoreOriginal;
  };

  const reads = latestLoads<Read, ReadKind>(
    async () => {
      const [loaded, shown] = await Promise.all([
        host.loadConfig(),
        host.showConfig(),
      ]);
      return {loaded, shown};
    },
    (result, answered, latest) => {
      if (result instanceof Error) {
        if (answered.length === 0) on.fail(result);
        return result;
      }
      keepRead(result);
      on.config({answered, latest});
      return null;
    },
  );

  const themeReads = latestLoads<ThemeLibrary, "load">(
    () =>
      host
        .loadThemes()
        .then((themes) => themeLibrary(themes, catalog.colorDefaults)),
    (result, answered) => {
      if (result instanceof Error) {
        const error = new SessionError(
          `Cannot load the themes: ${result.message}`,
          "internal",
        );
        if (answered.length === 0) on.fail(error);
        return error;
      }
      sources = {...sources, library: result};
      on.themes(result);
      return null;
    },
  );

  /** Throws unless the last read shows that the preview include loads. */
  const checkInclude = () => {
    if (include !== "absent") return;
    if (!includeReset) {
      throw inputError(`The preview include in ${configPath} does not load`);
    }
    const {path, line} = includeReset;
    // The host reports a line of a file it loaded with the same config.
    const file = sources.files.find((loaded) => loaded.path === path)!;
    const text = file.lines[line - 1]!.text.trim();
    throw inputError(
      `Line ${line} of ${path} (${text}) stops the preview include from loading. Remove it to turn on live preview.`,
    );
  };

  return {
    get sources() {
      return sources;
    },
    /** Whether Ghostty loads the preview file, and whether a file beats it. */
    get include() {
      return include;
    },
    get canRestoreOriginal() {
      return canRestoreOriginal;
    },

    /**
     * Reads the config for a request of `kind`. `answer` runs as the read is
     * kept, before any later one.
     */
    readConfig: (kind: "load" | "settle", answer?: () => void) =>
      reads.request(kind, answer),
    readThemes: () => themeReads.request("load"),
    /** A config file changed on disk. */
    configChanged: () => reads.start(),
    themesChanged: () => themeReads.start(),

    /**
     * Adds the preview include to the config unless it has one, then reads the
     * config back. `answer` runs as the read is kept. Rejects unless Ghostty
     * loads the include.
     */
    async install(answer: () => void) {
      const loaded = await host.loadConfig();
      const main = loaded.files.find((file) => file.path === configPath);
      const edit = previewIncludeEdit(
        configPath,
        main && parseConfig(main.path, main.text, main.utf8),
      );
      if (edit) await host.applySave([edit]);
      await reads.request("install", () => {
        answer();
        checkInclude();
      });
    },

    /**
     * Writes `colors` as a new user theme named `name`, which checkThemeName
     * allows, then reads the themes again. The theme is written, so a failed
     * read is a background error.
     */
    async writeTheme(name: string, colors: Values) {
      const text = themeText(colors, catalog.colorDefaults.palette!);
      const written = await host.writeTheme(name, text);
      if (!written) throw inputError(`A theme named ${name} already exists`);
      await themeReads.request("load").catch(on.fail);
      return written;
    },

    /**
     * Writes the saved colours, in their `half` of a pair, as a user theme
     * named for today, numbered from 2 while the name is taken. Returns the
     * name.
     */
    async backUpColors(half: Appearance) {
      const now = new Date();
      const date = [now.getMonth() + 1, now.getDate()]
        .map((part) => String(part).padStart(2, "0"))
        .join("-");
      const base = `My colours ${now.getFullYear()}-${date}`;
      const text = themeText(
        shownAfterSave(sources, EMPTY_DRAFT, half),
        catalog.colorDefaults.palette!,
      );
      for (let n = 1; ; n++) {
        const name = n === 1 ? base : `${base} ${n}`;
        // A theme file the library has not loaded yet still takes the name.
        const free = !hasThemeName(sources.library, name);
        if (free && (await host.writeTheme(name, text))) return name;
      }
    },
  };
}

export type SavedConfig = ReturnType<typeof savedConfig>;

type Review = PlannedSave & {id: string; draft: Draft};

/**
 * Save plans for review. A save applies only the plan last reviewed, and only
 * while the draft and the config files are as they were then.
 */
export function saveReviews(
  host: Host,
  config: Pick<SavedConfig, "sources">,
  configPath: string,
) {
  /** The last reviewed plan and the draft it saves. */
  let reviewed: Review | null = null;
  /**
   * Counts plans as they start, so a slower older plan cannot replace a newer
   * one.
   */
  let planned = 0;

  /**
   * Plans a save of `draft` with the library as it is now, against the config
   * files as they are once it runs.
   */
  const planning = (draft: Draft) => {
    const {sources} = config;
    const kept = pruned(sources, draft);
    const themeValues = themePairValues(sources.library, kept.theme);
    return async () => {
      const loaded = await host.loadConfig();
      return planSave({
        files: parseFiles(loaded),
        configPath,
        draft: kept,
        themeValues,
        repeatable: sources.catalog.repeatable,
      });
    };
  };

  return {
    /**
     * Takes `draft` and its preview `text` in the request's turn, and returns
     * the planning, which may run while later requests do.
     */
    begin(draft: Draft, text: string) {
      const seq = ++planned;
      const plan = planning(draft);
      return async (): Promise<SavePlan> => {
        // Saved files are not validated on reload, so check the draft first.
        const error = await host.validateConfig(text);
        if (error)
          throw inputError(`Ghostty didn't accept your changes: ${error}`);
        const {plan: summary, edits} = await plan();
        const id = crypto.randomUUID();
        if (seq === planned) reviewed = {id, draft, plan: summary, edits};
        return {...summary, id};
      };
    },

    /**
     * The review `id`, while it is the last one and still plans the same edits.
     * `draft` reads the draft once the files are read.
     */
    async confirm(id: string, draft: () => Draft) {
      const review = reviewed;
      if (review?.id !== id) {
        throw inputError("This save is out of date. Review it again.");
      }
      // Any loaded file, not only those the plan edits, can move the lines it targets.
      const current = await planning(review.draft)();
      if (!sameDraft(draft(), review.draft)) {
        throw inputError(
          "You made changes since the review. Review the save again.",
        );
      }
      if (
        JSON.stringify([current.plan, current.edits]) !==
        JSON.stringify([review.plan, review.edits])
      ) {
        throw inputError("Your config changed. Review the save again.");
      }
      return review;
    },

    clear() {
      reviewed = null;
    },
  };
}
