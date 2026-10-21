import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {App} from "./app/app";
import {start, trackEdits} from "./lib/store";

start();
trackEdits();

createRoot(document.querySelector("#root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
