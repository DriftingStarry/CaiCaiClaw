import React from "react";
import { render } from "ink";
import { App } from "./components/App";

process.on("exit", () => process.stdout.write("\x1b[?1006l\x1b[?1000l"));
render(<App />, { alternateScreen: true, kittyKeyboard: { mode: "auto" } });
