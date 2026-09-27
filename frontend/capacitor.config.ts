import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'ie.studentpadelireland.app',
  appName: 'Student Padel Ireland',
  webDir: 'dist',
  // Keep the WebView on https so cookies / secure APIs behave like production web
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    hostname: 'app.studentpadelireland.ie',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#0b3d2e',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0b3d2e',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
    backgroundColor: '#0b3d2e',
    scheme: 'Student Padel Ireland',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#0b3d2e',
  },
}

export default config
