import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';

export default function ReviewTransferScreen({ navigation, route }) {
  // Translation helper
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) {
      t = lang.t;
    }
  } catch (e) {
    console.log('LanguageContext fallback in ReviewTransferScreen:', e);
  }

  // Quote and beneficiary passed from SendMoneyScreen (server-priced).
  const quote = route?.params?.quote || null;
  const quoteId = route?.params?.quoteId || quote?.id || null;
  const beneficiary = route?.params?.beneficiary || route?.params?.recipient || null;
  const amount = route?.params?.amount || 500;
  const rate = route?.params?.rate || 421.06;
  const fee = route?.params?.fee !== undefined ? route?.params?.fee : 0.0;
  const equivalent =
    route?.params?.equivalent ||
    (parseFloat(amount) * rate).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const recipient = beneficiary || route?.params?.recipient || {
    name: 'Recipient',
    bankName: 'Access Bank Nigeria',
    accountNumber: '•••• 7890',
    currency: 'NGN',
    country: 'Nigeria',
    flag: '🇳🇬',
  };

  const totalDebit = route?.params?.totalDebit || (parseFloat(amount) + parseFloat(fee)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  /**
   * The transaction PIN is verified server-side; it is never stored on the
   * device and never sent anywhere except our own API over TLS.
   */
  const handleConfirm = () => {
    if (!quoteId) {
      Alert.alert('Quote missing', 'Please go back and re-price this transfer.');
      return;
    }
    if (!beneficiary || !beneficiary.id) {
      Alert.alert('Recipient missing', 'Choose a recipient before confirming.');
      return;
    }
    Alert.prompt &&
      Platform.OS === 'ios' &&
      Alert.prompt('Authorise transfer', 'Enter your 6-digit transaction PIN', (pin) => {
        if (/^\d{6}$/.test(pin || '')) goToProcessing(pin);
      }, 'secure-text', '', 'number-pad');

    if (Platform.OS !== 'ios') {
      // Android/Expo Go: PIN entry lives in the Processing screen's secure prompt
      // if you prefer; here we simply forward without a PIN so the user can set
      // one in Settings → Security, and the API responds with a clear error.
      goToProcessing(null);
    }
  };

  const goToProcessing = (pin) => {
    if (!navigation?.navigate) return;
    navigation.navigate('Processing', {
      quoteId,
      quote,
      beneficiary,
      amount,
      equivalent,
      rate,
      fee,
      pin,
      purposeCode: route?.params?.purposeCode || 'FAMILY_SUPPORT',
      recipient,
      totalDebit,
      reference: quote?.reference,
      timestamp: new Date().toISOString(),
    });
  };

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
        <Text style={styles.headerTitle}>{t('reviewTransfer') || 'Review Transfer'}</Text>
        <View style={styles.secureHeaderBadge}>
          <Ionicons name="lock-closed" size={13} color="#084C38" />
          <Text style={styles.secureHeaderText}>Secure</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Payout Hero Card */}
        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>
            {(t('recipientGets') || 'RECIPIENT RECEIVES').toUpperCase()}
          </Text>
          <View style={styles.heroAmountRow}>
            <Text style={styles.heroAmount}>{equivalent}</Text>
            <Text style={styles.heroCurrency}> {recipient.currency || 'NGN'}</Text>
          </View>
          <View style={styles.instantTag}>
            <Ionicons name="flash" size={13} color="#A7F3D0" />
            <Text style={styles.instantTagText}>Guaranteed Instant Payout</Text>
          </View>
        </View>

        {/* Recipient Profile Card */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionHeaderTitle}>
            {t('recipientDetails') || 'Recipient Details'}
          </Text>
          <View style={styles.recipientRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {recipient.name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .toUpperCase()}
              </Text>
              <View style={styles.flagIconPill}>
                <Text style={styles.flagSmall}>{recipient.flag || '🇳🇬'}</Text>
              </View>
            </View>
            <View style={styles.recipientInfo}>
              <Text style={styles.recipientName}>{recipient.name}</Text>
              <Text style={styles.recipientBank}>
                {recipient.bankName} • {recipient.accountNumber || '•••• 7890'}
              </Text>
              <Text style={styles.recipientCountry}>
                {recipient.country || 'Nigeria'}
              </Text>
            </View>
          </View>
        </View>

        {/* Transfer Breakdown & Receipt Card */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionHeaderTitle}>
            {t('transferDetails') || 'Transfer Breakdown'}
          </Text>

          {/* Row 1: Sending Amount */}
          <View style={styles.detailRow}>
            <Text style={styles.label}>{t('sendingAmount') || 'You Send'}</Text>
            <Text style={styles.value}>
              {parseFloat(amount).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              QAR
            </Text>
          </View>

          {/* Row 2: Exchange Rate */}
          <View style={styles.detailRow}>
            <Text style={styles.label}>{t('exchangeRate') || 'Exchange Rate'}</Text>
            <View style={styles.rateBadge}>
              <Text style={styles.rateText}>
                1 QAR = {parseFloat(rate).toFixed(2)} {recipient.currency || 'NGN'}
              </Text>
            </View>
          </View>

          {/* Row 3: Transfer Fee */}
          <View style={styles.detailRow}>
            <Text style={styles.label}>{t('fees') || 'Transfer Fee'}</Text>
            {parseFloat(fee) === 0 ? (
              <View style={styles.freeFeeBadge}>
                <Text style={styles.freeFeeText}>0.00 QAR (FREE)</Text>
              </View>
            ) : (
              <Text style={styles.value}>{parseFloat(fee).toFixed(2)} QAR</Text>
            )}
          </View>

          {/* Row 4: Delivery Method */}
          <View style={styles.detailRow}>
            <Text style={styles.label}>{t('deliveryMethod') || 'Delivery Method'}</Text>
            <Text style={styles.valueHighlight}>Bank Transfer (Instant)</Text>
          </View>

          {/* Row 5: Payment Source */}
          <View style={styles.detailRow}>
            <Text style={styles.label}>{t('paymentSource') || 'Payment Source'}</Text>
            <Text style={styles.value}>AfriSend Wallet</Text>
          </View>

          <View style={styles.divider} />

          {/* Total Row */}
          <View style={styles.totalRow}>
            <View>
              <Text style={styles.totalLabel}>
                {t('totalToDebit') || 'Total to Debit'}
              </Text>
              <Text style={styles.totalSub}>Included 0.00 QAR fees</Text>
            </View>
            <Text style={styles.totalAmount}>{totalDebit} QAR</Text>
          </View>
        </View>

        {/* Security & Authorization Notice */}
        <View style={styles.authorizationNote}>
          <Ionicons name="shield-checkmark-outline" size={16} color="#64748B" />
          <Text style={styles.authorizationText}>
            By tapping Confirm & Send, you authorize AfriSend to debit {totalDebit} QAR from your wallet and execute this transfer.
          </Text>
        </View>
      </ScrollView>

      {/* Footer Confirm Action */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.confirmBtn}
          onPress={handleConfirm}
          activeOpacity={0.85}
        >
          <Text style={styles.confirmBtnText}>
            {t('confirmSend') || 'Confirm & Send Money'}
          </Text>
          <Ionicons name="arrow-forward" size={18} color="#FFFFFF" style={styles.btnIcon} />
        </TouchableOpacity>
      </View>
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
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#083B2D',
    letterSpacing: -0.3,
  },
  secureHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E6F6ED',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 4,
  },
  secureHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#084C38',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  heroCard: {
    backgroundColor: '#084C38',
    borderRadius: 22,
    paddingVertical: 22,
    paddingHorizontal: 20,
    marginBottom: 18,
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  heroLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A7F3D0',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  heroAmountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 12,
  },
  heroAmount: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  heroCurrency: {
    fontSize: 16,
    fontWeight: '700',
    color: '#D1FAE5',
    marginLeft: 4,
  },
  instantTag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 5,
  },
  instantTagText: {
    color: '#ECFDF5',
    fontSize: 11.5,
    fontWeight: '600',
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    padding: 16,
    marginBottom: 16,
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  sectionHeaderTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#083B2D',
    marginBottom: 14,
  },
  recipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E6F6ED',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginRight: 14,
  },
  avatarText: {
    color: '#084C38',
    fontSize: 18,
    fontWeight: '800',
  },
  flagIconPill: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 2,
  },
  flagSmall: {
    fontSize: 12,
  },
  recipientInfo: {
    flex: 1,
  },
  recipientName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 2,
  },
  recipientBank: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '600',
  },
  recipientCountry: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 1,
    fontWeight: '500',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
  },
  label: {
    fontSize: 13.5,
    color: '#64748B',
    fontWeight: '500',
  },
  value: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '700',
  },
  valueHighlight: {
    fontSize: 13.5,
    color: '#059669',
    fontWeight: '700',
  },
  rateBadge: {
    backgroundColor: '#F0FAF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D1FAE5',
  },
  rateText: {
    fontSize: 12.5,
    color: '#084C38',
    fontWeight: '700',
  },
  freeFeeBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  freeFeeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#059669',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 10,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#083B2D',
  },
  totalSub: {
    fontSize: 11.5,
    color: '#94A3B8',
    marginTop: 1,
  },
  totalAmount: {
    fontSize: 18,
    fontWeight: '800',
    color: '#084C38',
  },
  authorizationNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  authorizationText: {
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
  confirmBtn: {
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
  confirmBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  btnIcon: {
    marginLeft: 8,
  },
});
