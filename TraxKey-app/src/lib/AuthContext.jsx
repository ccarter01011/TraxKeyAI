import { createContext, useContext, useState } from 'react';
import { setToken, clearToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const name = localStorage.getItem('tk_name');
    const role = localStorage.getItem('tk_role');
    return name ? { name, role } : null;
  });

  function login({ token, name, role }) {
    setToken(token);
    localStorage.setItem('tk_name', name || '');
    localStorage.setItem('tk_role', role || '');
    setUser({ name, role });
  }

  function logout() {
    clearToken();
    localStorage.removeItem('tk_name');
    localStorage.removeItem('tk_role');
    setUser(null);
  }

  function updateUserName(name) {
    localStorage.setItem('tk_name', name || '');
    setUser(u => (u ? { ...u, name } : u));
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUserName }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
