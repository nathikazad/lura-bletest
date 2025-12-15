import React from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { Device } from 'react-native-ble-plx';
import { ScanResult } from '../services/BleService';
import { BleAppState } from '../state/BleStateMachine';

interface BleScannerViewProps {
  appState: BleAppState;
  devices: ScanResult[];
  connectedDevice: Device | null;
  numberStream: string[];
  pairedDeviceId: string | null;
  onDevicePress: (deviceId: string) => void;
  onDisconnect: () => void;
  onClearPairedDevice: () => void;
}

/**
 * Status Bar Component
 * Displays the current app state
 */
const StatusBarComponent: React.FC<{ appState: BleAppState }> = ({ appState }) => {
  const getStatusText = () => {
    switch (appState) {
      case 'scanning-no-paired':
        return 'Scanning (no paired device)';
      case 'scanning-for-paired':
        return 'Scanning for paired device';
      case 'connected':
        return 'Connected';
    }
  };

  return (
    <View style={styles.statusContainer}>
      <Text style={styles.statusText}>Status: {getStatusText()}</Text>
    </View>
  );
};

/**
 * Device List Item Component
 */
const DeviceListItem: React.FC<{
  device: ScanResult;
  isConnected: boolean;
  onPress: () => void;
  disabled: boolean;
}> = ({ device, isConnected, onPress, disabled }) => (
  <TouchableOpacity style={styles.deviceItem} onPress={onPress} disabled={disabled}>
    <View style={styles.deviceInfo}>
      <Text style={styles.deviceName}>{device.name || 'Unknown Device'}</Text>
      <Text style={styles.deviceId}>{device.id}</Text>
      {device.rssi !== null && <Text style={styles.deviceRssi}>RSSI: {device.rssi} dBm</Text>}
    </View>
    {isConnected && (
      <View style={styles.connectedBadge}>
        <Text style={styles.connectedText}>Connected</Text>
      </View>
    )}
  </TouchableOpacity>
);

/**
 * Device List Component
 * Shows list of found devices (for scanning-no-paired state)
 */
const DeviceList: React.FC<{
  devices: ScanResult[];
  connectedDevice: Device | null;
  onDevicePress: (deviceId: string) => void;
}> = ({ devices, connectedDevice, onDevicePress }) => {
  if (devices.length === 0) {
    return null;
  }

  return (
    <View style={styles.devicesContainer}>
      <Text style={styles.sectionTitle}>Found Devices:</Text>
      <FlatList
        data={devices}
        renderItem={({ item }) => (
          <DeviceListItem
            device={item}
            isConnected={connectedDevice?.id === item.id}
            onPress={() => onDevicePress(item.id)}
            disabled={!!connectedDevice}
          />
        )}
        keyExtractor={(item) => item.id}
        style={styles.devicesList}
      />
    </View>
  );
};

/**
 * Number Stream Component
 * Displays the stream of numbers received from device
 */
const NumberStream: React.FC<{ numbers: string[] }> = ({ numbers }) => {
  return (
    <View style={styles.streamContainer}>
      <Text style={styles.streamTitle}>Random Number Stream:</Text>
      {numbers.length > 0 ? (
        <FlatList
          data={numbers}
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
  );
};

/**
 * Connected View Component
 * Rendered when appState === 'connected'
 */
const ConnectedView: React.FC<{
  connectedDevice: Device;
  numberStream: string[];
  onDisconnect: () => void;
}> = ({ connectedDevice, numberStream, onDisconnect }) => {
  return (
    <View style={styles.connectedContainer}>
      <View style={styles.deviceInfo}>
        <Text style={styles.connectedDeviceName}>
          {connectedDevice.name || 'Connected Device'}
        </Text>
        <Text style={styles.connectedDeviceId}>{connectedDevice.id}</Text>
      </View>

      <NumberStream numbers={numberStream} />

      <TouchableOpacity style={[styles.button, styles.disconnectButton]} onPress={onDisconnect}>
        <Text style={styles.buttonText}>Disconnect</Text>
      </TouchableOpacity>

      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          The ESP32 generates random numbers and sends them every second. Passkey: 123456
        </Text>
      </View>
    </View>
  );
};

/**
 * Scanning For Paired View Component
 * Rendered when appState === 'scanning-for-paired'
 */
const ScanningForPairedView: React.FC<{ onClearPairedDevice: () => void }> = ({
  onClearPairedDevice,
}) => {
  return (
    <>
      <View style={styles.scanningIndicator}>
        <ActivityIndicator color="#007AFF" size="small" />
        <Text style={styles.scanningText}>Scanning for paired device...</Text>
      </View>
      <View style={styles.pairedDeviceInfo}>
        <Text style={styles.pairedDeviceText}>
          Looking for paired device. Tap below to clear and scan for all devices.
        </Text>
        <TouchableOpacity style={[styles.button, styles.clearButton]} onPress={onClearPairedDevice}>
          <Text style={styles.buttonText}>Clear Paired Device</Text>
        </TouchableOpacity>
      </View>
    </>
  );
};

/**
 * Scanning No Paired View Component
 * Rendered when appState === 'scanning-no-paired'
 */
const ScanningNoPairedView: React.FC<{
  devices: ScanResult[];
  connectedDevice: Device | null;
  onDevicePress: (deviceId: string) => void;
}> = ({ devices, connectedDevice, onDevicePress }) => {
  return (
    <>
      <View style={styles.scanningIndicator}>
        <ActivityIndicator color="#007AFF" size="small" />
        <Text style={styles.scanningText}>Scanning for devices...</Text>
      </View>
      <DeviceList devices={devices} connectedDevice={connectedDevice} onDevicePress={onDevicePress} />
    </>
  );
};

/**
 * Main BLE Scanner View Component
 * Routes to appropriate view component based on appState
 */
export const BleScannerView: React.FC<BleScannerViewProps> = ({
  appState,
  devices,
  connectedDevice,
  numberStream,
  onDevicePress,
  onDisconnect,
  onClearPairedDevice,
}) => {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.content}>
        <Text style={styles.title}>BLE Scanner</Text>
        <Text style={styles.subtitle}>ESP32 Authorization Server</Text>

        <StatusBarComponent appState={appState} />

        {/* State-based routing - each state has its own component */}
        {appState === 'connected' && connectedDevice ? (
          <ConnectedView
            connectedDevice={connectedDevice}
            numberStream={numberStream}
            onDisconnect={onDisconnect}
          />
        ) : appState === 'scanning-for-paired' ? (
          <ScanningForPairedView onClearPairedDevice={onClearPairedDevice} />
        ) : (
          <ScanningNoPairedView
            devices={devices}
            connectedDevice={connectedDevice}
            onDevicePress={onDevicePress}
          />
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
