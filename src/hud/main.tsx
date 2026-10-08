import { createRoot } from "react-dom/client";
import "../styles/tokens.css";
import "../styles/base.css";
import "./hud.css";
import { Hud } from "./Hud";

// Separate entry from the app: no config load, no ptys, no hook listeners; state arrives from the main window.
createRoot(document.getElementById("root")!).render(<Hud />);
