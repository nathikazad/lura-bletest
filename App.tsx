import React, { useEffect, useState, useRef } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import { BleManager, Device } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { createBleManager } from './src/services/BleService';

// ESP32 device constants
const ESP32_SERVICE_UUID = '19B10000-E8F2-537E-4F6C-D104768A1214';
const ESP32_CHARACTERISTIC_UUID = '19B10001-E8F2-537E-4F6C-D104768A1214';
const ESP32_DEVICE_NAME = 'RandomNumber';

// Default Ngrok server URL
const DEFAULT_NGROK_SERVER_URL = 'https://885bd333b988.ngrok-free.app/number';

interface RandomNumberData {
  timestamp: string;
  value: number;
}

const App = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [randomNumbers, setRandomNumbers] = useState<RandomNumberData[]>([]);
  const [lastForwardedValue, setLastForwardedValue] = useState<number | null>(null);
  const [forwardError, setForwardError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string>('Not connected');
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string>(DEFAULT_NGROK_SERVER_URL);
  const [showUrlEditor, setShowUrlEditor] = useState(false);
  
  const bleManager = useRef<BleManager>(createBleManager()).current;
  const connectedDeviceRef = useRef<Device | null>(null);
  const isConnectingRef = useRef(false);

  useEffect(() => {
    // Check if Bluetooth is enabled
    bleManager.state().then((state) => {
      if (state !== 'PoweredOn') {
        Alert.alert('Bluetooth', 'Please enable Bluetooth to use this app');
      }
    });

    // Listen for state changes
    const subscription = bleManager.onStateChange((state) => {
      if (state === 'PoweredOn') {
        console.log('Bluetooth is powered on');
        // Auto-start scanning when Bluetooth is enabled
        if (!isConnected && !isScanning) {
          startReconnectionScan();
        }
      }
    });

    // Auto-start scanning on mount
    startReconnectionScan();

    return () => {
      subscription.remove();
      bleManager.stopDeviceScan();
    };
  }, []);

  const startReconnectionScan = () => {
    if (isScanning || isConnectingRef.current) {
      return;
    }

    console.log('Starting reconnection scan for ESP32 device...');
    setIsScanning(true);
    setConnectionStatus('Scanning for ESP32...');

    bleManager.startDeviceScan(
      [ESP32_SERVICE_UUID], // Service UUID filter for background scanning
      { allowDuplicates: true }, // Allow duplicates to catch every advertising window
      (error, device) => {
        if (error) {
          console.error('Scan error:', error);
          return;
        }

        if (device && !isConnected && !isConnectingRef.current) {
          console.log('ESP32 device detected:', {
              name: device.name,
              id: device.id,
          });
          connectToDevice(device);
        }
      }
    );
  };

  const handleCharacteristicValue = (value: string | null) => {
    if (!value) return;
    
    try {
      const base64Value = value;
      const buffer = Buffer.from(base64Value, 'base64');
      const randomValue = buffer.readUInt8(0);
      
      const timestamp = new Date().toISOString();
      const data: RandomNumberData = {
        timestamp,
        value: randomValue,
      };
      
      setRandomNumbers((prev) => [data, ...prev]);
      console.log('Received random number:', randomValue);
      
      // Forward to server
      forwardToServer(randomValue);
    } catch (parseError) {
      console.error('Error parsing random number:', parseError);
    }
  };

  const connectToDevice = async (device: Device) => {
    if (isConnectingRef.current) {
      return;
    }

    isConnectingRef.current = true;
    setIsScanning(false);
    setConnectionStatus('Connecting...');
    bleManager.stopDeviceScan();

    let deviceConnection: Device | null = null;

    try {
      deviceConnection = await device.connect();
      connectedDeviceRef.current = deviceConnection;
      setIsConnected(true);
      setDeviceId(device.id);
      setConnectionStatus(`Connected: ${device.name || device.id}`);

      // Monitor device disconnection FIRST (before any async operations)
      deviceConnection.onDisconnected((error, device) => {
        console.log('Device disconnected (expected - ESP32 sleeping):', device?.id, error?.message);
        connectedDeviceRef.current = null;
        setIsConnected(false);
        setConnectionStatus('Disconnected - Waiting for ESP32 to wake up...');
        isConnectingRef.current = false;
        
        // Start scanning again to catch when device wakes up
        setTimeout(() => {
          startReconnectionScan();
        }, 500);
      });

      // Discover services and characteristics
      await deviceConnection.discoverAllServicesAndCharacteristics();

      // Find and subscribe to the random number characteristic
      const services = await deviceConnection.services();
      
      for (const service of services) {
        if (service.uuid.toLowerCase() === ESP32_SERVICE_UUID.toLowerCase()) {
          const characteristics = await service.characteristics();
          
          for (const characteristic of characteristics) {
            if (characteristic.uuid.toLowerCase() === ESP32_CHARACTERISTIC_UUID.toLowerCase()) {
              // Read initial value first (ESP32 sends immediately on connection)
              try {
                const initialValue = await characteristic.read();
                if (initialValue?.value) {
                  console.log('Read initial characteristic value');
                  handleCharacteristicValue(initialValue.value);
                }
              } catch (readError) {
                console.log('Could not read initial value (may not be available):', readError);
              }

              // Then set up monitoring for notifications
              if (characteristic.isNotifiable || characteristic.isIndicatable) {
                try {
                  await characteristic.monitor((error, char) => {
                    if (error) {
                      // Don't log disconnection errors as errors - they're expected
                      if (error.message?.includes('disconnected')) {
                        console.log('Monitor stopped due to disconnection (expected)');
                        return;
                      }
                      console.error('Characteristic monitor error:', error);
                      return;
                    }

                    if (char?.value) {
                      handleCharacteristicValue(char.value);
                    }
                  });
                  console.log('Subscribed to random number characteristic notifications');
                } catch (err: any) {
                  console.error('Could not monitor characteristic:', err);
                  // Don't show alert for expected disconnections
                  if (!err?.message?.includes('disconnected')) {
                    Alert.alert('Error', 'Could not subscribe to random number characteristic');
                  }
                }
              } else {
                // If not notifiable, try reading periodically
                console.log('Characteristic is not notifiable, will read periodically');
                const readInterval = setInterval(async () => {
                  if (!connectedDeviceRef.current || !isConnected) {
                    clearInterval(readInterval);
                    return;
                  }
                  try {
                    const value = await characteristic.read();
                    if (value?.value) {
                      handleCharacteristicValue(value.value);
                    }
                  } catch (err) {
                    clearInterval(readInterval);
                  }
                }, 1000);
              }
            }
          }
        }
      }

      isConnectingRef.current = false;
    } catch (error: any) {
      // Check if error is due to disconnection (expected behavior)
      const errorMessage = error?.message || '';
      const isDisconnectionError = 
        errorMessage.includes('disconnected') || 
        errorMessage.includes('Device was disconnected');
      
      if (isDisconnectionError) {
        console.log('Connection interrupted by disconnection (expected - ESP32 sleeping)');
        setConnectionStatus('Disconnected - Waiting for ESP32 to wake up...');
      } else {
        console.error('Connection error:', error);
        setConnectionStatus('Connection failed - Retrying...');
      }
      
      setIsConnected(false);
      connectedDeviceRef.current = null;
      isConnectingRef.current = false;
      
      // Retry connection after a short delay
      setTimeout(() => {
        startReconnectionScan();
      }, 2000);
    }
  };

  const forwardToServer = async (number: number) => {
    if (!serverUrl || serverUrl.trim() === '') {
      console.log('Server URL not set, skipping forward');
      return;
    }

    try {
      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify({ number }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('Successfully forwarded to server:', result);
      setLastForwardedValue(number);
      setForwardError(null);
    } catch (error: any) {
      console.error('Error forwarding to server:', error);
      setForwardError(error.message || 'Failed to forward to server');
    }
  };

  const handleManualDisconnect = async () => {
    if (connectedDeviceRef.current) {
      try {
        await connectedDeviceRef.current.cancelConnection();
        connectedDeviceRef.current = null;
        setIsConnected(false);
        setConnectionStatus('Manually disconnected');
        isConnectingRef.current = false;
        // Don't auto-reconnect after manual disconnect
        bleManager.stopDeviceScan();
        setIsScanning(false);
      } catch (error: any) {
        console.error('Disconnect error:', error);
      }
    }
  };

  const handleStartScan = () => {
    if (!isScanning && !isConnected) {
      startReconnectionScan();
    }
  };

  const handleStopScan = () => {
    bleManager.stopDeviceScan();
    setIsScanning(false);
    setConnectionStatus('Scanning stopped');
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>ESP32 Random Number Monitor</Text>
        <View style={styles.statusContainer}>
          <View style={[
            styles.statusIndicator,
            { backgroundColor: isConnected ? '#4CAF50' : isScanning ? '#FF9800' : '#9E9E9E' }
          ]} />
          <Text style={styles.statusText}>{connectionStatus}</Text>
        </View>
        {deviceId && (
          <Text style={styles.deviceId}>Device ID: {deviceId}</Text>
        )}
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        {!isConnected && (
          <>
          {!isScanning ? (
              <TouchableOpacity style={styles.button} onPress={handleStartScan}>
              <Text style={styles.buttonText}>Start Scan</Text>
            </TouchableOpacity>
          ) : (
              <TouchableOpacity style={[styles.button, styles.buttonStop]} onPress={handleStopScan}>
              <Text style={styles.buttonText}>Stop Scan</Text>
            </TouchableOpacity>
          )}
          </>
        )}
        {isConnected && (
          <TouchableOpacity style={[styles.button, styles.buttonDisconnect]} onPress={handleManualDisconnect}>
              <Text style={styles.buttonText}>Disconnect</Text>
            </TouchableOpacity>
          )}
        </View>

      {/* Server URL Editor */}
      <View style={styles.urlSection}>
        <TouchableOpacity 
          style={styles.urlHeader}
          onPress={() => setShowUrlEditor(!showUrlEditor)}>
          <Text style={styles.urlHeaderText}>
            {showUrlEditor ? '▼' : '▶'} Server URL
          </Text>
          {serverUrl && (
            <Text style={styles.urlPreview} numberOfLines={1}>
              {serverUrl}
            </Text>
          )}
        </TouchableOpacity>
        
        {showUrlEditor && (
          <View style={styles.urlEditor}>
            <TextInput
              style={styles.urlInput}
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="Enter server URL (e.g., https://your-server.com/number)"
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <View style={styles.urlButtons}>
              <TouchableOpacity
                style={[styles.urlButton, styles.urlButtonReset]}
                onPress={() => setServerUrl(DEFAULT_NGROK_SERVER_URL)}>
                <Text style={styles.urlButtonText}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.urlButton, styles.urlButtonSave]}
                onPress={() => {
                  setShowUrlEditor(false);
                  Alert.alert('Success', 'Server URL updated');
                }}>
                <Text style={[styles.urlButtonText, styles.urlButtonSaveText]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* Info Banner */}
      {isConnected && (
        <View style={styles.infoBanner}>
          <Text style={styles.infoText}>
            ℹ️ ESP32 will disconnect to sleep for 10s, then advertise for 20s. Auto-reconnecting...
                </Text>
          </View>
        )}

      {/* Forward Status */}
      {(lastForwardedValue !== null || forwardError) && (
        <View style={styles.forwardStatus}>
            {lastForwardedValue !== null && (
            <View style={styles.successStatus}>
              <Text style={styles.successText}>
                ✅ Last forwarded: {lastForwardedValue}
                </Text>
              </View>
            )}
            {forwardError && (
            <View style={styles.errorStatus}>
                <Text style={styles.errorText}>
                  ❌ Forward error: {forwardError}
                </Text>
              </View>
            )}
        </View>
      )}

      {/* Data Stream */}
      <View style={styles.dataSection}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            Random Number Stream
          </Text>
          <Text style={styles.countText}>{randomNumbers.length} values</Text>
        </View>

            {randomNumbers.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              {isConnected ? 'Waiting for data...' : 'No data received yet'}
            </Text>
              </View>
            ) : (
              <ScrollView 
                style={styles.streamContainer}
                nestedScrollEnabled={true}
                showsVerticalScrollIndicator={true}>
                {randomNumbers.map((data, index) => {
                  const date = new Date(data.timestamp);
                  const hours = date.getHours().toString().padStart(2, '0');
                  const minutes = date.getMinutes().toString().padStart(2, '0');
                  const seconds = date.getSeconds().toString().padStart(2, '0');
                  const milliseconds = date.getMilliseconds().toString().padStart(3, '0');
                  const timeString = `${hours}:${minutes}:${seconds}.${milliseconds}`;
                  
                  return (
                    <View key={index} style={styles.dataItem}>
                        <Text style={styles.timestampText}>{timeString}</Text>
                        <Text style={styles.valueText}>{data.value}</Text>
                    </View>
                  );
                })}
              </ScrollView>
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
  header: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  statusText: {
    fontSize: 14,
    color: '#666',
    flex: 1,
  },
  deviceId: {
    fontSize: 11,
    color: '#999',
    fontFamily: 'monospace',
    marginTop: 4,
  },
  controls: {
    padding: 16,
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonStop: {
    backgroundColor: '#FF3B30',
  },
  buttonDisconnect: {
    backgroundColor: '#FF9500',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  urlSection: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  urlHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
  urlHeaderText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  urlPreview: {
    flex: 1,
    fontSize: 11,
    color: '#999',
    marginLeft: 8,
    textAlign: 'right',
    fontFamily: 'monospace',
  },
  urlEditor: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  urlInput: {
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 12,
    fontSize: 14,
    color: '#333',
    marginBottom: 12,
    fontFamily: 'monospace',
  },
  urlButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  urlButton: {
    flex: 1,
    padding: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  urlButtonReset: {
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  urlButtonSave: {
    backgroundColor: '#007AFF',
  },
  urlButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  urlButtonSaveText: {
    color: '#fff',
  },
  infoBanner: {
    backgroundColor: '#E3F2FD',
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#2196F3',
  },
  infoText: {
    fontSize: 12,
    color: '#1565C0',
  },
  forwardStatus: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  successStatus: {
    backgroundColor: '#E8F5E9',
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#4CAF50',
  },
  successText: {
    fontSize: 12,
    color: '#2E7D32',
    fontFamily: 'monospace',
  },
  errorStatus: {
    backgroundColor: '#FFEBEE',
    padding: 10,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#F44336',
  },
  errorText: {
    fontSize: 12,
    color: '#C62828',
    fontFamily: 'monospace',
  },
  dataSection: {
    flex: 1,
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  countText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  emptyState: {
    backgroundColor: '#fff',
    padding: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
  },
  streamContainer: {
    flex: 1,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 8,
  },
  dataItem: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#34C759',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timestampText: {
    fontSize: 12,
    color: '#666',
    fontFamily: 'monospace',
  },
  valueText: {
    fontSize: 18,
    color: '#007AFF',
    fontWeight: '600',
    fontFamily: 'monospace',
  },
});

export default App;

