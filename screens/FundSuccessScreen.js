import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';
import { useWallet } from '../WalletContext';

export default function FundSuccessScreen({ navigation, route }) {
  // Translation hook
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) {
      t = lang.t;
    }
  } catch (e) {
    console.log('LanguageContext fallback in FundSuccessScreen:', e);
  }

  // Safe wallet context
  let addFunds = () => {};
  let currentBalance = 0;
  try {
    const wallet = useWallet();
    if (wallet) {
      if (wallet.addFunds) addFunds = wallet.addFunds;
      if (wallet.balance !== undefined) currentBalance = wallet.balance;
    }
  } catch (e) {
    console.log('WalletContext fallback in FundSuccessScreen:', e);
  }

  const amount = route?.params?.amount || 500;
  const paymentMethod = route?.params?.paymentMethod || 'QNB Bank Transfer';
  const newBalance = currentBalance + parseFloat(amount);
  const transactionId = route?.params?.transactionId || 'DEP-' + Math.floor(10000000 + Math.random() * 90000000);
  const dateFormatted = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleDone = () => {
    try {
      addFunds(parseFloat(amount)); // Increase wallet balance
    } catch (e) {
      console.log('addFunds error:', e);
    }

    if (navigation?.replace) {
      navigation.replace('Dashboard'); // Wipe history and return to Dashboard
    }
  };

  const handleSendNow = () => {
    try {
      addFunds(parseFloat(amount));
    } catch (e) {
      console.log('addFunds error:', e);
    }

    if (navigation?.replace) {
      navigation.replace('SendMoney');
    }
  };

  const copyRef = () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(transactionId);
      }
    } catch (e) {
      console.log('Clipboard error:', e);
    }
    Alert.alert('Copied!', `Deposit Reference ${transactionId} copied to clipboard.`);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Top Header */}
      <View style={styles.header}>
        <View style={{ width: 38 }} />
        <Text style={styles.headerTitle}>{t('fundSuccessTitle') || 'Deposit Success'}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Celebration Checkmark Hero */}
        <View style={styles.heroSection}>
          <View style={styles.iconOuterRing}>
            <View style={styles.iconInnerCircle}>
              <Ionicons name="checkmark" size={48} color="#FFFFFF" />
            </View>
          </View>
          <Text style={styles.title}>{t('fundSuccess') || 'Wallet Funded Successfully!'}</Text>
          <Text style={styles.subtitle}>
            {t('fundSuccessDesc') || 'Your funds are now available in your AfriSend wallet balance.'}
          </Text>
        </View>

        {/* Funded Amount Highlight Banner */}
        <View style={styles.amountBanner}>
          <Text style={styles.amountBannerLabel}>{t('amountDeposited') || 'AMOUNT ADDED'}</Text>
          <Text style={styles.amountBannerValue}>
            + {parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
            <Text style={styles.amountBannerCur}>QAR</Text>
          </Text>

          {/* New Live Balance Preview Pill */}
          <View style={styles.newBalancePill}>
            <Ionicons name="wallet-outline" size={14} color="#065F46" />
            <Text style={styles.newBalanceText}>
              New Balance:{' '}
              <Text style={styles.newBalanceBold}>
                {newBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} QAR
              </Text>
            </Text>
          </View>
        </View>

        {/* Deposit Summary Card */}
        <View style={styles.receiptCard}>
          <View style={styles.receiptHeader}>
            <Text style={styles.receiptTitle}>{t('depositSummary') || 'Deposit Summary'}</Text>
            <View style={styles.statusPill}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>{t('completed') || 'Instant Deposit'}</Text>
            </View>
          </View>

          {/* Row: Funding Source */}
          <View style={styles.row}>
            <Text style={styles.label}>{t('paymentMethod') || 'Funding Source'}</Text>
            <View style={styles.sourceBadge}>
              <MaterialCommunityIcons name="bank" size={14} color="#084C38" />
              <Text style={styles.valueBold}>{paymentMethod}</Text>
            </View>
          </View>

          {/* Row: Reference Number */}
          <View style={styles.row}>
            <Text style={styles.label}>{t('transactionId') || 'Reference ID'}</Text>
            <TouchableOpacity style={styles.copyBox} onPress={copyRef} activeOpacity={0.7}>
              <Text style={styles.valueMono}>{transactionId}</Text>
              <Ionicons name="copy-outline" size={14} color="#084C38" style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          </View>

          <View style={styles.divider} />

          {/* Row: Deposit Fee */}
          <View style={styles.row}>
            <Text style={styles.label}>{t('depositFee') || 'Deposit Fee'}</Text>
            <Text style={styles.freeFeeText}>0.00 QAR (FREE)</Text>
          </View>

          {/* Row: Date & Time */}
          <View style={styles.row}>
            <Text style={styles.label}>{t('date') || 'Date & Time'}</Text>
            <Text style={styles.value}>{dateFormatted}</Text>
          </View>
        </View>

        {/* Security Notice */}
        <View style={styles.securityNote}>
          <MaterialCommunityIcons name="shield-check" size={18} color="#084C38" />
          <Text style={styles.securityText}>
            Protected by Qatar Central Bank regulated payment rails.
          </Text>
        </View>
      </ScrollView>

      {/* Footer Action Buttons */}
      <View style={styles.footer}>
        {/* Send Money Direct Shortcut */}
        <TouchableOpacity
          style={styles.sendMoneyBtn}
          onPress={handleSendNow}
          activeOpacity={0.85}
        >
          <Ionicons name="paper-plane-outline" size={18} color="#084C38" />
          <Text style={styles.sendMoneyBtnText}>{t('sendMoneyNow') || 'Send Money Now'}</Text>
        </TouchableOpacity>

        {/* Done / Return to Dashboard */}
        <TouchableOpacity
          style={styles.doneBtn}
          onPress={handleDone}
          activeOpacity={0.85}
        >
          <Text style={styles.doneBtnText}>{t('done') || 'Back to Home'}</Text>
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
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#083B2D',
    letterSpacing: -0.3,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  iconOuterRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#E6F6ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconInnerCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#084C38',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5,
  },
  title: {
    fontSize: 23,
    fontWeight: '800',
    color: '#083B2D',
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  subtitle: {
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
    fontSize: 13.5,
    lineHeight: 20,
    paddingHorizontal: 14,
    fontWeight: '400',
  },
  amountBanner: {
    backgroundColor: '#F0FAF5',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 18,
  },
  amountBannerLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
    letterSpacing: 1.1,
    marginBottom: 4,
  },
  amountBannerValue: {
    fontSize: 32,
    fontWeight: '800',
    color: '#084C38',
    letterSpacing: -0.5,
  },
  amountBannerCur: {
    fontSize: 18,
    fontWeight: '700',
    color: '#059669',
  },
  newBalancePill: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    gap: 6,
  },
  newBalanceText: {
    fontSize: 12.5,
    color: '#065F46',
    fontWeight: '500',
  },
  newBalanceBold: {
    fontWeight: '800',
    color: '#083B2D',
  },
  receiptCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    padding: 18,
    marginBottom: 16,
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  receiptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  receiptTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#083B2D',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  statusText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#065F46',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
  },
  label: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
  },
  value: {
    color: '#111827',
    fontSize: 13.5,
    fontWeight: '600',
  },
  valueBold: {
    color: '#083B2D',
    fontSize: 13.5,
    fontWeight: '800',
  },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  copyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FAF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  valueMono: {
    color: '#084C38',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  freeFeeText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#059669',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 6,
  },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  securityText: {
    fontSize: 11.5,
    color: '#64748B',
    fontWeight: '500',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    gap: 10,
  },
  sendMoneyBtn: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#084C38',
    gap: 8,
  },
  sendMoneyBtnText: {
    color: '#084C38',
    fontSize: 15,
    fontWeight: '700',
  },
  doneBtn: {
    backgroundColor: '#084C38',
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
