import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import "./styles/global.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("页面中缺少 #root 挂载节点");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
