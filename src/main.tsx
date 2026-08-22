import { render } from "solid-js/web";
import "./index.css";
import { App } from "./ui/App";
import { hydrateSession } from "./ui/store";

const root = document.getElementById("root");
if (root) {
  // Read the stored session before the first paint. Mounting first and filling
  // the canvas in afterwards shows an empty document for a frame, and an empty
  // document is exactly what this is here to stop the user seeing.
  hydrateSession().finally(() => render(() => <App />, root));
}
