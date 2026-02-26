import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css"; // <--- THIS IS CRITICAL
import "./styles/flags.css";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

document.title = "FastCAT";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
