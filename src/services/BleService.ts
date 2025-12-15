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
 */
export const clearDeviceConnectionState = async (deviceId: string): Promise<void> => {
  console.log('[BleService] clearDeviceConnectionState() called');
  console.log('[BleService] Device ID:', deviceId);
  
  const manager = getBleManager();
  
  try {
    // Try to find and cancel any existing connection
    const devices = await manager.connectedDevices([SERVICE_UUID]);
    const existingDevice = devices.find(d => d.id === deviceId);
    
    if (existingDevice) {
      console.log('[BleService] Found existing connection, cancelling...');
      try {
        await existingDevice.cancelConnection();
        console.log('[BleService] Existing connection cancelled');
      } catch (err) {
        console.log('[BleService] Error cancelling existing connection (may not be connected):', err);
      }
    }
    
    // Wait a bit for iOS to clear the connection state
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log('[BleService] Connection state cleared');
  } catch (error) {
    console.error('[BleService] Error clearing connection state:', error);
    // Don't throw - this is best effort
  }
};

/**
 * Connect to a BLE device
 */
export const connectToDevice = async (deviceId: string, retryOnPairingMismatch: boolean = true): Promise<Device> => {
  console.log('[BleService] connectToDevice() called');
  console.log('[BleService] Device ID:', deviceId);
  console.log('[BleService] Retry on pairing mismatch:', retryOnPairingMismatch);
  
  const manager = getBleManager();
  
  try {
    console.log('[BleService] Attempting to connect to device:', deviceId);
    console.log('[BleService] Connection options: { autoConnect: false, requestMTU: 517 }');
    
    const device = await manager.connectToDevice(deviceId, {
      autoConnect: false,
      requestMTU: 517, // Match ESP32 MTU setting
    });

    console.log('[BleService] Device connected successfully');
    console.log('[BleService] Device info:', {
      id: device.id,
      name: device.name,
      rssi: device.rssi,
      isConnected: device.isConnected(),
    });

    // Wait for device to be connected and ready
    console.log('[BleService] Discovering all services and characteristics...');
    await device.discoverAllServicesAndCharacteristics();
    console.log('[BleService] Services and characteristics discovered');

    // Log discovered services
    const services = await device.services();
    console.log('[BleService] Discovered services count:', services.length);
    services.forEach((service, index) => {
      console.log(`[BleService] Service ${index + 1}:`, {
        uuid: service.uuid,
        isPrimary: service.isPrimary,
      });
    });

    // Log characteristics for our service
    try {
      const service = await device.services();
      const targetService = service.find(s => s.uuid.toLowerCase() === SERVICE_UUID.toLowerCase());
      if (targetService) {
        const characteristics = await targetService.characteristics();
        console.log('[BleService] Characteristics in target service:', characteristics.length);
        characteristics.forEach((char, index) => {
          console.log(`[BleService] Characteristic ${index + 1}:`, {
            uuid: char.uuid,
            isReadable: char.isReadable,
            isWritableWithResponse: char.isWritableWithResponse,
            isWritableWithoutResponse: char.isWritableWithoutResponse,
            isNotifiable: char.isNotifiable,
            isIndicatable: char.isIndicatable,
          });
        });
      } else {
        console.warn('[BleService] Target service not found in discovered services');
      }
    } catch (err) {
      console.error('[BleService] Error logging service details:', err);
    }

    console.log('[BleService] Connection process completed successfully');
    return device;
  } catch (error) {
    const errorMessage = (error as any)?.message || '';
    
    // Handle "Operation was cancelled" gracefully - don't log as error
    if (errorMessage === 'Operation was cancelled') {
      console.log('[BleService] Operation was cancelled - handling gracefully');
      throw error; // Re-throw but don't log as error
    }
    
    console.error('[BleService] Connection error:', error);
    console.error('[BleService] Connection error details:', JSON.stringify(error, null, 2));
    if (error instanceof Error) {
      console.error('[BleService] Error message:', error.message);
      console.error('[BleService] Error stack:', error.stack);
    }
    
    // Check if this is a pairing mismatch error and retry if enabled
    if (retryOnPairingMismatch && isPairingMismatchError(error)) {
      console.log('[BleService] Pairing mismatch detected, attempting to clear state and retry...');
      try {
        await clearDeviceConnectionState(deviceId);
        console.log('[BleService] Retrying connection after clearing state...');
        // Retry once without the retry flag to avoid infinite loops
        return await connectToDevice(deviceId, false);
      } catch (retryError) {
        console.error('[BleService] Retry after pairing mismatch also failed:', retryError);
        // Throw the original error with additional context
        const originalError = error as any;
        originalError.isPairingMismatch = true;
        throw originalError;
      }
    }
    
    throw error;
  }
};

/**
 * Disconnect from a BLE device
 */
export const disconnectFromDevice = async (device: Device): Promise<void> => {
  console.log('[BleService] disconnectFromDevice() called');
  console.log('[BleService] Device ID:', device.id);
  console.log('[BleService] Device name:', device.name);
  console.log('[BleService] Device isConnected:', device.isConnected());
  
  try {
    console.log('[BleService] Cancelling connection...');
    await device.cancelConnection();
    console.log('[BleService] Connection cancelled successfully');
  } catch (error) {
    console.error('[BleService] Disconnect error:', error);
    console.error('[BleService] Disconnect error details:', JSON.stringify(error, null, 2));
    if (error instanceof Error) {
      console.error('[BleService] Error message:', error.message);
      console.error('[BleService] Error stack:', error.stack);
    }
    throw error;
  }
};

/**
 * Read value from the authorized characteristic
 * This will trigger the authorization request on the ESP32
 */
