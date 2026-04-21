import { render } from "preact"
import { App } from "./App"

document.body.classList.add("options")

render(<App />, document.getElementById("root")!)
