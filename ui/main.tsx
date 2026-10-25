import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
// Bundled fonts, so the panel looks the same on every desktop. They load here, not in
// styles.css, because the Tailwind CLI inlines CSS imports without rebasing their URLs.
// opsz adds Inter's optical sizes.
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/roboto-mono/index.css";
import {App} from "./app/app";
import {start, trackEdits} from "./lib/store";

start();
trackEdits();

createRoot(document.querySelector("#root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
