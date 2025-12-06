# BLE Scanner App

A basic React Native app that scans for Bluetooth Low Energy (BLE) devices, connects to them, and receives data in the background using `react-native-ble-plx`.

## Features

- Scan for BLE devices
- Connect to discovered devices
- Receive data from connected devices
- Background mode support (iOS)
- State restoration for background operations

## Setup

### Prerequisites

- Node.js >= 18
- React Native development environment set up
- iOS: Xcode and CocoaPods
- Android: Android Studio and Android SDK

### Installation

1. Install dependencies:
```bash
npm install
```

2. For iOS, install CocoaPods:
```bash
cd ios && pod install && cd ..
```

### Running the App

#### iOS
```bash
npm run ios
```

#### Android
```bash
npm run android
```

## Background Mode Configuration

### iOS

The app is configured for background BLE operations:

1. **Info.plist** includes:
   - `UIBackgroundModes` with `bluetooth-central`
   - Bluetooth usage descriptions

2. **State Restoration**:
   - The app uses state restoration to maintain BLE connections when the app is killed
   - Restore identifier: `BleInTheBackground`

3. **Important Notes**:
   - For background scanning, you must specify a service UUID in `startDeviceScan()`
   - The peripheral must advertise the specified service UUID
   - Background tasks can extend processing time up to ~15 minutes

### Android

Android automatically handles background BLE operations, but you need to ensure:
- Location permissions are granted (required for BLE scanning on Android)
- Bluetooth permissions are granted

## Usage

1. **Start Scanning**: Tap "Start Scan" to discover nearby BLE devices
2. **Connect**: Tap on a device from the list to connect
3. **Receive Data**: Once connected, the app will automatically monitor all notifiable characteristics
4. **Background**: The app will continue receiving data when in the background (iOS)

## Customization

To scan for specific devices in background mode, modify the `startDeviceScan` call in `App.tsx`:

```typescript
// Replace null with your service UUID for background scanning
bleManager.startDeviceScan('YOUR_SERVICE_UUID', { allowDuplicates: false }, ...)
```

## Notes

- The app scans for all devices in foreground mode (service UUID = null)
- For background scanning, specify a service UUID
- Background mode requires the device to advertise the specified service UUID
- State restoration helps maintain connections when the app is killed

