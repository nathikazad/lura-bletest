import { Device } from 'react-native-ble-plx';
import { ScanResult } from '../services/BleService';

/**
 * BLE App State Machine
 * 
 * Three states:
 * - scanning-no-paired: Scanning for all devices, no paired device saved
 * - scanning-for-paired: Scanning specifically for a previously paired device (auto-reconnect)
 * - connected: Connected to a device and receiving data
 */

export type BleAppState = 'scanning-no-paired' | 'scanning-for-paired' | 'connected';

/**
 * Context that holds all application state
 */
export interface BleAppContext {
  state: BleAppState;
  devices: ScanResult[];
  connectedDevice: Device | null;
  pairedDeviceId: string | null;
  numberStream: string[];
}

/**
 * Create initial context
 */
export const createInitialContext = (): BleAppContext => ({
  state: 'scanning-no-paired',
  devices: [],
  connectedDevice: null,
  pairedDeviceId: null,
  numberStream: [],
});

/**
 * Transition: scanning-no-paired -> scanning-no-paired
 * Action: Device found, add to list
 */
export const addDeviceToList = (context: BleAppContext, device: ScanResult): BleAppContext => {
  if (context.state !== 'scanning-no-paired') {
    return context;
  }

  const exists = context.devices.find((d) => d.id === device.id);
  if (exists) {
    return context;
  }

  return {
    ...context,
    devices: [...context.devices, device],
  };
};

/**
 * Transition: scanning-no-paired -> scanning-for-paired
 * Action: Device connected, save pairedDeviceId
 */
export const transitionToScanningForPaired = (
  context: BleAppContext,
  pairedDeviceId: string
): BleAppContext => {
  return {
    ...context,
    state: 'scanning-for-paired',
    pairedDeviceId,
  };
};

/**
 * Transition: scanning-for-paired -> connected
 * Action: Paired device found and connected
 */
export const transitionToConnected = (
  context: BleAppContext,
  device: Device
): BleAppContext => {
  return {
    ...context,
    state: 'connected',
    connectedDevice: device,
    pairedDeviceId: device.id,
    devices: [], // Clear device list when connected
  };
};

/**
 * Transition: scanning-for-paired -> scanning-no-paired
 * Action: Clear paired device
 */
export const transitionToScanningNoPaired = (context: BleAppContext): BleAppContext => {
  return {
    ...context,
    state: 'scanning-no-paired',
    pairedDeviceId: null,
    devices: [],
  };
};

/**
 * Transition: connected -> scanning-for-paired
 * Action: Device disconnected (keep pairedDeviceId for auto-reconnect)
 */
export const transitionToScanningForPairedOnDisconnect = (
  context: BleAppContext
): BleAppContext => {
  return {
    ...context,
    state: 'scanning-for-paired',
    connectedDevice: null,
    numberStream: [],
  };
};

/**
 * Transition: connected -> scanning-no-paired
 * Action: Manual disconnect (clear pairedDeviceId)
 */
export const transitionToScanningNoPairedOnDisconnect = (
  context: BleAppContext
): BleAppContext => {
  return {
    ...context,
    state: 'scanning-no-paired',
    connectedDevice: null,
    pairedDeviceId: null,
    numberStream: [],
  };
};

/**
 * Action: Add number to stream (only valid in connected state)
 */
export const addNumberToStream = (context: BleAppContext, number: string): BleAppContext => {
  if (context.state !== 'connected') {
    return context;
  }

  const updated = [number, ...context.numberStream];
  return {
    ...context,
    numberStream: updated.slice(0, 50), // Keep last 50 numbers
  };
};

/**
 * Action: Clear device list (when starting scan in scanning-no-paired state)
 */
export const clearDeviceList = (context: BleAppContext): BleAppContext => {
  if (context.state !== 'scanning-no-paired') {
    return context;
  }

  return {
    ...context,
    devices: [],
  };
};

