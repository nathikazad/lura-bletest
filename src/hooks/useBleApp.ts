import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import { Device } from 'react-native-ble-plx';
import {
  getBleManager,
  scanForDevices,
  stopScan,
  connectToDevice,
  disconnectFromDevice,
  monitorConnection,
  monitorCharacteristic,
  readCharacteristic,
  isPairingMismatchError,
  clearDeviceConnectionState,
  ScanResult,
} from '../services/BleService';
import {
  BleAppContext,
  createInitialContext,
  addDeviceToList,
  transitionToScanningForPaired,
  transitionToConnected,
  transitionToScanningNoPaired,
  transitionToScanningForPairedOnDisconnect,
  transitionToScanningNoPairedOnDisconnect,
  addNumberToStream,
  clearDeviceList,
} from '../state/BleStateMachine';
import { useNgrokStore } from '../state/NgrokStore';

/**
 * Main business logic hook for BLE app
 * Orchestrates state machine and BLE service
 */
export const useBleApp = () => {
  const [context, setContext] = useState<BleAppContext>(createInitialContext);
  const monitorCleanupRef = useRef<(() => void) | null>(null);
  const connectionMonitorCleanupRef = useRef<(() => void) | null>(null);
  const isConnectingRef = useRef(false);
  const handleConnectRef = useRef<((deviceId: string, isRetry?: boolean) => Promise<void>) | null>(null);
  const { ngrokUrl } = useNgrokStore();
  const lastPacketSentTimeRef = useRef<number>(0);

  /**
   * Request Bluetooth permissions (Android only)
   */
  const requestPermissions = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);

        if (
          granted['android.permission.BLUETOOTH_SCAN'] !== PermissionsAndroid.RESULTS.GRANTED ||
          granted['android.permission.BLUETOOTH_CONNECT'] !== PermissionsAndroid.RESULTS.GRANTED
        ) {
          Alert.alert('Permissions Required', 'Bluetooth permissions are required to scan for devices.');
          return false;
        }
        return true;
      } catch (err) {
        console.warn(err);
        return false;
      }
    }
    return true;
  }, []);

  /**
   * Forward number to ngrok endpoint
   */
  const forwardNumberToNgrok = useCallback(
    async (number: string) => {
      const currentTime = Date.now();
      const timeSinceLastPacket = currentTime - lastPacketSentTimeRef.current;

      // Throttle: only send if > 1 second since last packet
      if (timeSinceLastPacket > 1000 && ngrokUrl) {
        try {
          const num = Number(number);
          if (isNaN(num)) {
            console.warn('[NGROK] Invalid number received:', number);
            return;
          }

          console.log(`📤 [NGROK] Sending number to ${ngrokUrl}: ${num} (${timeSinceLastPacket}ms since last packet)`);

          const response = await fetch(`${ngrokUrl}/number`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ number: num }),
          });

          if (response.ok) {
            const result = await response.json();
            lastPacketSentTimeRef.current = currentTime;
            console.log('🟢 [NGROK] Number sent successfully:', result);
          } else {
            console.error('🔴 [NGROK] Failed to send number:', response.status, response.statusText);
          }
        } catch (error) {
          console.error('🔴 [NGROK] Error sending number to ngrok:', error);
        }
      } else {
        console.log(`⏭️ [NGROK] Skipping send - only ${timeSinceLastPacket}ms since last packet (need > 1000ms)`);
      }
    },
    [ngrokUrl]
  );

  /**
   * Start monitoring notifications from device
   */
  const startMonitoringNotifications = useCallback(
    (device: Device) => {
      // Clear existing stream
      setContext((prev) => ({ ...prev, numberStream: [] }));
      lastPacketSentTimeRef.current = 0;

      // Clean up any existing monitor
      if (monitorCleanupRef.current) {
        monitorCleanupRef.current();
      }

      // Start monitoring notifications
      monitorCleanupRef.current = monitorCharacteristic(device, (value: string) => {
        setContext((prev) => addNumberToStream(prev, value));
        // Forward to ngrok endpoint
        forwardNumberToNgrok(value);
      });
    },
    [forwardNumberToNgrok]
  );

  /**
   * Handle connection to device
   */
  const handleConnect = useCallback(
    async (deviceId: string, isRetry: boolean = false) => {
      if (isConnectingRef.current && !isRetry) {
        return; // Already connecting
      }

      if (!isRetry) {
        isConnectingRef.current = true;
        stopScan();
      } else {
        // Retry attempt - clear connection state first
        await clearDeviceConnectionState(deviceId);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      try {
        const device = await connectToDevice(deviceId);

        // Update state to connected
        setContext((prev) => transitionToConnected(prev, device));

        // Monitor connection state
        connectionMonitorCleanupRef.current = monitorConnection(device, (connected) => {
          if (!connected) {
            // Clean up notification monitor
            if (monitorCleanupRef.current) {
              monitorCleanupRef.current();
              monitorCleanupRef.current = null;
            }

            // Transition to scanning-for-paired (keep pairedDeviceId for auto-reconnect)
            setContext((prev) => transitionToScanningForPairedOnDisconnect(prev));
            // Start scanning will be called by effect watching state
          }
        });

        // Event-based: Try to start monitoring notifications immediately
        // If pairing isn't complete, retry until it succeeds
        const tryStartMonitoring = async (retryCount = 0) => {
          try {
            // Try to read characteristic to verify pairing is complete
            // If this succeeds, we can safely start monitoring
            await readCharacteristic(device);
            // Pairing complete - start monitoring
            startMonitoringNotifications(device);
          } catch (error: any) {
            const errorMessage = error.message || '';
            if ((errorMessage.includes('authentication') || 
                 errorMessage.includes('authorization') ||
                 errorMessage.includes('not authorized')) && 
                retryCount < 10) {
              // Pairing not complete yet - retry after delay
              setTimeout(() => {
                tryStartMonitoring(retryCount + 1);
              }, 500);
            } else {
              // Other error or max retries reached - start monitoring anyway
              // Monitoring might still work even if read failed
              startMonitoringNotifications(device);
            }
          }
        };
        
        tryStartMonitoring();

        isConnectingRef.current = false;
      } catch (error: any) {
        isConnectingRef.current = false;
        const errorMessage = error.message || 'Failed to connect';

        // Handle "Operation was cancelled" gracefully
        if (errorMessage === 'Operation was cancelled') {
          setContext((prev) => ({
            ...prev,
            connectedDevice: null,
            numberStream: [],
            state: prev.pairedDeviceId ? 'scanning-for-paired' : 'scanning-no-paired',
          }));
          return;
        }

        // Check for pairing mismatch
        if (isPairingMismatchError(error)) {
          if (!isRetry) {
            // Automatically retry once after clearing pairing state
            try {
              await handleConnect(deviceId, true);
              return; // Success, exit early
            } catch (retryError: any) {
              // Fall through to show error message
            }
          }

          // Show user guidance
          Alert.alert(
            'Pairing Mismatch',
            'The device has cleared its pairing information. iOS may need to forget the old pairing.\n\n' +
              'Please try:\n' +
              '1. Go to iOS Settings > Bluetooth\n' +
              '2. Find "BLE Auth Server" and tap the (i) icon\n' +
              '3. Tap "Forget This Device"\n' +
              '4. Try connecting again\n\n' +
              'Or tap "Retry" to attempt automatic recovery.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Retry',
                onPress: () => handleConnect(deviceId, true),
              },
            ]
          );
        } else if (errorMessage.includes('authentication') || errorMessage.includes('authorization')) {
          Alert.alert('Pairing Required', 'Please enter passkey 123456 when prompted to pair with the device.', [
            { text: 'OK' },
          ]);
        } else {
          Alert.alert('Connection Error', errorMessage);
        }

        // Return to scanning state
        setContext((prev) => ({
          ...prev,
          connectedDevice: null,
          state: prev.pairedDeviceId ? 'scanning-for-paired' : 'scanning-no-paired',
        }));
      }
    },
    [startMonitoringNotifications, forwardNumberToNgrok]
  );

  // Update ref when handleConnect changes
  useEffect(() => {
    handleConnectRef.current = handleConnect;
  }, [handleConnect]);

  /**
   * Handle device found during scanning
   */
  const handleDeviceFound = useCallback((device: ScanResult) => {
    setContext((prev) => {
      const currentState = prev.state;

      // State: scanning-for-paired - auto-connect immediately when paired device found
      if (currentState === 'scanning-for-paired' && prev.pairedDeviceId && device.id === prev.pairedDeviceId) {
        if (isConnectingRef.current) {
          return prev; // Already connecting
        }

        stopScan();
        // Use setTimeout to avoid calling handleConnect during state update
        setTimeout(() => {
          if (handleConnectRef.current) {
            handleConnectRef.current(device.id);
          }
        }, 0);
        return prev;
      }

      // State: scanning-no-paired - add device to list
      if (currentState === 'scanning-no-paired') {
        return addDeviceToList(prev, device);
      }

      return prev;
    });
  }, []);

  /**
   * Start scanning based on current state
   */
  const startScanning = useCallback(async () => {
    setContext((prev) => {
      const currentState = prev.state;
      if (currentState !== 'scanning-no-paired' && currentState !== 'scanning-for-paired') {
        return prev;
      }

      // Clear device list when starting scan (only for scanning-no-paired)
      const updatedContext = currentState === 'scanning-no-paired' ? clearDeviceList(prev) : prev;

      // Start scanning asynchronously
      (async () => {
        const hasPermission = await requestPermissions();
        if (!hasPermission && Platform.OS === 'android') {
          return;
        }

        try {
          await scanForDevices(handleDeviceFound);
        } catch (error: any) {
          console.error('Scan error:', error);
          Alert.alert('Scan Error', error.message || 'Failed to start scanning');
        }
      })();

      return updatedContext;
    });
  }, [handleDeviceFound, requestPermissions]);

  /**
   * Handle manual disconnect
   */
  const handleDisconnect = useCallback(async () => {
    setContext((prev) => {
      if (!prev.connectedDevice) {
        return prev;
      }

      const device = prev.connectedDevice;

      // Disconnect asynchronously
      (async () => {
        try {
          await disconnectFromDevice(device);

          // Clean up monitors
          if (monitorCleanupRef.current) {
            monitorCleanupRef.current();
            monitorCleanupRef.current = null;
          }
          if (connectionMonitorCleanupRef.current) {
            connectionMonitorCleanupRef.current();
            connectionMonitorCleanupRef.current = null;
          }

          // Clear pairedDeviceId and change state to scanning-no-paired
          setContext((prevState) => transitionToScanningNoPairedOnDisconnect(prevState));
        } catch (error: any) {
          console.error('Disconnect error:', error);
          Alert.alert('Disconnect Error', error.message || 'Failed to disconnect');
        }
      })();

      return prev; // Return immediately, state will update in async
    });
  }, []);

  /**
   * Clear paired device and return to scanning-no-paired state
   */
  const handleClearPairedDevice = useCallback(() => {
    setContext((prev) => transitionToScanningNoPaired(prev));
  }, []);

  /**
   * Effect: Start scanning when state changes to scanning states
   */
  useEffect(() => {
    const currentState = context.state;
    if (currentState === 'scanning-no-paired' || currentState === 'scanning-for-paired') {
      startScanning();
    }
  }, [context.state, startScanning]);

  /**
   * Initialize BLE manager and set up BLE state monitoring
   */
  useEffect(() => {
    // Request permissions on Android
    if (Platform.OS === 'android') {
      requestPermissions();
    }

    const manager = getBleManager();

    // Monitor BLE state
    const subscription = manager.onStateChange((state) => {
      if (state === 'PoweredOff') {
        Alert.alert('Bluetooth Off', 'Please enable Bluetooth to use this app.');
      } else if (state === 'PoweredOn') {
        // Start scanning automatically when Bluetooth is powered on
        const currentState = context.state;
        if (currentState === 'scanning-no-paired' || currentState === 'scanning-for-paired') {
          startScanning();
        }
      }
    }, true);

    // Start scanning automatically on mount if Bluetooth is on
    const initScan = async () => {
      try {
        const state = await manager.state();
        const currentState = context.state;
        if (state === 'PoweredOn' && (currentState === 'scanning-no-paired' || currentState === 'scanning-for-paired')) {
          startScanning();
        }
      } catch (error) {
        console.error('Error checking BLE state:', error);
      }
    };
    initScan();

    return () => {
      subscription.remove();
      stopScan();
      // Clean up monitors
      if (monitorCleanupRef.current) {
        monitorCleanupRef.current();
      }
      if (connectionMonitorCleanupRef.current) {
        connectionMonitorCleanupRef.current();
      }
    };
  }, []); // Only run on mount

  return {
    // State
    appState: context.state,
    devices: context.devices,
    connectedDevice: context.connectedDevice,
    numberStream: context.numberStream,
    pairedDeviceId: context.pairedDeviceId,

    // Actions
    onDevicePress: handleConnect,
    onDisconnect: handleDisconnect,
    onClearPairedDevice: handleClearPairedDevice,
  };
};
