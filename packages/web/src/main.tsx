import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { createStore } from "./state/store.js";
import { initialState } from "./state/reducer.js";
import { getSessionId } from "./session.js";
import "./styles.css";

const sessionId = getSessionId();
const store = createStore(initialState(sessionId));

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element in index.html");

createRoot(container).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
