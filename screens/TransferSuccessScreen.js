import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Share,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';

export default function TransferSuccessScreen({ navigation, route }) {
  // Translation hook
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) {
      t = lang.t;
    }
  } catch (e) {
    console.log('LanguageContext fallback in TransferSuccessScreen:', e);
  }

  // Extract transaction details passed through ProcessingScreen
  const amount = route?.params?.amount || 500;
  const equivalent = route?.params?.equivalent || '210,530.00';
  const recipient = route?.params?.recipient || {
    name: 'Recipient',
    bankName: 'Access Bank Nigeria',
    accountNumber: '•••• 7890',
    currency: 'NGN',
    flag: '🇳🇬',
  };
  const transactionId = route?.params?.transactionId || 'TRX-88492014';
  const dateFormatted = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const copyTransactionId = () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(transactionId);
      }
    } catch (e) {
      console.log('Clipboard copy error:', e);
    }
    Alert.alert('Copied!', `Transaction Reference ${transactionId} copied to clipboard.`);
  };

  const handleShareReceipt = async () => {
    try {
      await Share.share({
        message: `AfriSend Transfer Receipt:\n• Status: Completed\n• Recipient: ${recipient.name}\n• Amount Received: ${equivalent} ${recipient.currency || 'NGN'}\n• Amount Sent: ${amount} QAR\n• Transaction ID: ${transactionId}\n• Date: ${dateFormatted}`,
      });
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Header */}
      <View style={styles.header}>
        <View style={{ width: 38 }} />
        <Text style={styles.headerTitle}>{t('transferReceipt') || 'Transfer Success'}</Text>
        <TouchableOpacity
          style={styles.shareIconBtn}
          onPress={handleShareReceipt}
          activeOpacity={0.7}
        >
          <Ionicons name="share-social-outline" size={22} color="#084C38" />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Celebration Success Hero */}
        <View style={styles.heroSection}>
          <View style={styles.iconOuterRing}>
            <View style={styles.iconInnerCircle}>
              <Ionicons name="checkmark" size={48} color="#FFFFFF" />
            </View>
          </View>
          <Text style={styles.title}>{t('transferSuccess') || 'Transfer Successful!'}</Text>
          <Text style={styles.subtitle}>
            {t('transferSuccessDesc') ||
              `Your payout of ${equivalent} ${recipient.currency || 'NGN'} has been delivered instantly.`}
          </Text>
        </View>

        {/* Amount Banner Card */}
        <View style={styles.amountBanner}>
          <Text style={styles.amountBannerLabel}>{t('amountDelivered') || 'Delivered to Recipient'}</Text>
          <Text style={styles.amountBannerValue}>
            {equivalent} <Text style={styles.amountBannerCur}>{recipient.currency || 'NGN'}</Text>
          </Text>
          <View style={styles.sourceDebitRow}>
            <Text style={styles.sourceDebitText}>
              Debited from Wallet: <Text style={styles.boldText}>{parseFloat(amount).toFixed(2)} QAR</Text>
            </Text>
          </View>
        </View>

        {/* Digital Receipt Card */}
        <View style={styles.receiptCard}>
          {/* Card Title & Status Badge */}
          <View style={styles.receiptHeader}>
            <Text style={styles.receiptTitle}>{t('transactionDetails') || 'Payment Receipt'}</Text>
            <View style={styles.statusPill}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>{t('completed') || 'Completed'}</Text>
            </View>
          </View>

          {/* Row: Beneficiary */}
          <View style={styles.row}>
            <Text style={styles.label}>{t('recipient') || 'Recipient'}</Text>
            <View style={styles.recipientBadge}>
              <Text style={styles.flagText}>{recipient.flag || '🇳🇬'}</Text>
              <Text style={styles.valueBold}>{recipient.name}</Text>
            </View>
          </View>

          {/* Row: Bank & Account */}
          <View style={styles.row}>
            <Text style={styles.label}>{t('destination') || 'Destination Bank'}</Text>
            <Text style={styles.value}>
              {recipient.bankName} ({recipient.accountNumber || '•••• 7890'})
            </Text>
          </View>

          <View style={styles.divider} />

          {/* Row: Reference / Transaction ID with 1-Tap Copy */}
          <View style={styles.row}>
            <Text style={styles.label}>{t('transactionId') || 'Reference ID'}</Text>
            <TouchableOpacity
              style={styles.copyIdRow}
              onPress={copyTransactionId}
              activeOpacity={0.7}
            >
              <Text style={styles.valueMono}>{transactionId}</Text>
              <Ionicons name="copy-outline" size={15} color="#084C38" style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          </View>

          {/* Row: Date & Time */}
          <View style={styles.row}>
            <Text style={styles.label}>{t('date') || 'Date & Time'}</Text>
            <Text style={styles.value}>{dateFormatted}</Text>
          </View>

          {/* Row: Payment Method */}
          <View style={styles.row}>
            <Text style={styles.label}>{t('paymentMethod') || 'Payment Method'}</Text>
            <Text style={styles.value}>AfriSend Wallet (QAR)</Text>
          </View>

          {/* Row: Transfer Fee */}
          <View style={styles.row}>
            <Text style={styles.label}>{t('transferFee') || 'Transfer Fee'}</Text>
            <Text style={styles.freeText}>0.00 QAR (FREE)</Text>
          </View>
        </View>

        {/* Support Guarantee Notice */}
        <View style={styles.supportNote}>
          <MaterialCommunityIcons name="shield-check" size={18} color="#084C38" />
          <Text style={styles.supportText}>
            A receipt has been sent to your registered email address.
          </Text>
        </View>
      </ScrollView>

      {/* Footer Actions */}
      <View style={styles.footer}>
        {/* View Receipt / Transaction Details Button */}
        <TouchableOpacity
          style={styles.receiptBtn}
          onPress={() =>
            navigation?.navigate &&
            navigation.navigate('TransactionDetails', {
              amount,
              equivalent,
              recipient,
              transactionId,
              dateFormatted,
            })
          }
          activeOpacity={0.8}
        >
          <MaterialIcons name="receipt-long" size={20} color="#084C38" />
          <Text style={styles.receiptBtnText}>{t('viewReceipt') || 'View Full Receipt'}</Text>
        </TouchableOpacity>

        {/* Primary Done Button */}
        <TouchableOpacity
          style={styles.doneBtn}
          onPress={() => navigation?.navigate && navigation.navigate('Dashboard')}
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
  shareIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F0FAF5',
    justifyContent: 'center',
    alignItems: 'center',
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
    fontSize: 24,
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
    paddingHorizontal: 16,
    fontWeight: '400',
  },
  amountBanner: {
    backgroundColor: '#F0FAF5',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 18,
  },
  amountBannerLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#065F46',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  amountBannerValue: {
    fontSize: 30,
    fontWeight: '800',
    color: '#084C38',
    letterSpacing: -0.5,
  },
  amountBannerCur: {
    fontSize: 18,
    fontWeight: '700',
    color: '#059669',
  },
  sourceDebitRow: {
    marginTop: 6,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sourceDebitText: {
    fontSize: 12,
    color: '#64748B',
  },
  boldText: {
    fontWeight: '700',
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
    fontSize: 14,
    fontWeight: '800',
  },
  valueMono: {
    color: '#084C38',
    fontSize: 13.5,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  recipientBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  flagText: {
    fontSize: 16,
  },
  copyIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FAF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  freeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#059669',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 6,
  },
  supportNote: {
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
  supportText: {
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
  },
  receiptBtn: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#084C38',
    marginBottom: 10,
    gap: 8,
  },
  receiptBtnText: {
    color: '#084C38',
    fontSize: 15,
    fontWeight: '700',
  },
  doneBtn: {
    backgroundColor: '#084C38',
    paddingVertical: 16,
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
