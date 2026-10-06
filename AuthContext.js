/**
 * Customer session context.
 *
 * Holds the signed-in customer (phone → SMS OTP → JWT). The access token is
 * refreshed automatically by services/api.js; screens never handle tokens.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { Api, Session, ApiError } from './services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading'); // loading | signedOut | signedIn
  const [customer, setCustomer] = useState(null);
  const [error, setError] = useState(null);

  const loadProfile = useCallback(async () => {
    const payload = await Api.profile();
    setCustomer(payload.profile);
    return payload.profile;
  }, []);

  // Restore a session on cold start.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { access } = await Session.load();
      if (!access) {
        if (!cancelled) setStatus('signedOut');
        return;
      }
      try {
        const profile = await loadProfile();
        if (!cancelled) {
          setCustomer(profile);
          setStatus('signedIn');
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          await Session.clear();
          setStatus('signedOut');
        } else {
          // Offline: keep the cached customer so the app still opens.
          const cached = await Session.getCustomer();
          setCustomer(cached);
          setStatus(cached ? 'signedIn' : 'signedOut');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [loadProfile]);

  const requestOtp = useCallback(async (phone, deviceId) => Api.requestOtp(phone, deviceId), []);

  const verifyOtp = useCallback(async (phone, code, deviceId) => {
    setError(null);
    try {
      const payload = await Api.verifyOtp(phone, code, deviceId);
      setCustomer(payload.customer);
      setStatus('signedIn');
      // Pull the full profile (wallet, limits) right after sign-in.
      loadProfile().catch(() => {});
      return payload;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await Api.signOut();
    setCustomer(null);
    setStatus('signedOut');
  }, []);

  const value = useMemo(() => ({
    status,
    isSignedIn: status === 'signedIn',
    customer,
    error,
    requestOtp,
    verifyOtp,
    signOut,
    refresh: loadProfile,
    /** Called after KYC approval or a profile edit to re-read limits and tier. */
    setCustomer,
  }), [status, customer, error, requestOtp, verifyOtp, signOut, loadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    // Screens are written defensively: they fall back to their own defaults.
    return { status: 'signedOut', isSignedIn: false, customer: null, refresh: async () => null };
  }
  return context;
}

export default AuthContext;
