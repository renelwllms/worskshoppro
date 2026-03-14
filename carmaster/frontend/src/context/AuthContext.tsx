import { createContext, useContext, useEffect, useState } from 'react';
import api from '../api/client';

type User = { userId: string; email: string; displayName: string; role: string };

interface AuthContextValue {
  user?: User;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  loading: true,
  async login() {},
  logout() {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('cma_token');
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get('/auth/me')
      .then((res) =>
        setUser({
          userId: res.data.id,
          email: res.data.email,
          displayName: res.data.displayName,
          role: res.data.role,
        }),
      )
      .catch(() => {
        localStorage.removeItem('cma_token');
        setUser(undefined);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('cma_token', data.accessToken);
    setUser({
      userId: data.user.sub,
      email: data.user.email,
      displayName: data.user.displayName,
      role: data.user.role,
    });
  };

  const logout = () => {
    localStorage.removeItem('cma_token');
    setUser(undefined);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
