import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { nativeSafePath } from '../utils/navigation'
import { hideNativeSplash, onNativeDeepLink } from './shell'
import { isNativeApp } from './platform'

/**
 * Routes Capacitor deep links / universal links into React Router,
 * and hides the splash once the router is mounted.
 * Marketing URLs (landing / about / blog) remap into the app shell.
 */
export function NativeDeepLinkRouter() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!isNativeApp()) return

    onNativeDeepLink((pathWithSearch) => {
      navigate(nativeSafePath(pathWithSearch), { replace: false })
    })
    void hideNativeSplash()

    return () => {
      onNativeDeepLink(null)
    }
  }, [navigate])

  return null
}
