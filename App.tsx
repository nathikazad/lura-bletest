import React from 'react';
import { useBleApp } from './src/hooks/useBleApp';
import { BleScannerView } from './src/components/BleScannerView';
import { NgrokStoreProvider } from './src/state/NgrokStore';

const AppContent = () => {
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

const App = () => {
  return (
    <NgrokStoreProvider>
      <AppContent />
    </NgrokStoreProvider>
  );
};

export default App;
