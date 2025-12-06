import { BleManager } from 'react-native-ble-plx';

// Global BLE Manager instance for background operations
// This should be created once and reused throughout the app
let bleManagerInstance: BleManager | null = null;

export const createBleManager = (): BleManager => {
  if (bleManagerInstance) {
    return bleManagerInstance;
  }

  // Create BleManager with state restoration for background mode
  bleManagerInstance = new BleManager({
    restoreStateIdentifier: 'BleInTheBackground',
    restoreStateFunction: (restoredState) => {
      if (restoredState == null) {
        // BleManager was constructed for the first time
        console.log('BleManager initialized for the first time');
      } else {
        // BleManager was restored. Check connectedPeripherals property
        console.log('BleManager restored with state:', {
          connectedPeripherals: restoredState.connectedPeripherals?.length || 0,
        });

        // Re-establish monitoring for restored devices
        if (restoredState.connectedPeripherals) {
          restoredState.connectedPeripherals.forEach((peripheral) => {
            console.log('Restored peripheral:', peripheral.id);
            // Re-subscribe to characteristics if needed
            // This will be handled by the app when it detects restored connections
          });
        }
      }
    },
  });

  return bleManagerInstance;
};

export const getBleManager = (): BleManager => {
  if (!bleManagerInstance) {
    return createBleManager();
  }
  return bleManagerInstance;
};

