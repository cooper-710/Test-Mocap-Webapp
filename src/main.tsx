// src/main.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import ThreeView from "./components/ThreeView";

const root = createRoot(document.getElementById("root")!);
root.render(<ThreeView />);
