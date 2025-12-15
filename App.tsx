import React, { useState, useEffect, useCallback } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import { Device } from 'react-native-ble-plx';
import {
  getBleManager,
  scanForDevices,
  stopScan,
  connectToDevice,
  disconnectFromDevice,
  monitorConnection,
  monitorCharacteristic,
  isPairingMismatchError,
  clearDeviceConnectionState,
  ScanResult,
  DEVICE_NAME,
} from './src/services/BleService';

const App = () => {
  // Three states: 'scanning-no-paired' | 'scanning-for-paired' | 'connected'
  const [appState, setAppState] = useState<'scanning-no-paired' | 'scanning-for-paired' | 'connected'>('scanning-no-paired');
  const [devices, setDevices] = useState<ScanResult[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [numberStream, setNumberStream] = useState<string[]>([]);
  const [monitorCleanup, setMonitorCleanup] = useState<(() => void) | null>(null);
  const [pairedDeviceId, setPairedDeviceId] = useState<string | null>(null);

  useEffect(() => {
    // Request permissions on Android
    if (Platform.OS === 'android') {
      requestPermissions();
    }

    // Initialize BLE manager
    const manager = getBleManager();
    
    // Monitor BLE state
    const subscription = manager.onStateChange((state) => {
      console.log('BLE State:', state);
      if (state === 'PoweredOff') {
        Alert.alert(
          'Bluetooth Off',
          'Please enable Bluetooth to use this app.'
        );
      } else if (state === 'PoweredOn') {
        // Start scanning automatically when Bluetooth is powered on
        if (appState === 'scanning-no-paired' || appState === 'scanning-for-paired') {
          startScan();
        }
      }
    }, true);

    // Start scanning automatically on mount if Bluetooth is on
    const initScan = async () => {
      try {
        const state = await manager.state();
        if (state === 'PoweredOn' && (appState === 'scanning-no-paired' || appState === 'scanning-for-paired')) {
          startScan();
        }
      } catch (error) {
        console.error('Error checking BLE state:', error);
      }
    };
    initScan();

    return () => {
      subscription.remove();
      stopScan();
      // Clean up notification monitor if it exists
      if (monitorCleanup) {
        monitorCleanup();
      }
    };
  }, [monitorCleanup, appState]);

  const requestPermissions = async () => {
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
  };

  const handleDeviceFound = useCallback((device: ScanResult) => {
    console.log('[App] Device found:', {
      id: device.id,
      name: device.name,
      rssi: device.rssi,
      currentState: appState,
    });
    
    // State: scanning-for-paired - auto-connect immediately when paired device found
    if (appState === 'scanning-for-paired' && pairedDeviceId && device.id === pairedDeviceId) {
      console.log('[App] Found paired device, auto-connecting immediately...');
      stopScan();
      handleConnect(device.id);
      return;
    }
    
    // State: scanning-no-paired - show all devices
    if (appState === 'scanning-no-paired') {
      setDevices((prevDevices) => {
        // Avoid duplicates
        const exists = prevDevices.find((d) => d.id === device.id);
        if (exists) {
          return prevDevices;
        }
        console.log('[App] Adding device to list:', device.name || device.id);
        return [...prevDevices, device];
      });
    }
  }, [appState, pairedDeviceId]);

  const startScan = async () => {
    // Only scan if in scanning states
    if (appState !== 'scanning-no-paired' && appState !== 'scanning-for-paired') {
      return;
    }

    const hasPermission = await requestPermissions();
    if (!hasPermission && Platform.OS === 'android') {
      return;
    }

    // Clear devices list when starting scan (only for scanning-no-paired)
    if (appState === 'scanning-no-paired') {
      setDevices([]);
    }

    try {
      // Scan indefinitely - will stop when device is found and connected
      await scanForDevices(handleDeviceFound);
    } catch (error: any) {
      console.error('Scan error:', error);
      Alert.alert('Scan Error', error.message || 'Failed to start scanning');
    }
  };

  const handleConnect = async (deviceId: string, isRetry: boolean = false) => {
    console.log('[App] handleConnect() called');
    console.log('[App] Device ID:', deviceId);
    console.log('[App] Is retry:', isRetry);
    
    try {
      if (!isRetry) {
        console.log('[App] Stopping scan...');
        stopScan();
      } else {
        console.log('[App] Retry attempt - clearing connection state first...');
        await clearDeviceConnectionState(deviceId);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log('[App] Calling connectToDevice()...');
      const device = await connectToDevice(deviceId);
      console.log('[App] Device connected successfully');
      
      // Save pairedDeviceId and change state to connected
      setPairedDeviceId(deviceId);
      setConnectedDevice(device);
      setAppState('connected');
      console.log('[App] State changed to: connected');

      // Monitor connection state
      monitorConnection(device, (connected) => {
        if (!connected) {
          console.log('[App] Device disconnected');
          setConnectedDevice(null);
          setNumberStream([]);
          // Clean up notification monitor
          if (monitorCleanup) {
            monitorCleanup();
            setMonitorCleanup(null);
          }
          // Keep pairedDeviceId, change state to scanning-for-paired
          setAppState('scanning-for-paired');
          console.log('[App] State changed to: scanning-for-paired');
          startScan();
        }
      });

      // Wait for pairing to complete, then start monitoring notifications
      setTimeout(() => {
        startMonitoringNotifications(device);
      }, 2000);
    } catch (error: any) {
      console.error('[App] Connection error:', error);
      console.error('[App] Connection error details:', JSON.stringify(error, null, 2));
      if (error instanceof Error) {
        console.error('[App] Error message:', error.message);
        console.error('[App] Error stack:', error.stack);
      }
      
      const errorMessage = error.message || 'Failed to connect';
      console.log('[App] Error message:', errorMessage);
      
      // Check for pairing mismatch
      if (isPairingMismatchError(error)) {
        console.log('[App] Pairing mismatch detected');
        
        if (!isRetry) {
          console.log('[App] Attempting automatic retry after clearing pairing state...');
          // Automatically retry once after clearing pairing state
          try {
            await handleConnect(deviceId, true);
            return; // Success, exit early
          } catch (retryError: any) {
            console.error('[App] Retry also failed:', retryError);
            // Fall through to show error message
          }
        }
        
        // If retry failed or this was already a retry, show user guidance
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
              onPress: () => {
                console.log('[App] User requested retry');
                handleConnect(deviceId, true);
              },
            },
          ]
        );
      } else if (errorMessage.includes('authentication') || errorMessage.includes('authorization')) {
        console.log('[App] Authentication/authorization error detected');
        Alert.alert(
          'Pairing Required',
          'Please enter passkey 123456 when prompted to pair with the device.',
          [{ text: 'OK' }]
        );
      } else if (errorMessage === 'Operation was cancelled') {
        // Handle cancellation gracefully
        console.log('[App] Operation was cancelled - handling gracefully');
        setConnectedDevice(null);
        // Return to scanning state based on whether we have pairedDeviceId
        if (pairedDeviceId) {
          setAppState('scanning-for-paired');
          startScan();
        } else {
          setAppState('scanning-no-paired');
          startScan();
        }
        return;
      } else {
        console.log('[App] Generic connection error');
        Alert.alert('Connection Error', errorMessage);
        setConnectedDevice(null);
        // Return to scanning state
        if (pairedDeviceId) {
          setAppState('scanning-for-paired');
        } else {
          setAppState('scanning-no-paired');
        }
        startScan();
      }
    }
  };

  const startMonitoringNotifications = (device: Device) => {
    console.log('[App] startMonitoringNotifications() called');
    console.log('[App] Device ID:', device.id);
    
    // Clear existing stream
    setNumberStream([]);
    
    // Clean up any existing monitor
    if (monitorCleanup) {
      monitorCleanup();
    }
    
    // Start monitoring notifications
    const cleanup = monitorCharacteristic(device, (value: string) => {
      console.log('[App] Received notification value:', value);
      setNumberStream((prev) => {
        // Keep last 50 numbers to avoid memory issues
        const updated = [value, ...prev];
        return updated.slice(0, 50);
      });
      console.log('[App] Receiving data...');
    });
    
    setMonitorCleanup(() => cleanup);
    console.log('[App] Notification monitoring started');
  };

  const handleDisconnect = async () => {
    console.log('[App] handleDisconnect() called - manual disconnect');
    
    if (connectedDevice) {
      try {
        await disconnectFromDevice(connectedDevice);
        console.log('[App] Device disconnected successfully');
        
        // Clear pairedDeviceId and change state to scanning-no-paired
        setConnectedDevice(null);
        setNumberStream([]);
        setPairedDeviceId(null);
        setAppState('scanning-no-paired');
        console.log('[App] State changed to: scanning-no-paired');
        
        // Clean up notification monitor
        if (monitorCleanup) {
          monitorCleanup();
          setMonitorCleanup(null);
        }
        
        // Start scanning for all devices
        startScan();
      } catch (error: any) {
        console.error('[App] Disconnect error:', error);
        Alert.alert('Disconnect Error', error.message || 'Failed to disconnect');
      }
    }
  };

  const renderDevice = ({ item }: { item: ScanResult }) => (
    <TouchableOpacity
      style={styles.deviceItem}
      onPress={() => handleConnect(item.id)}
      disabled={!!connectedDevice}
    >
      <View style={styles.deviceInfo}>
        <Text style={styles.deviceName}>{item.name || 'Unknown Device'}</Text>
        <Text style={styles.deviceId}>{item.id}</Text>
        {item.rssi !== null && (
          <Text style={styles.deviceRssi}>RSSI: {item.rssi} dBm</Text>
        )}
      </View>
      {connectedDevice?.id === item.id && (
        <View style={styles.connectedBadge}>
          <Text style={styles.connectedText}>Connected</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      
      <View style={styles.content}>
        <Text style={styles.title}>BLE Scanner</Text>
        <Text style={styles.subtitle}>ESP32 Authorization Server</Text>

        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>
            Status: {
              appState === 'scanning-no-paired' ? 'Scanning (no paired device)' :
              appState === 'scanning-for-paired' ? 'Scanning for paired device' :
              'Connected'
            }
          </Text>
        </View>

        {appState === 'connected' && connectedDevice ? (
          <View style={styles.connectedContainer}>
            <View style={styles.deviceInfo}>
              <Text style={styles.connectedDeviceName}>
                {connectedDevice.name || 'Connected Device'}
              </Text>
              <Text style={styles.connectedDeviceId}>{connectedDevice.id}</Text>
            </View>

            <View style={styles.streamContainer}>
              <Text style={styles.streamTitle}>Random Number Stream:</Text>
              {numberStream.length > 0 ? (
                <FlatList
                  data={numberStream}
                  renderItem={({ item, index }) => (
                    <View style={styles.streamItem}>
                      <Text style={styles.streamNumber}>{item}</Text>
                      {index === 0 && (
                        <View style={styles.newBadge}>
                          <Text style={styles.newBadgeText}>NEW</Text>
                        </View>
                      )}
                    </View>
                  )}
                  keyExtractor={(item, index) => `${item}-${index}`}
                  style={styles.streamList}
                  inverted
                />
              ) : (
                <View style={styles.emptyStream}>
                  <Text style={styles.emptyStreamText}>Waiting for numbers...</Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[styles.button, styles.disconnectButton]}
              onPress={handleDisconnect}
            >
              <Text style={styles.buttonText}>Disconnect</Text>
            </TouchableOpacity>

            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                The ESP32 generates random numbers and sends them every second.
                Passkey: 123456
              </Text>
            </View>
          </View>
        ) : appState === 'scanning-for-paired' ? (
          <>
            <View style={styles.scanningIndicator}>
              <ActivityIndicator color="#007AFF" size="small" />
              <Text style={styles.scanningText}>Scanning for paired device...</Text>
            </View>
            <View style={styles.pairedDeviceInfo}>
              <Text style={styles.pairedDeviceText}>
                Looking for paired device. Tap below to clear and scan for all devices.
              </Text>
              <TouchableOpacity
                style={[styles.button, styles.clearButton]}
                onPress={() => {
                  setPairedDeviceId(null);
                  setDevices([]);
                  setAppState('scanning-no-paired');
                  console.log('[App] Cleared paired device ID, state: scanning-no-paired');
                  startScan();
                }}
              >
                <Text style={styles.buttonText}>Clear Paired Device</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <View style={styles.scanningIndicator}>
              <ActivityIndicator color="#007AFF" size="small" />
              <Text style={styles.scanningText}>Scanning for devices...</Text>
            </View>
            {devices.length > 0 && (
              <View style={styles.devicesContainer}>
                <Text style={styles.sectionTitle}>Found Devices:</Text>
                <FlatList
                  data={devices}
                  renderItem={renderDevice}
                  keyExtractor={(item) => item.id}
                  style={styles.devicesList}
                />
              </View>
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  statusContainer: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  scanningIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
  },
  scanningText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#666',
  },
  pairedDeviceInfo: {
    backgroundColor: '#E3F2FD',
    padding: 16,
    borderRadius: 8,
    marginBottom: 20,
    alignItems: 'center',
  },
  pairedDeviceText: {
    fontSize: 14,
    color: '#1976D2',
    marginBottom: 12,
    textAlign: 'center',
  },
  clearButton: {
    backgroundColor: '#FF9800',
  },
  disconnectButton: {
    backgroundColor: '#FF3B30',
    marginTop: 20,
  },
  streamContainer: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginTop: 20,
    marginBottom: 20,
  },
  streamTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  streamList: {
    flex: 1,
  },
  streamItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 6,
    marginBottom: 8,
  },
  streamNumber: {
    fontSize: 18,
    fontWeight: '600',
    color: '#007AFF',
    fontFamily: 'monospace',
  },
  newBadge: {
    backgroundColor: '#34C759',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  newBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  emptyStream: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStreamText: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
  devicesContainer: {
    flex: 1,
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  devicesList: {
    flex: 1,
  },
  deviceItem: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  deviceId: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  deviceRssi: {
    fontSize: 12,
    color: '#999',
  },
  connectedBadge: {
    backgroundColor: '#34C759',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  connectedText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  connectedContainer: {
    flex: 1,
  },
  connectedDeviceName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  connectedDeviceId: {
    fontSize: 12,
    color: '#666',
    marginBottom: 20,
  },
  infoBox: {
    backgroundColor: '#E3F2FD',
    padding: 12,
    borderRadius: 8,
    marginTop: 20,
  },
  infoText: {
    fontSize: 12,
    color: '#1976D2',
    lineHeight: 18,
  },
});

export default App;
