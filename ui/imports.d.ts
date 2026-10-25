// `bun build` loads .txt imports as their text.
declare module "*.txt" {
  const text: string;
  export default text;
}

// `bun build` bundles imported stylesheets and the fonts they load.
declare module "*.css";
