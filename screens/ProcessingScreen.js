import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Animated,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';
import { Api, idempotencyKey } from '../services/api';
import { useWallet } from '../WalletContext';

export default function ProcessingScreen({ navigation, route }) {
  // Safe translation helper
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) {
      t = lang.t;
    }
  } catch (e) {
    console.log('LanguageContext fallback in ProcessingScreen:', e);
  }

  // Pass-through transaction payload from ReviewTransfer
  const transferData = route?.params || {};
  const { refresh: refreshWallet } = useWallet();

  // Dynamic progress steps
  const [stepIndex, setStepIndex] = useState(0);
  const steps = [
    t('securingConnection') || 'Securing Flutterwave banking gateway...',
    t('debitingWallet') || 'Debiting AfriSend wallet balance...',
    t('disbursingFunds') || 'Executing instant payout to African beneficiary...',
  ];

  // Pulse animation for loader rings
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Start pulsing animation
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();

    // Step message intervals
    const step1 = setTimeout(() => setStepIndex(1), 1000);
    const step2 = setTimeout(() => setStepIndex(2), 2000);

    /**
     * Create the transfer on the server.
     *
     * The server prices nothing here — it books the quote the customer already
     * saw, verifies the PIN, runs the AML rules and posts the ledger journals.
     * The payout itself is dispatched server-side (and confirmed by webhook),
     * so this screen never talks to a payment provider.
     *
     * The idempotency key is generated once per attempt: if the customer taps
     * again or the network retries, the same transfer is returned instead of a
     * second one being created.
     */
    const submitTransfer = async () => {
      const key = transferData.idempotencyKey || idempotencyKey('afrisend');
      try {
        const payload = await Api.createTransfer({
          quoteId: transferData.quoteId,
          beneficiaryId: transferData.beneficiary?.id || transferData.recipient?.id,
          pin: transferData.pin,
          purposeCode: transferData.purposeCode || 'FAMILY_SUPPORT',
          purposeNarrative: transferData.purposeNarrative,
          key,
        });
        if (refreshWallet) refreshWallet({ quiet: true }).catch(() => {});
        if (navigation?.replace) {
          navigation.replace('TransferSuccess', {
            ...transferData,
            idempotencyKey: key,
            transfer: payload.transfer,
            status: payload.transfer?.status,
            message: payload.message,
          });
        }
      } catch (err) {
        if (navigation?.replace) {
          navigation.replace('VerificationFailed', { reason: err.message, canRetry: true });
        }
      }
    };

    const payoutTimer = setTimeout(() => {
      submitTransfer();
    }, 2600);

    return () => {
      animation.stop();
      clearTimeout(step1);
      clearTimeout(step2);
      clearTimeout(payoutTimer);
    };
  }, [navigation, pulseAnim, transferData]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Main Processing Center */}
      <View style={styles.content}>
        {/* Animated Concentric Pulse Rings & Spinner */}
        <View style={styles.loaderWrapper}>
          <Animated.View
            style={[
              styles.pulseCircleOuter,
              { transform: [{ scale: pulseAnim }] },
            ]}
          />
          <View style={styles.pulseCircleMiddle} />
          <View style={styles.spinnerContainer}>
            <ActivityIndicator size="large" color="#084C38" />
          </View>
        </View>

        {/* Status Headings */}
        <Text style={styles.title}>{t('processing') || 'Processing Remittance'}</Text>
        <Text style={styles.subtitle}>
          {t('processingSubtitle') ||
            'Connecting to Flutterwave banking switches. Please do not close the app.'}
        </Text>

        {/* Real-time Step Progress Card */}
        <View style={styles.stepCard}>
          <View style={styles.stepRow}>
            <Ionicons name="sync-outline" size={16} color="#084C38" style={styles.stepIcon} />
            <Text style={styles.stepText}>{steps[stepIndex]}</Text>
          </View>
          {/* Progress Bar Indicator */}
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                { width: stepIndex === 0 ? '35%' : stepIndex === 1 ? '70%' : '95%' },
              ]}
            />
          </View>
        </View>
      </View>

      {/* Security & Do-Not-Close Notice */}
      <View style={styles.footerNotice}>
        <View style={styles.securityBadge}>
          <Ionicons name="lock-closed" size={14} color="#084C38" />
          <Text style={styles.securityText}>Flutterwave v3 Bank-Grade Rails</Text>
        </View>
        <Text style={styles.warningText}>
          Transactions are processed in real-time under Qatar Central Bank encryption.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 24,
    marginTop: 'auto',
    marginBottom: 'auto',
    width: '100%',
  },
  loaderWrapper: {
    width: 140,
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 36,
    position: 'relative',
  },
  pulseCircleOuter: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#E6F6ED',
    opacity: 0.6,
  },
  pulseCircleMiddle: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#D1FAE5',
    opacity: 0.8,
  },
  spinnerContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#083B2D',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  subtitle: {
    color: '#64748B',
    textAlign: 'center',
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 12,
    fontWeight: '400',
  },
  stepCard: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 16,
    marginTop: 28,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  stepIcon: {
    marginRight: 8,
  },
  stepText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#083B2D',
    flex: 1,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#084C38',
    borderRadius: 3,
  },
  footerNotice: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 28,
    width: '100%',
  },
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E6F6ED',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
    marginBottom: 8,
  },
  securityText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#084C38',
  },
  warningText: {
    fontSize: 11.5,
    color: '#94A3B8',
    textAlign: 'center',
    fontWeight: '500',
  },
});
