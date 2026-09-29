import React from "react";
import ReactDOM from "react-dom/client";
import TrayApp from "./TrayApp";
import { applySavedTheme } from "./theme";
import "./halo.css";
import "./tray.css";

applySavedTheme();
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TrayApp />
  </React.StrictMode>,
);
