import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, StatusBar,
  ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../AuthContext';
import { useLanguage } from '../LanguageContext';

const COLORS = {
  emerald: '#084C38', teal: '#083B2D', mint: '#A7F3D0', gold: '#D97706',
  white: '#FFFFFF', danger: '#B91C1C',
};

export default function LoginOtpScreen({ navigation, route }) {
  const { t } = useLanguage();
  const { verifyOtp, requestOtp } = useAuth();
  const phone = route?.params?.phone || '';

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [seconds, setSeconds] = useState(60);
  const inputRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => (value > 0 ? value - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (code.length === 6 && !loading) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await verifyOtp(phone, code);
      if (result.isNewAccount) {
        navigation.replace('KYCVerification', { isNewAccount: true });
      } else if (result.customer && result.customer.kycTier >= 1) {
        navigation.replace('Dashboard');
      } else {
        navigation.replace('KYCVerification');
      }
    } catch (err) {
      setError(err.message || 'That code did not match.');
      setCode('');
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    try {
      await requestOtp(phone);
      setSeconds(60);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.teal} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.body}>
          <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color={COLORS.mint} />
          </TouchableOpacity>

          <Text style={styles.title}>{t('enterOtp') || 'Enter your 6-digit code'}</Text>
          <Text style={styles.subtitle}>Sent by SMS to {phone || 'your phone'}</Text>

          <TextInput
            ref={inputRef}
            style={styles.codeInput}
            value={code}
            onChangeText={(value) => { setCode(value.replace(/[^\d]/g, '').slice(0, 6)); setError(null); }}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            placeholder="••••••"
            placeholderTextColor="rgba(167,243,208,0.35)"
          />

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={COLORS.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={COLORS.mint} />
              <Text style={styles.loadingText}>{t('processing') || 'Verifying…'}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.cta, (code.length !== 6 || loading) && styles.ctaDisabled]}
            onPress={submit}
            disabled={code.length !== 6 || loading}
          >
            <Text style={styles.ctaText}>{t('confirm') || 'Verify and continue'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.resend} onPress={resend} disabled={seconds > 0}>
            <Text style={[styles.resendText, seconds > 0 && { opacity: 0.5 }]}>
              {seconds > 0 ? `Resend code in ${seconds}s` : (t('resendCode') || 'Resend code')}
            </Text>
          </TouchableOpacity>

          <Text style={styles.note}>
            Never share this code. AfriSend staff will never ask you for it.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.teal },
  body: { flex: 1, padding: 24, paddingTop: 12 },
  back: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(167,243,208,0.12)' },
  title: { color: '#FFFFFF', fontSize: 27, fontWeight: '800', letterSpacing: -0.7, marginTop: 34 },
  subtitle: { color: '#C9E8DC', fontSize: 14, marginTop: 10, marginBottom: 26 },
  codeInput: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(167,243,208,0.3)',
    borderRadius: 16, height: 68, textAlign: 'center', color: '#FFFFFF', fontSize: 30,
    letterSpacing: 12, fontWeight: '700',
  },
  errorBox: {
    flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: 'rgba(248,113,113,0.12)',
    borderWidth: 1, borderColor: 'rgba(248,113,113,0.35)', padding: 12, borderRadius: 12, marginTop: 14,
  },
  errorText: { color: '#FECACA', fontSize: 13, flex: 1 },
  loadingRow: { flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  loadingText: { color: '#C9E8DC', fontSize: 13 },
  cta: { backgroundColor: COLORS.mint, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { color: COLORS.teal, fontWeight: '800', fontSize: 16 },
  resend: { alignItems: 'center', marginTop: 18 },
  resendText: { color: COLORS.mint, fontSize: 14, fontWeight: '600' },
  note: { color: '#8FC0AE', fontSize: 12, textAlign: 'center', marginTop: 'auto', lineHeight: 17 },
});
