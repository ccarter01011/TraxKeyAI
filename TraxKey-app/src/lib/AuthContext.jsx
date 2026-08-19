import { createContext, useContext, useState } from 'react';
import { setToken, clearToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const name = localStorage.getItem('tk_name');
    const role = localStorage.getItem('tk_role');
    const email = localStorage.getItem('tk_email');
    return name ? { name, role, email } : null;
  });

  function login({ token, name, role, email }) {
    setToken(token);
    localStorage.setItem('tk_name', name || '');
    localStorage.setItem('tk_role', role || '');
    localStorage.setItem('tk_email', email || '');
    setUser({ name, role, email });
  }

  function logout() {
    clearToken();
    localStorage.removeItem('tk_name');
    localStorage.removeItem('tk_role');
    localStorage.removeItem('tk_email');
    setUser(null);
  }

  function updateUserName(name) {
    localStorage.setItem('tk_name', name || '');
    setUser(u => (u ? { ...u, name } : u));
  }

  function updateUserEmail(email) {
    localStorage.setItem('tk_email', email || '');
    setUser(u => (u ? { ...u, email } : u));
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUserName, updateUserEmail }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
