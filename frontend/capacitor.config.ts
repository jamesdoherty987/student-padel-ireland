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
      backgroundColor: '#0d623e',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      // Match green splash / dark auth screens; light screens set style in JS
      style: 'DARK',
      backgroundColor: '#0d623e',
    },
    Keyboard: {
      // App pads with --keyboard-inset; avoid double-shrink with body resize
      resize: 'none',
      resizeOnFullScreen: true,
    },
  },
  ios: {
    contentInset: 'never',
    preferredContentMode: 'mobile',
    backgroundColor: '#0d623e',
    scheme: 'App',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#0d623e',
  },
}

export default config
