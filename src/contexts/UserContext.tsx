import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { fetchAuthMe, type AuthMeResponse } from '../lib/auth';

type CurrentUser = AuthMeResponse['data']['user'];
type CurrentAuth = AuthMeResponse['data']['auth'];

type UserContextValue = {
  user: CurrentUser | null;
  auth: CurrentAuth | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

const UserContext = createContext<UserContextValue | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [auth, setAuth] = useState<CurrentAuth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const result = await fetchAuthMe();
      setUser(result.data.user);
      setAuth(result.data.auth);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load current user');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const value = useMemo<UserContextValue>(() => ({
    user,
    auth,
    loading,
    error,
    reload: load,
  }), [user, auth, loading, error]);

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
};

export function useCurrentUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useCurrentUser must be used within a UserProvider');
  }
  return context;
}
