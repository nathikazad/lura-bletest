import React, { createContext, useContext, useState, ReactNode } from 'react';

interface NgrokStoreContextType {
  ngrokUrl: string;
  setNgrokUrl: (url: string) => void;
}

const NgrokStoreContext = createContext<NgrokStoreContextType | undefined>(undefined);

const DEFAULT_NGROK_URL = 'https://ccfee4a46427.ngrok-free.app';

export const NgrokStoreProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [ngrokUrl, setNgrokUrl] = useState<string>(DEFAULT_NGROK_URL);

  return (
    <NgrokStoreContext.Provider value={{ ngrokUrl, setNgrokUrl }}>
      {children}
    </NgrokStoreContext.Provider>
  );
};

export const useNgrokStore = (): NgrokStoreContextType => {
  const context = useContext(NgrokStoreContext);
  if (!context) {
    throw new Error('useNgrokStore must be used within NgrokStoreProvider');
  }
  return context;
};

