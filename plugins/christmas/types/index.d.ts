export type IsHidden = boolean

declare module 'claude-code' {
  interface PluginState {
    'christmas': { isHidden: IsHidden }
  }
}
