import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, StatusBar,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../AuthContext';
import { useLanguage } from '../LanguageContext';

const COLORS = {
  emerald: '#084C38',
  teal: '#083B2D',
  mint: '#A7F3D0',
  mintSoft: '#E6F6ED',
  gold: '#D97706',
  base: '#F8FAFC',
  white: '#FFFFFF',
  ink: '#0B1C15',
  muted: '#5F7A6E',
  line: '#DCE7E1',
  danger: '#B91C1C',
};

export default function LoginScreen({ navigation }) {
  const { t } = useLanguage();
  const { requestOtp } = useAuth();

  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const cleaned = phone.replace(/[^\d+]/g, '');
  const isValid = /^(\+?\d{8,15})$/.test(cleaned);

  const submit = async () => {
    if (!isValid || loading) return;
    setLoading(true);
    setError(null);
    try {
      // Normalise Qatari local numbers (8 digits) to E.164 before sending.
      const e164 = cleaned.startsWith('+')
        ? cleaned
        : cleaned.startsWith('974') ? `+${cleaned}`
          : cleaned.length === 8 ? `+974${cleaned}` : `+${cleaned}`;

      const result = await requestOtp(e164);
      navigation.navigate('LoginOtp', { phone: result.phone || e164 });
    } catch (err) {
      setError(err.message || 'We could not send the code. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.teal} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color={COLORS.mint} />
          </TouchableOpacity>

          <Text style={styles.brand}>AfriSend</Text>
          <Text style={styles.title}>{t('signIn') || 'Sign in with your phone'}</Text>
          <Text style={styles.subtitle}>
            {t('enterOtpHint') || 'We will text you a 6-digit code. Your number is stored encrypted and never shared with the payout partners.'}
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>{t('phoneNumber') || 'Phone number'}</Text>
            <View style={[styles.inputWrap, error ? styles.inputError : null]}>
              <Text style={styles.prefix}>+974</Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={(value) => { setPhone(value); setError(null); }}
                placeholder="5512 8842"
                placeholderTextColor={COLORS.muted}
                keyboardType="phone-pad"
                autoFocus
                maxLength={17}
              />
            </View>
            <Text style={styles.hint}>Qatar mobile numbers. Outside Qatar? Type your country code (e.g. +234…).</Text>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={COLORS.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.cta, (!isValid || loading) && styles.ctaDisabled]}
            onPress={submit}
            disabled={!isValid || loading}
          >
            {loading ? <ActivityIndicator color={COLORS.white} /> : (
              <Text style={styles.ctaText}>{t('continueLabel') || 'Send code'}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.linkRow} onPress={() => navigation.navigate('CreateAccount')}>
            <Text style={styles.linkText}>New to AfriSend? </Text>
            <Text style={styles.linkStrong}>{t('signUp') || 'Create an account'}</Text>
          </TouchableOpacity>

          <View style={styles.trust}>
            <Ionicons name="shield-checkmark" size={15} color={COLORS.mint} />
            <Text style={styles.trustText}>Regulated by the Qatar Central Bank · funds held in ring-fenced accounts</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.teal },
  scroll: { flexGrow: 1, padding: 24, paddingTop: 12 },
  back: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(167,243,208,0.12)' },
  brand: { color: COLORS.mint, fontWeight: '800', marginTop: 34, letterSpacing: -0.4, fontSize: 15 },
  title: { color: '#FFFFFF', fontSize: 28, fontWeight: '800', letterSpacing: -0.8, marginTop: 8 },
  subtitle: { color: '#C9E8DC', fontSize: 14, lineHeight: 21, marginTop: 10, marginBottom: 28 },
  field: { marginBottom: 18 },
  label: { color: '#C9E8DC', fontSize: 12.5, fontWeight: '700', marginBottom: 8 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(167,243,208,0.25)', borderRadius: 14, paddingHorizontal: 14, height: 56,
  },
  inputError: { borderColor: '#FCA5A5' },
  prefix: { color: COLORS.mint, fontWeight: '700', fontSize: 16, marginRight: 10 },
  input: { flex: 1, color: '#FFFFFF', fontSize: 18, fontWeight: '600', letterSpacing: 1 },
  hint: { color: '#8FC0AE', fontSize: 12, marginTop: 8, lineHeight: 17 },
  errorBox: {
    flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: 'rgba(248,113,113,0.12)',
    borderWidth: 1, borderColor: 'rgba(248,113,113,0.35)', padding: 12, borderRadius: 12, marginBottom: 14,
  },
  errorText: { color: '#FECACA', fontSize: 13, flex: 1, lineHeight: 18 },
  cta: {
    backgroundColor: COLORS.mint, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 6,
  },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { color: COLORS.teal, fontWeight: '800', fontSize: 16 },
  linkRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 20 },
  linkText: { color: '#9FC9B9', fontSize: 14 },
  linkStrong: { color: COLORS.mint, fontSize: 14, fontWeight: '700' },
  trust: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 34, justifyContent: 'center' },
  trustText: { color: '#8FC0AE', fontSize: 11.5, textAlign: 'center', flex: 1, lineHeight: 16 },
});
