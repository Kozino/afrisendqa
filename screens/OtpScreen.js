import React, { useState, useRef, useEffect } from 'react';
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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';

export default function OtpScreen({ navigation, route }) {
  // Safe translation helper
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) {
      t = lang.t;
    }
  } catch (e) {
    console.log('LanguageContext fallback in OtpScreen:', e);
  }

  const amount = route?.params?.amount || 500;
  const phoneNumber = route?.params?.phoneNumber || '+974 •••• 8842';
  
  const [otp, setOtp] = useState(['', '', '', '']);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [countdown, setCountdown] = useState(45);
  const [canResend, setCanResend] = useState(false);

  const inputs = useRef([]);

  // Resend Countdown Timer
  useEffect(() => {
    let timer;
    if (countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
    } else {
      setCanResend(true);
    }
    return () => clearInterval(timer);
  }, [countdown]);

  const handleOtpChange = (text, index) => {
    // Support auto-paste of 4-digit SMS OTP
    if (text.length > 1) {
      const pastedDigits = text.replace(/\D/g, '').slice(0, 4).split('');
      const newOtp = [...otp];
      pastedDigits.forEach((digit, i) => {
        if (i < 4) newOtp[i] = digit;
      });
      setOtp(newOtp);
      const nextFocus = Math.min(pastedDigits.length, 3);
      inputs.current[nextFocus]?.focus();
      return;
    }

    const cleaned = text.replace(/\D/g, '');
    const newOtp = [...otp];
    newOtp[index] = cleaned;
    setOtp(newOtp);

    // Auto-advance to next box
    if (cleaned && index < 3) {
      inputs.current[index + 1]?.focus();
      setFocusedIndex(index + 1);
    }
  };

  const handleKeyPress = (e, index) => {
    // Auto-backspace to previous input
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      inputs.current[index - 1]?.focus();
      setFocusedIndex(index - 1);
    }
  };

  const handleResendCode = () => {
    if (!canResend) return;
    setCountdown(45);
    setCanResend(false);
    setOtp(['', '', '', '']);
    inputs.current[0]?.focus();
    setFocusedIndex(0);
    Alert.alert('Code Resent!', `A new 4-digit verification code has been sent to ${phoneNumber}`);
  };

  const handleVerify = () => {
    const enteredCode = otp.join('');
    if (enteredCode.length < 4) {
      Alert.alert('Incomplete Code', 'Please enter the complete 4-digit verification code.');
      return;
    }

    // Auto-proceed to FundSuccess with amount & transaction metadata
    if (navigation?.navigate) {
      navigation.navigate('FundSuccess', {
        amount: parseFloat(amount),
        paymentMethod: route?.params?.paymentMethod || 'QNB Bank / Card',
        transactionId: 'DEP-' + Math.floor(10000000 + Math.random() * 90000000),
      });
    }
  };

  const isComplete = otp.every((digit) => digit !== '');

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Screen Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation?.goBack && navigation.goBack()}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={24} color="#083B2D" />
        </TouchableOpacity>
        <View style={styles.secureHeaderPill}>
          <Ionicons name="shield-checkmark" size={13} color="#084C38" />
          <Text style={styles.secureHeaderText}>3D Secure 2.0</Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Security Shield Hero Icon */}
          <View style={styles.heroSection}>
            <View style={styles.shieldIconOuter}>
              <View style={styles.shieldIconInner}>
                <MaterialCommunityIcons name="shield-lock" size={36} color="#084C38" />
              </View>
            </View>
            <Text style={styles.title}>{t('enterOtp') || 'Enter Verification Code'}</Text>
            <Text style={styles.subtitle}>
              {t('otpSubtitle') || 'We have sent a 4-digit authorization code via SMS to'}
            </Text>
            <Text style={styles.phoneHighlight}>{phoneNumber}</Text>
          </View>

          {/* Authorization Amount Context Badge */}
          <View style={styles.amountContextBadge}>
            <Text style={styles.amountContextLabel}>Authorizing Transaction</Text>
            <Text style={styles.amountContextValue}>
              {parseFloat(amount).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              <Text style={styles.amountContextCur}>QAR</Text>
            </Text>
          </View>

          {/* Industrial Standard 4-Digit PIN Boxes */}
          <View style={styles.otpContainer}>
            {otp.map((digit, index) => {
              const isFocused = focusedIndex === index;
              const isFilled = digit !== '';
              return (
                <View
                  key={index}
                  style={[
                    styles.otpBoxWrapper,
                    isFocused && styles.otpBoxFocused,
                    isFilled && styles.otpBoxFilled,
                  ]}
                >
                  <TextInput
                    ref={(ref) => (inputs.current[index] = ref)}
                    style={styles.otpInput}
                    keyboardType="number-pad"
                    maxLength={1}
                    value={digit}
                    onFocus={() => setFocusedIndex(index)}
                    onChangeText={(text) => handleOtpChange(text, index)}
                    onKeyPress={(e) => handleKeyPress(e, index)}
                    selectionColor="#084C38"
                    autoFocus={index === 0}
                  />
                  {!digit && isFocused && <View style={styles.cursorIndicator} />}
                </View>
              );
            })}
          </View>

          {/* Resend Code Section */}
          <View style={styles.resendSection}>
            {canResend ? (
              <TouchableOpacity
                style={styles.resendActiveBtn}
                onPress={handleResendCode}
                activeOpacity={0.7}
              >
                <Ionicons name="refresh-outline" size={16} color="#084C38" />
                <Text style={styles.resendActiveText}>{t('resendCode') || 'Resend Code via SMS'}</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.resendCountdownRow}>
                <Ionicons name="time-outline" size={14} color="#64748B" />
                <Text style={styles.resendCountdownText}>
                  Resend code in{' '}
                  <Text style={styles.countdownBold}>
                    00:{countdown < 10 ? `0${countdown}` : countdown}
                  </Text>
                </Text>
              </View>
            )}
          </View>

          {/* Security Advisory */}
          <View style={styles.securityWarningCard}>
            <Ionicons name="information-circle-outline" size={16} color="#64748B" />
            <Text style={styles.securityWarningText}>
              Never share your one-time code with anyone. AfriSend staff will never ask for your verification code.
            </Text>
          </View>
        </ScrollView>

        {/* Footer Action */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.button, !isComplete && styles.buttonDisabled]}
            disabled={!isComplete}
            onPress={handleVerify}
            activeOpacity={0.85}
          >
            <Text style={styles.buttonText}>{t('verify') || 'Verify & Complete'}</Text>
            <Ionicons name="arrow-forward" size={18} color="#FFFFFF" style={styles.btnIcon} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F0FAF5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  secureHeaderPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E6F6ED',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    gap: 4,
  },
  secureHeaderText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#084C38',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 24,
    alignItems: 'center',
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: 18,
    width: '100%',
  },
  shieldIconOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#E6F6ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  shieldIconInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#083B2D',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subtitle: {
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: '400',
  },
  phoneHighlight: {
    fontSize: 14,
    fontWeight: '700',
    color: '#084C38',
    marginTop: 2,
  },
  amountContextBadge: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    backgroundColor: '#F0FAF5',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 24,
  },
  amountContextLabel: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#065F46',
  },
  amountContextValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#083B2D',
  },
  amountContextCur: {
    fontSize: 12,
    fontWeight: '700',
    color: '#047857',
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: 300,
    marginBottom: 24,
  },
  otpBoxWrapper: {
    width: 62,
    height: 66,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  otpBoxFocused: {
    borderColor: '#084C38',
    backgroundColor: '#FFFFFF',
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  otpBoxFilled: {
    borderColor: '#084C38',
    backgroundColor: '#FFFFFF',
  },
  otpInput: {
    width: '100%',
    height: '100%',
    textAlign: 'center',
    fontSize: 26,
    fontWeight: '800',
    color: '#083B2D',
    padding: 0,
  },
  cursorIndicator: {
    position: 'absolute',
    bottom: 12,
    width: 14,
    height: 2,
    backgroundColor: '#084C38',
    borderRadius: 1,
  },
  resendSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  resendActiveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0FAF5',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  resendActiveText: {
    color: '#084C38',
    fontSize: 13,
    fontWeight: '700',
  },
  resendCountdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  resendCountdownText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  countdownBold: {
    fontWeight: '700',
    color: '#083B2D',
  },
  securityWarningCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    width: '100%',
  },
  securityWarningText: {
    flex: 1,
    fontSize: 11.5,
    color: '#64748B',
    lineHeight: 16,
    fontWeight: '500',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  button: {
    backgroundColor: '#084C38',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
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
    fontSize: 16,
    fontWeight: '700',
  },
  btnIcon: {
    marginLeft: 8,
  },
});
