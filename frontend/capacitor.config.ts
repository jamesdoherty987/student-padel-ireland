import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'ie.studentpadel.app',
  appName: 'Student Padel Ireland',
  webDir: 'dist',
  // Keep the WebView on https so cookies / secure APIs behave like production web
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    hostname: 'app.studentpadel.ie',
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
      style: 'LIGHT',
      backgroundColor: '#ffffff',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
  ios: {
    contentInset: 'never',
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
