import "./main.css";

import { AppsSDKUIProvider } from "@openai/apps-sdk-ui/components/AppsSDKUIProvider";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppsSDKUIProvider linkComponent="a">
      <App />
    </AppsSDKUIProvider>
  </StrictMode>
);
