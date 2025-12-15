import React from 'react';
import { useBleApp } from './src/hooks/useBleApp';
import { BleScannerView } from './src/components/BleScannerView';

const App = () => {
  const {
    appState,
    devices,
    connectedDevice,
    numberStream,
    pairedDeviceId,
    onDevicePress,
    onDisconnect,
    onClearPairedDevice,
  } = useBleApp();

  return (
    <BleScannerView
      appState={appState}
      devices={devices}
      connectedDevice={connectedDevice}
      numberStream={numberStream}
      pairedDeviceId={pairedDeviceId}
      onDevicePress={onDevicePress}
      onDisconnect={onDisconnect}
      onClearPairedDevice={onClearPairedDevice}
    />
  );
};

export default App;
