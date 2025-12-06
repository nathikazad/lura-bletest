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
import { createBleManager } from './src/services/BleService';

const App = () => {
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [receivedData, setReceivedData] = useState<string[]>([]);
  const [bleManager] = useState(() => createBleManager());

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

    // Start scanning - specify service UUID for background mode
    // Replace with your actual service UUID or null to scan for all devices
    bleManager.startDeviceScan(
      null, // null = scan for all devices (foreground only)
      // 'YOUR_SERVICE_UUID', // Specify service UUID for background scanning
      { allowDuplicates: false },
      (error, device) => {
        if (error) {
          console.error('Scan error:', error);
          setIsScanning(false);
          return;
        }

        if (device) {
          setDevices((prevDevices) => {
            // Avoid duplicates
            const exists = prevDevices.find((d) => d.id === device.id);
            if (!exists) {
              return [...prevDevices, device];
            }
            return prevDevices;
          });
        }
      }
    );

    // Stop scanning after 10 seconds
    setTimeout(() => {
      bleManager.stopDeviceScan();
      setIsScanning(false);
    }, 10000);
  };

  const stopScan = () => {
    bleManager.stopDeviceScan();
    setIsScanning(false);
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
        if (error) {
          Alert.alert('Disconnection', `Device disconnected: ${error.message}`);
        }
      });

      // Subscribe to all characteristics that support notifications
      const services = await deviceConnection.services();
      
      for (const service of services) {
        const characteristics = await service.characteristics();
        
        for (const characteristic of characteristics) {
          if (characteristic.isNotifiable || characteristic.isIndicatable) {
            try {
              await characteristic.monitor((error, char) => {
                if (error) {
                  console.error('Characteristic monitor error:', error);
                  return;
                }

                if (char?.value) {
                  const data = char.value;
                  const timestamp = new Date().toLocaleTimeString();
                  setReceivedData((prev) => [
                    ...prev,
                    `${timestamp}: ${data}`,
                  ]);
                  console.log('Received data:', data);
                }
              });
            } catch (err) {
              console.log(
                `Could not monitor characteristic ${characteristic.uuid}:`,
                err
              );
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
        setReceivedData([]);
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

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Found Devices ({devices.length})
          </Text>
          {devices.map((device) => (
            <TouchableOpacity
              key={device.id}
              style={styles.deviceItem}
              onPress={() => connectToDevice(device)}>
              <Text style={styles.deviceName}>
                {device.name || 'Unknown Device'}
              </Text>
              <Text style={styles.deviceId}>{device.id}</Text>
              <Text style={styles.deviceRssi}>RSSI: {device.rssi}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {receivedData.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Received Data ({receivedData.length})
            </Text>
            {receivedData.slice(-10).map((data, index) => (
              <View key={index} style={styles.dataItem}>
                <Text style={styles.dataText}>{data}</Text>
              </View>
            ))}
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
});

export default App;