export const readCharacteristic = async (
  device: Device
): Promise<string> => {
  console.log('[BleService] readCharacteristic() called');
  console.log('[BleService] Device ID:', device.id);
  console.log('[BleService] Service UUID:', SERVICE_UUID);
  console.log('[BleService] Characteristic UUID:', CHARACTERISTIC_UUID);
  console.log('[BleService] Device isConnected:', device.isConnected());
  
  try {
    console.log('[BleService] Reading characteristic...');
    const service = await device.readCharacteristicForService(
      SERVICE_UUID,
      CHARACTERISTIC_UUID
    );

    console.log('[BleService] Characteristic read successful');
    console.log('[BleService] Characteristic value (base64):', service.value);
    console.log('[BleService] Characteristic UUID:', service.uuid);
    console.log('[BleService] Characteristic serviceUUID:', service.serviceUUID);
    console.log('[BleService] Characteristic isReadable:', service.isReadable);
    console.log('[BleService] Characteristic isWritableWithResponse:', service.isWritableWithResponse);
    console.log('[BleService] Characteristic isWritableWithoutResponse:', service.isWritableWithoutResponse);
    console.log('[BleService] Characteristic isNotifiable:', service.isNotifiable);
    console.log('[BleService] Characteristic isIndicatable:', service.isIndicatable);

    if (service.value) {
      console.log('[BleService] Decoding base64 value to string...');
      // Decode base64 value to string
      const base64Value = service.value;
      console.log('[BleService] Base64 value length:', base64Value.length);
      
      const buffer = Buffer.from(base64Value, 'base64');
      console.log('[BleService] Buffer length:', buffer.length);
      console.log('[BleService] Buffer bytes:', Array.from(buffer));
      
      const decodedString = buffer.toString('utf8');
      console.log('[BleService] Decoded string:', decodedString);
      console.log('[BleService] Decoded string length:', decodedString.length);
      
      return decodedString;
    }

    console.log('[BleService] Characteristic value is null or empty');
    return '';
  } catch (error) {
    console.error('[BleService] Read characteristic error:', error);
    console.error('[BleService] Read error details:', JSON.stringify(error, null, 2));
    if (error instanceof Error) {
      console.error('[BleService] Error message:', error.message);
      console.error('[BleService] Error stack:', error.stack);
    }
    throw error;
  }
};

/**
 * Monitor device connection state
 */
export const monitorConnection = (
  device: Device,
  onStateChange: (connected: boolean) => void
): () => void => {
  console.log('[BleService] monitorConnection() called');
  console.log('[BleService] Device ID:', device.id);
  console.log('[BleService] Setting up disconnection monitor...');
  
  const subscription = device.onDisconnected((error, device) => {
    console.log('[BleService] onDisconnected callback triggered');
    console.log('[BleService] Device ID:', device.id);
    
    if (error) {
      console.error('[BleService] Disconnection error:', error);
      console.error('[BleService] Disconnection error details:', JSON.stringify(error, null, 2));
    } else {
      console.log('[BleService] Device disconnected without error');
    }
    
    console.log('[BleService] Calling onStateChange(false)');
    onStateChange(false);
    console.log('[BleService] Disconnection monitoring complete');
  });

  console.log('[BleService] Disconnection monitor set up successfully');
  
  // Return cleanup function
  return () => {
    console.log('[BleService] Cleaning up connection monitor');
    subscription.remove();
    console.log('[BleService] Connection monitor cleaned up');
  };
};

/**
 * Monitor characteristic notifications
 */
export const monitorCharacteristic = (
  device: Device,
  onValueReceived: (value: string) => void
): () => void => {
  console.log('[BleService] monitorCharacteristic() called');
  console.log('[BleService] Device ID:', device.id);
  console.log('[BleService] Service UUID:', SERVICE_UUID);
  console.log('[BleService] Characteristic UUID:', CHARACTERISTIC_UUID);
  
  let subscription: any = null;
  
  const setupMonitoring = async () => {
    try {
      console.log('[BleService] Setting up notification monitoring...');
      
      // Monitor the characteristic for notifications
      subscription = device.monitorCharacteristicForService(
        SERVICE_UUID,
        CHARACTERISTIC_UUID,
        (error, characteristic) => {
          if (error) {
            const errorMessage = error.message || '';
            // Handle expected errors on disconnect gracefully
            if (errorMessage.includes('disconnected') || errorMessage === 'Operation was cancelled') {
              console.log('[BleService] Notification monitor stopped (device disconnected or cancelled)');
              return;
            }
            console.error('[BleService] Notification error:', error);
            console.error('[BleService] Notification error details:', JSON.stringify(error, null, 2));
            return;
          }

          if (characteristic?.value) {
            console.log('[BleService] Notification received');
            console.log('[BleService] Characteristic value (base64):', characteristic.value);
            
            try {
              // Decode base64 value to string
              const buffer = Buffer.from(characteristic.value, 'base64');
              const decodedString = buffer.toString('utf8');
              console.log('[BleService] Decoded value:', decodedString);
              onValueReceived(decodedString);
            } catch (decodeError) {
              console.error('[BleService] Error decoding value:', decodeError);
            }
          }
        }
      );
      
      console.log('[BleService] Notification monitoring set up successfully');
    } catch (error) {
      console.error('[BleService] Error setting up monitoring:', error);
      console.error('[BleService] Monitoring error details:', JSON.stringify(error, null, 2));
      if (error instanceof Error) {
        console.error('[BleService] Error message:', error.message);
        console.error('[BleService] Error stack:', error.stack);
      }
    }
  };
  
  setupMonitoring();
  
  // Return cleanup function
  return () => {
    console.log('[BleService] Cleaning up characteristic monitor');
    if (subscription) {
      subscription.remove();
      console.log('[BleService] Characteristic monitor cleaned up');
    }
  };
};

