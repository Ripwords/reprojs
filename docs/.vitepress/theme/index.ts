import DefaultTheme from "vitepress/theme"
// Side-effect CSS import is the documented way to add custom styles to a
// VitePress theme — see https://vitepress.dev/guide/extending-default-theme.
// eslint-disable-next-line import/no-unassigned-import
import "./style.css"

export default {
  extends: DefaultTheme,
}
