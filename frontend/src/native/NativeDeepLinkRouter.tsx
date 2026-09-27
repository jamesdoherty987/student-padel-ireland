import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { hideNativeSplash, onNativeDeepLink } from './shell'
import { isNativeApp } from './platform'

/**
 * Routes Capacitor deep links / universal links into React Router,
 * and hides the splash once the router is mounted.
 */
export function NativeDeepLinkRouter() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!isNativeApp()) return

    onNativeDeepLink((pathWithSearch) => {
      navigate(pathWithSearch, { replace: false })
    })
    void hideNativeSplash()

    return () => {
      onNativeDeepLink(null)
    }
  }, [navigate])

  return null
}
