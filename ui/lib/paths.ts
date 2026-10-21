/** A path with the home folder as ~, as people say it. */
export const tildePath = (path: string) =>
  path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
