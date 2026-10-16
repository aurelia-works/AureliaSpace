import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "../styles/tokens.css";
import "../styles/base.css";
import "./remote.css";
import { Remote } from "./Remote";

// The phone remote (src-tauri/src/remote.rs serves it): a plain web page, no Tauri APIs.
createRoot(document.getElementById("root")!).render(<Remote />);
