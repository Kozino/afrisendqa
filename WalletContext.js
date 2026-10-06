/**
 * Wallet context — everything the money screens need, sourced from the API.
 *
 * There is no local balance arithmetic in the app: the balance always comes
 * from the server (the ledger is the source of truth). `addFunds` is an
 * optimistic hint used right after a top-up is confirmed; it refreshes from the
 * server immediately afterwards, and the authoritative credit is posted by the
 * Flutterwave webhook.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { Api, formatMoney } from './services/api';
import { useAuth } from './AuthContext';

const WalletContext = createContext(null);

export function WalletProvider({ children }) {
  const { isSignedIn, refresh: refreshProfile } = useAuth();
  const [wallet, setWallet] = useState({ availableMinor: 0, pendingMinor: 0, currency: 'QAR' });
  const [limits, setLimits] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [corridors, setCorridors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inFlight = useRef(null);

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!isSignedIn) return null;
    if (inFlight.current) return inFlight.current;
    if (!quiet) setLoading(true);
    inFlight.current = (async () => {
      try {
        const [profile, transferList, beneficiaryList, corridorList] = await Promise.all([
          Api.profile(),
          Api.transfers({ limit: 30 }).catch(() => ({ transfers: [] })),
          Api.beneficiaries().catch(() => ({ beneficiaries: [] })),
          Api.corridors().catch(() => ({ corridors: [] })),
        ]);
        setWallet(profile.profile.wallet);
        setLimits(profile.profile.limits);
        setTransfers(transferList.transfers || []);
        setBeneficiaries(beneficiaryList.beneficiaries || []);
        setCorridors(corridorList.corridors || []);
        setError(null);
        return profile.profile;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setLoading(false);
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, [isSignedIn]);

  useEffect(() => {
    if (isSignedIn) refresh({ quiet: true }).catch(() => {});
    if (!isSignedIn) {
      setWallet({ availableMinor: 0, pendingMinor: 0, currency: 'QAR' });
      setTransfers([]);
      setBeneficiaries([]);
      setLimits(null);
    }
  }, [isSignedIn, refresh]);

  /**
   * Optimistic credit shown while the payment confirmation lands. The server
   * value replaces it on the next refresh (and if the payment later fails, the
   * server is right and the local hint simply disappears).
   */
  const addFunds = useCallback((amount) => {
    const minor = Math.round(Number(amount) * 100);
    if (!Number.isFinite(minor) || minor <= 0) return;
    setWallet((current) => ({ ...current, availableMinor: Number(current.availableMinor) + minor }));
    setTimeout(() => { refresh({ quiet: true }).catch(() => {}); }, 2500);
    refreshProfile().catch(() => {});
  }, [refresh, refreshProfile]);

  const deduct = useCallback((amount) => {
    const minor = Math.round(Number(amount) * 100);
    setWallet((current) => ({ ...current, availableMinor: Math.max(0, Number(current.availableMinor) - minor) }));
  }, []);

  const value = useMemo(() => {
    const availableMinor = Number(wallet.availableMinor || 0);
    return {
      currency: wallet.currency || 'QAR',
      availableMinor,
      pendingMinor: Number(wallet.pendingMinor || 0),
      /** Major units — the shape the existing screens expect. */
      balance: availableMinor / 100,
      balanceFormatted: formatMoney(availableMinor, wallet.currency || 'QAR'),
      limits,
      transfers,
      beneficiaries,
      corridors,
      loading,
      error,
      refresh,
      addFunds,
      deduct,
      /** Helper for screens that need one corridor. */
      corridorFor: (currency) => corridors.find((c) => c.currency === currency) || null,
      findTransfer: (reference) => transfers.find((t) => t.reference === reference) || null,
    };
  }, [wallet, limits, transfers, beneficiaries, corridors, loading, error, refresh, addFunds, deduct]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    return {
      balance: 0,
      currency: 'QAR',
      availableMinor: 0,
      transfers: [],
      beneficiaries: [],
      corridors: [],
      refresh: async () => {},
      addFunds: () => {},
      deduct: () => {},
      corridorFor: () => null,
      findTransfer: () => null,
    };
  }
  return context;
}

export default WalletContext;
