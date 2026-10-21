// `bun build` loads .txt imports as their text.
declare module "*.txt" {
  const text: string;
  export default text;
}
