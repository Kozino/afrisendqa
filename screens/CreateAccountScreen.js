import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Ionicons,
  MaterialIcons,
  MaterialCommunityIcons,
  FontAwesome5,
} from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';

const GREEN = '#084C38';
const DARK_TEAL = '#083B2D';
const MINT = '#A7F3D0';
const ORANGE = '#D97706';

export default function CreateAccountScreen({ navigation }) {
  // Safe translation helper
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) {
      t = lang.t;
    }
  } catch (e) {
    console.log('LanguageContext fallback in CreateAccountScreen:', e);
  }

  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [qid, setQid] = useState('');
  const [nationality, setNationality] = useState('Nigeria');
  const [showPassword, setShowPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(true);

  // Password strength calculation
  const getPasswordStrength = () => {
    if (!password) return { score: 0, text: '', color: '#E2E8F0' };
    let score = 0;
    if (password.length >= 8) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;

    if (score <= 1) return { score: 1, text: 'Weak', color: '#EF4444' };
    if (score <= 3) return { score: 2, text: 'Medium', color: '#F59E0B' };
    return { score: 3, text: 'Strong', color: '#10B981' };
  };

  const strength = getPasswordStrength();

  const handlePhoneChange = (text) => {
    const cleaned = text.replace(/\D/g, '').slice(0, 8);
    if (cleaned.length > 4) {
      setPhone(`${cleaned.slice(0, 4)} ${cleaned.slice(4, 8)}`);
    } else {
      setPhone(cleaned);
    }
  };

  const handleContinue = () => {
    if (!phone || phone.replace(/\s/g, '').length < 8) {
      Alert.alert('Incomplete Phone Number', 'Please enter a valid 8-digit Qatar mobile number.');
      return;
    }
    if (!email || !email.includes('@')) {
      Alert.alert('Incomplete Email', 'Please enter a valid email address.');
      return;
    }
    if (!password || password.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters.');
      return;
    }

    // Navigate to Identity / KYC Verification
    if (navigation?.navigate) {
      navigation.navigate('KYCVerification', {
        user: {
          fullName,
          email,
          phone: `+974 ${phone}`,
          qid,
          nationality,
        },
      });
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation?.goBack && navigation.goBack()}
          style={styles.headerBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={22} color="#083B2D" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>AfriSend</Text>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => navigation?.navigate && navigation.navigate('HelpSupport')}
          activeOpacity={0.7}
        >
          <Ionicons name="help-circle-outline" size={22} color="#084C38" />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Top Title & Step Indicator */}
          <View style={styles.topSection}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>Step 1 of 2 • Account Creation</Text>
            </View>
            <Text style={styles.title}>{t('createAccount') || 'Create Free Account'}</Text>
            <Text style={styles.subtitle}>
              {t('createAccountSubtitle') ||
                'Open your verified Qatar multi-currency remittance wallet in under 2 minutes.'}
            </Text>
          </View>

          {/* Registration Form Card */}
          <View style={styles.card}>
            {/* Full Legal Name */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t('fullName') || 'Full Legal Name'}</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="person-outline" size={18} color="#084C38" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Full name exactly as on your QID"
                  placeholderTextColor="#94A3B8"
                  value={fullName}
                  onChangeText={setFullName}
                />
              </View>
            </View>

            {/* Qatar Mobile Number */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t('phoneNumber') || 'Qatar Mobile Number'}</Text>
              <View style={styles.phoneRow}>
                <View style={styles.countryCodeBadge}>
                  <Text style={styles.flagEmoji}>🇶🇦</Text>
                  <Text style={styles.countryCodeText}>+974</Text>
                </View>
                <View style={styles.phoneInputWrapper}>
                  <TextInput
                    style={styles.phoneInput}
                    placeholder="3300 0000"
                    placeholderTextColor="#94A3B8"
                    keyboardType="phone-pad"
                    maxLength={9}
                    value={phone}
                    onChangeText={handlePhoneChange}
                  />
                </View>
              </View>
            </View>

            {/* Email Address */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t('email') || 'Email Address'}</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="mail-outline" size={18} color="#084C38" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="name@example.com"
                  placeholderTextColor="#94A3B8"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={setEmail}
                />
              </View>
            </View>

            {/* Password */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t('password') || 'Create Password'}</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={18} color="#084C38" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="8+ characters with a symbol"
                  placeholderTextColor="#94A3B8"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={{ padding: 4 }}>
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color="#64748B"
                  />
                </TouchableOpacity>
              </View>

              {/* Password Strength Meter */}
              {password.length > 0 && (
                <View style={styles.strengthMeterContainer}>
                  <View style={styles.strengthBarsRow}>
                    <View
                      style={[
                        styles.strengthBar,
                        { backgroundColor: strength.score >= 1 ? strength.color : '#E2E8F0' },
                      ]}
                    />
                    <View
                      style={[
                        styles.strengthBar,
                        { backgroundColor: strength.score >= 2 ? strength.color : '#E2E8F0' },
                      ]}
                    />
                    <View
                      style={[
                        styles.strengthBar,
                        { backgroundColor: strength.score >= 3 ? strength.color : '#E2E8F0' },
                      ]}
                    />
                  </View>
                  <Text style={[styles.strengthText, { color: strength.color }]}>
                    {strength.text} Password
                  </Text>
                </View>
              )}
            </View>

            {/* Qatar ID (QID) Number */}
            <View style={styles.inputGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>{t('qidNumber') || 'Qatar ID (QID) Number'}</Text>
                <Text style={styles.qidHint}>11 Digits</Text>
              </View>
              <View style={styles.inputWrapper}>
                <MaterialIcons name="badge" size={18} color="#084C38" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="29400000000"
                  placeholderTextColor="#94A3B8"
                  keyboardType="numeric"
                  maxLength={11}
                  value={qid}
                  onChangeText={setQid}
                />
              </View>
            </View>

            {/* Terms Agreement Checkbox */}
            <TouchableOpacity
              style={styles.termsAgreementRow}
              onPress={() => setAgreedToTerms(!agreedToTerms)}
              activeOpacity={0.8}
            >
              <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
                {agreedToTerms && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
              </View>
              <Text style={styles.termsText}>
                I agree to AfriSend's{' '}
                <Text style={styles.termsLink}>Terms of Service</Text> and{' '}
                <Text style={styles.termsLink}>Privacy Policy</Text> as regulated by Qatar Central Bank.
              </Text>
            </TouchableOpacity>

            {/* Submit / Proceed Button */}
            <TouchableOpacity
              style={[styles.button, (!agreedToTerms || !email || !password) && styles.buttonDisabled]}
              disabled={!agreedToTerms || !email || !password}
              onPress={handleContinue}
              activeOpacity={0.85}
            >
              <Text style={styles.buttonText}>{t('continue') || 'Continue to Verification'}</Text>
              <Ionicons name="arrow-forward" size={18} color="#FFFFFF" style={{ marginLeft: 8 }} />
            </TouchableOpacity>

            {/* Already Have Account Log In Link */}
            <View style={styles.loginPrompt}>
              <Text style={styles.loginText}>{t('alreadyHaveAccount') || 'Already have an account?'} </Text>
              <TouchableOpacity onPress={() => navigation?.navigate && navigation.navigate('Login')}>
                <Text style={styles.loginLink}>{t('login') || 'Log In'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Regulatory Trust Seal Footer */}
          <View style={styles.footerWrap}>
            <View style={styles.footerDivider}>
              <View style={styles.footerLine} />
              <Text style={styles.footerBrandText}>TRUSTED REMITTANCES FROM QATAR</Text>
              <View style={styles.footerLine} />
            </View>
            <View style={styles.footerIcons}>
              <MaterialIcons name="shield" size={16} color="#94A3B8" />
              <Text style={styles.footerIconText}>QCB Regulated</Text>
              <Text style={styles.footerDot}>•</Text>
              <MaterialCommunityIcons name="lock-check" size={16} color="#94A3B8" />
              <Text style={styles.footerIconText}>256-Bit SSL</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F0FAF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: GREEN,
    letterSpacing: -0.3,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 36,
  },
  topSection: {
    marginBottom: 18,
  },
  stepBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#E6F6ED',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 8,
  },
  stepBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#084C38',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#083B2D',
    letterSpacing: -0.4,
  },
  subtitle: {
    color: '#64748B',
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 20,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  inputGroup: {
    marginBottom: 14,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#083B2D',
    marginBottom: 6,
  },
  qidHint: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    height: 50,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: '600',
    color: '#0F172A',
    paddingVertical: 0,
  },
  phoneRow: {
    flexDirection: 'row',
    gap: 8,
  },
  countryCodeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 10,
    height: 50,
    gap: 4,
  },
  flagEmoji: {
    fontSize: 18,
  },
  countryCodeText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  phoneInputWrapper: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 50,
    justifyContent: 'center',
  },
  phoneInput: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  strengthMeterContainer: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  strengthBarsRow: {
    flexDirection: 'row',
    gap: 4,
    flex: 1,
    marginRight: 10,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  strengthText: {
    fontSize: 11,
    fontWeight: '700',
  },
  termsAgreementRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
    marginBottom: 18,
    gap: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: '#084C38',
    borderColor: '#084C38',
  },
  termsText: {
    flex: 1,
    fontSize: 12,
    color: '#475569',
    lineHeight: 17,
  },
  termsLink: {
    fontWeight: '700',
    color: '#084C38',
  },
  button: {
    backgroundColor: '#084C38',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 14,
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    backgroundColor: '#94A3B8',
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15.5,
    fontWeight: '700',
  },
  loginPrompt: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
  loginText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
  },
  loginLink: {
    color: ORANGE,
    fontWeight: '700',
    fontSize: 13,
  },
  footerWrap: {
    alignItems: 'center',
    marginTop: 24,
  },
  footerDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 10,
  },
  footerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  footerBrandText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginHorizontal: 10,
  },
  footerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerIconText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  footerDot: {
    color: '#CBD5E1',
  },
});
