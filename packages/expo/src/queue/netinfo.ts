import { addEventListener as addNetInfoListener } from "@react-native-community/netinfo"

export interface ConnectivityListener {
  subscribe: (onOnline: () => void) => () => void
}

export function createConnectivityListener(): ConnectivityListener {
  return {
    subscribe(onOnline) {
      let prev: boolean | null = null
      const unsubscribe = addNetInfoListener((state) => {
        const isOnline = !!state.isConnected
        if (prev === false && isOnline === true) {
          onOnline()
        }
        prev = isOnline
      })
      return unsubscribe
    },
  }
}
