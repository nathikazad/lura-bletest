import { BleManager, Device, Characteristic } from 'react-native-ble-plx';
import { Buffer } from 'buffer';

// UUIDs matching ESP32 server
export const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
export const CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
export const DEVICE_NAME = 'BLE Auth Server';

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

export interface ScanResult {
  id: string;
  name: string | null;
  rssi: number | null;
  isConnectable: boolean | null;
}

/**
 * Scan for BLE devices matching the ESP32 server
 */
export const scanForDevices = async (
  onDeviceFound: (device: ScanResult) => void
): Promise<void> => {
  const manager = getBleManager();

  // Check if Bluetooth is enabled
  const state = await manager.state();
  if (state !== 'PoweredOn') {
    throw new Error(`Bluetooth is not powered on. Current state: ${state}`);
  }

  // Start scanning
  manager.startDeviceScan(
    [SERVICE_UUID],
    { allowDuplicates: false },
    (error, device) => {
      if (error) {
        console.error('Scan error:', error);
        return;
      }

      if (device) {
        onDeviceFound({
          id: device.id,
          name: device.name || device.localName || null,
          rssi: device.rssi,
          isConnectable: device.isConnectable,
        });
      }
    }
  );

  // Scanning continues indefinitely until stopScan() is called
};

/**
 * Stop scanning for BLE devices
 */
export const stopScan = (): void => {
  const manager = getBleManager();
  manager.stopDeviceScan();
};

/**
 * Check if error is a pairing mismatch error
 */
export const isPairingMismatchError = (error: any): boolean => {
  if (!error) return false;
  
  const errorMessage = error.message || '';
  const reason = error.reason || '';
  const iosErrorCode = error.iosErrorCode;
  
  return (
    errorMessage.includes('Peer removed pairing information') ||
    reason.includes('Peer removed pairing information') ||
    iosErrorCode === 14 ||
    (errorMessage.includes('connection failed') && iosErrorCode === 14)
  );
};

/**
 * Clear device connection state to handle pairing mismatches
 * Utility function for pairing issues - best effort, doesn't throw
 */
export const clearDeviceConnectionState = async (deviceId: string): Promise<void> => {
  const manager = getBleManager();
  
  try {
    const devices = await manager.connectedDevices([SERVICE_UUID]);
    const existingDevice = devices.find(d => d.id === deviceId);
    
    if (existingDevice) {
      try {
        await existingDevice.cancelConnection();
      } catch (err) {
        // Ignore errors - device may not be connected
      }
    }
    
    // Wait for iOS to clear the connection state
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (error) {
    // Don't throw - this is best effort
    console.error('[BleService] Error clearing connection state:', error);
  }
};

/**
 * Connect to a BLE device
 * Pure BLE operation - no retry logic, just connect and discover services
 */
export const connectToDevice = async (deviceId: string): Promise<Device> => {
  const manager = getBleManager();
  
  const device = await manager.connectToDevice(deviceId, {
    autoConnect: false,
    requestMTU: 517, // Match ESP32 MTU setting
  });

  // Discover services and characteristics
  await device.discoverAllServicesAndCharacteristics();
  
  return device;
};

/**
 * Disconnect from a BLE device
 */
export const disconnectFromDevice = async (device: Device): Promise<void> => {
  await device.cancelConnection();
};

/**
 * Read value from the authorized characteristic
 * This will trigger the authorization request on the ESP32
 */
export const readCharacteristic = async (device: Device): Promise<string> => {
  const characteristic = await device.readCharacteristicForService(
    SERVICE_UUID,
    CHARACTERISTIC_UUID
  );

  if (characteristic.value) {
    const buffer = Buffer.from(characteristic.value, 'base64');
    return buffer.toString('utf8');
  }

  return '';
};

/**
 * Monitor device connection state
 */
export const monitorConnection = (
  device: Device,
  onStateChange: (connected: boolean) => void
): () => void => {
  const subscription = device.onDisconnected(() => {
    onStateChange(false);
  });

  return () => {
    subscription.remove();
  };
};

/**
 * Monitor characteristic notifications
 */
export const monitorCharacteristic = (
  device: Device,
  onValueReceived: (value: string) => void
): () => void => {
  let subscription: any = null;
  
  subscription = device.monitorCharacteristicForService(
    SERVICE_UUID,
    CHARACTERISTIC_UUID,
    (error, characteristic) => {
      if (error) {
        // Silently handle expected disconnection errors
        const errorMessage = error.message || '';
        if (errorMessage.includes('disconnected') || errorMessage === 'Operation was cancelled') {
          return;
        }
        // Log unexpected errors but don't throw
        console.error('[BleService] Notification error:', error);
        return;
      }

      if (characteristic?.value) {
        try {
          const buffer = Buffer.from(characteristic.value, 'base64');
          const decodedString = buffer.toString('utf8');
          onValueReceived(decodedString);
        } catch (decodeError) {
          console.error('[BleService] Error decoding value:', decodeError);
        }
      }
    }
  );
  
  return () => {
    if (subscription) {
      subscription.remove();
    }
  };
};

