import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import { ErrorBoundary } from "./components/error-boundary.js";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Dashboard root element was not found");
}

createRoot(rootElement).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
