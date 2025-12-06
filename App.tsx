import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import { BleManager, Device, Characteristic } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { createBleManager } from './src/services/BleService';

// Arduino device constants
const ARDUINO_SERVICE_UUID = '19B10000-E8F2-537E-4F6C-D104768A1214';
const ARDUINO_CHARACTERISTIC_UUID = '19B10001-E8F2-537E-4F6C-D104768A1214';
const ARDUINO_DEVICE_NAME = 'RandomNumber';
const ARDUINO_DEVICE_NAME_ALT = 'Arduino'; // Alternative name that might appear

// Ngrok server URL
const NGROK_SERVER_URL = 'https://1ccc2d4af2ca.ngrok-free.app/number';

interface RandomNumberData {
  timestamp: string;
  value: number;
}

const App = () => {
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [randomNumbers, setRandomNumbers] = useState<RandomNumberData[]>([]);
  const [bleManager] = useState(() => createBleManager());
  const [lastForwardedValue, setLastForwardedValue] = useState<number | null>(null);
  const [forwardError, setForwardError] = useState<string | null>(null);

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
      } else {
        Alert.alert('Bluetooth', 'Bluetooth is not available');
      }
    });

    return () => {
      subscription.remove();
    };
  }, [bleManager]);

  const startScan = () => {
    if (isScanning) {
      return;
    }

    setIsScanning(true);
    setDevices([]);

    // Start scanning for all devices (service UUID filtering may be too restrictive)
    bleManager.startDeviceScan(
      null, // Scan all devices, then filter by service UUID or name
      { allowDuplicates: false },
      (error, device) => {
        if (error) {
          console.error('Scan error:', error);
          setIsScanning(false);
          return;
        }

        if (device) {
          // Check if it's the Arduino device by name or service UUID
          const deviceName = device.name || '';
          const serviceUUIDs = device.serviceUUIDs || [];
          
          // Normalize UUIDs for comparison (case-insensitive)
          const normalizedServiceUUID = ARDUINO_SERVICE_UUID.toLowerCase();
          const hasMatchingService = serviceUUIDs.some(
            uuid => uuid.toLowerCase() === normalizedServiceUUID
          );
          
          const isArduinoDevice = 
            deviceName === ARDUINO_DEVICE_NAME ||
            deviceName === ARDUINO_DEVICE_NAME_ALT ||
            deviceName.toLowerCase().includes('arduino') ||
            hasMatchingService;

          if (isArduinoDevice) {
            console.log('Found Arduino device:', {
              name: device.name,
              id: device.id,
              serviceUUIDs: device.serviceUUIDs,
            });
            
            setDevices((prevDevices) => {
              // Avoid duplicates
              const exists = prevDevices.find((d) => d.id === device.id);
              if (!exists) {
                // Auto-connect to the Arduino device
                connectToDevice(device);
                return [...prevDevices, device];
              }
              return prevDevices;
            });
          }
        }
      }
    );

    // Stop scanning after 30 seconds if not connected
    setTimeout(() => {
      if (!connectedDevice) {
        bleManager.stopDeviceScan();
        setIsScanning(false);
      }
    }, 30000);
  };

  const stopScan = () => {
    bleManager.stopDeviceScan();
    setIsScanning(false);
  };

  const forwardToServer = async (number: number) => {
    try {
      const response = await fetch(NGROK_SERVER_URL, {
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

  const connectToDevice = async (device: Device) => {
    try {
      stopScan();

      const deviceConnection = await device.connect();
      setConnectedDevice(deviceConnection);

      // Discover services and characteristics
      await deviceConnection.discoverAllServicesAndCharacteristics();

      // Monitor device disconnection
      deviceConnection.onDisconnected((error, device) => {
        console.log('Device disconnected:', device?.id);
        setConnectedDevice(null);
        setRandomNumbers([]);
        setLastForwardedValue(null);
        setForwardError(null);
        if (error) {
          Alert.alert('Disconnection', `Device disconnected: ${error.message}`);
        }
      });

      // Find and subscribe to the Arduino random number characteristic
      const services = await deviceConnection.services();
      
      for (const service of services) {
        if (service.uuid.toLowerCase() === ARDUINO_SERVICE_UUID.toLowerCase()) {
          const characteristics = await service.characteristics();
          
          for (const characteristic of characteristics) {
            if (characteristic.uuid.toLowerCase() === ARDUINO_CHARACTERISTIC_UUID.toLowerCase()) {
              if (characteristic.isNotifiable || characteristic.isIndicatable) {
                try {
                  await characteristic.monitor((error, char) => {
                    if (error) {
                      console.error('Characteristic monitor error:', error);
                      return;
                    }

                    if (char?.value) {
                      // Parse the base64 encoded byte value
                      try {
                        // The value is base64 encoded, decode it to get the byte
                        const base64Value = char.value;
                        // react-native-ble-plx returns base64 encoded data
                        const buffer = Buffer.from(base64Value, 'base64');
                        // Get the first byte (0-255)
                        const randomValue = buffer.readUInt8(0);
                        
                        const timestamp = new Date().toISOString();
                        const data: RandomNumberData = {
                          timestamp,
                          value: randomValue,
                        };
                        
                        setRandomNumbers((prev) => [data, ...prev]);
                        console.log('Received random number:', randomValue);
                        
                        // Forward to ngrok server
                        forwardToServer(randomValue);
                      } catch (parseError) {
                        console.error('Error parsing random number:', parseError);
                      }
                    }
                  });
                  console.log('Subscribed to random number characteristic');
                } catch (err) {
                  console.error('Could not monitor characteristic:', err);
                  Alert.alert('Error', 'Could not subscribe to random number characteristic');
                }
              }
            }
          }
        }
      }

      Alert.alert('Success', `Connected to ${device.name || device.id}`);
    } catch (error: any) {
      Alert.alert('Connection Error', error.message);
      console.error('Connection error:', error);
    }
  };

  const disconnectDevice = async () => {
    if (connectedDevice) {
      try {
        await connectedDevice.cancelConnection();
        setConnectedDevice(null);
        setRandomNumbers([]);
        setLastForwardedValue(null);
        setForwardError(null);
      } catch (error: any) {
        Alert.alert('Disconnect Error', error.message);
      }
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Text style={styles.title}>BLE Scanner</Text>
        <Text style={styles.subtitle}>
          {connectedDevice
            ? `Connected: ${connectedDevice.name || connectedDevice.id}`
            : 'Not connected'}
        </Text>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.buttonContainer}>
          {!isScanning ? (
            <TouchableOpacity style={styles.button} onPress={startScan}>
              <Text style={styles.buttonText}>Start Scan</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.button, styles.buttonStop]}
              onPress={stopScan}>
              <Text style={styles.buttonText}>Stop Scan</Text>
            </TouchableOpacity>
          )}

          {connectedDevice && (
            <TouchableOpacity
              style={[styles.button, styles.buttonDisconnect]}
              onPress={disconnectDevice}>
              <Text style={styles.buttonText}>Disconnect</Text>
            </TouchableOpacity>
          )}
        </View>

        {!connectedDevice && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Scanning for Arduino Device...
            </Text>
            {devices.length > 0 && (
              <View style={styles.deviceItem}>
                <Text style={styles.deviceName}>
                  {devices[0].name || 'Arduino Device'}
                </Text>
                <Text style={styles.deviceId}>{devices[0].id}</Text>
                <Text style={styles.deviceRssi}>RSSI: {devices[0].rssi}</Text>
              </View>
            )}
          </View>
        )}

        {connectedDevice && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Random Number Stream ({randomNumbers.length})
            </Text>
            {lastForwardedValue !== null && (
              <View style={styles.statusItem}>
                <Text style={styles.statusText}>
                  ✅ Last forwarded: {lastForwardedValue} → {NGROK_SERVER_URL}
                </Text>
              </View>
            )}
            {forwardError && (
              <View style={[styles.statusItem, styles.errorItem]}>
                <Text style={styles.errorText}>
                  ❌ Forward error: {forwardError}
                </Text>
              </View>
            )}
            {randomNumbers.length === 0 ? (
              <View style={styles.dataItem}>
                <Text style={styles.dataText}>Waiting for data...</Text>
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
                      <Text style={styles.dataText}>
                        <Text style={styles.timestampText}>{timeString}</Text>
                        {' → '}
                        <Text style={styles.valueText}>{data.value}</Text>
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        )}
      </ScrollView>
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
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
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
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  deviceItem: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  deviceId: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    fontFamily: 'monospace',
  },
  deviceRssi: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  dataItem: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#34C759',
  },
  dataText: {
    fontSize: 14,
    color: '#333',
    fontFamily: 'monospace',
  },
  streamContainer: {
    maxHeight: 400,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 8,
  },
  timestampText: {
    color: '#666',
    fontSize: 12,
  },
  valueText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
  },
  statusItem: {
    backgroundColor: '#E8F5E9',
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#4CAF50',
  },
  statusText: {
    fontSize: 12,
    color: '#2E7D32',
    fontFamily: 'monospace',
  },
  errorItem: {
    backgroundColor: '#FFEBEE',
    borderLeftColor: '#F44336',
  },
  errorText: {
    fontSize: 12,
    color: '#C62828',
    fontFamily: 'monospace',
  },
});

export default App;

