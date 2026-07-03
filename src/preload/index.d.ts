import type { IslandBridgeApi } from '../shared/protocol'

declare global {
  interface Window {
    island: IslandBridgeApi
  }
}

export {}
