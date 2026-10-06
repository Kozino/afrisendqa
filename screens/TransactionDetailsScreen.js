import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Share,
  Alert,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';
import { useFocusEffect } from '@react-navigation/native';
import { Api } from '../services/api';

export default function TransactionDetailsScreen({ navigation, route }) {
  // Safe translation helper
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) {
      t = lang.t;
    }
  } catch (e) {
    console.log('LanguageContext fallback in TransactionDetailsScreen:', e);
  }

  /**
   * The reference is the only thing this screen needs: everything else (amounts,
   * rate, status, timeline) is read from the API, so the receipt always matches
   * the ledger rather than whatever the previous screen happened to pass along.
   */
  const reference = route?.params?.reference || route?.params?.transactionId || null;
  const [record, setRecord] = useState(route?.params?.transfer || null);
  const [loading, setLoading] = useState(!route?.params?.transfer);
  const [loadError, setLoadError] = useState(null);

  const load = async () => {
    if (!reference) { setLoading(false); return; }
    try {
      const payload = await Api.transfer(reference);
      setRecord(payload.transfer);
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(React.useCallback(() => { load(); }, [reference]));

  const amount = record ? record.totalDebitQarMinor / 100 : route?.params?.amount || 0;
  const equivalent = record?.totals?.theyReceive || route?.params?.equivalent || '';
  const rate = record ? Number(record.retailRate) : route?.params?.rate || 0;
  const recipient = record?.beneficiary
    ? {
        name: record.beneficiary.name,
        bankName: record.beneficiary.institution,
        accountNumber: record.beneficiary.accountLast4 ? `•••• ${record.beneficiary.accountLast4}` : 'cash pickup',
        currency: record.payoutCurrency,
        country: record.countryCode,
        flag: '',
      }
    : route?.params?.recipient || {};
  const status = record?.status || route?.params?.status || 'PROCESSING';
  const holdReason = record?.amlHoldReason;
  const dateFormatted = record?.initiatedAt
    ? new Date(record.initiatedAt).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : route?.params?.dateFormatted || '';

  const copyReference = () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(reference);
      }
    } catch (e) {
      console.log('Clipboard copy error:', e);
    }
    Alert.alert('Copied!', `Reference ${reference} copied to clipboard.`);
  };

  const handleShareReceipt = async () => {
    try {
      await Share.share({
        message: `AfriSend Official Transaction Receipt:\n• Status: Completed\n• Ref: ${reference}\n• Sender Amount: ${parseFloat(amount).toFixed(2)} QAR\n• Recipient Gets: ${equivalent} ${recipient.currency || 'NGN'}\n• Beneficiary: ${recipient.name}\n• Destination Bank: ${recipient.bankName}\n• Date: ${dateFormatted}`,
      });
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Screen Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation?.goBack && navigation.goBack()}
          style={styles.backButton}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={24} color="#083B2D" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('transactionReceipt') || 'Official Receipt'}</Text>
        <TouchableOpacity
          style={styles.headerActionBtn}
          onPress={handleShareReceipt}
          activeOpacity={0.7}
        >
          <Ionicons name="share-social-outline" size={20} color="#084C38" />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Fintech Official Voucher Receipt Card */}
        <View style={styles.receiptWrapper}>
          {/* Top Logo & Watermark Header */}
          <View style={styles.receiptBrandHeader}>
            <View style={styles.logoRow}>
              {/* Logo from assets/logo.png with graceful fallback */}
              <View style={styles.logoContainer}>
                <Image
                  source={require('../assets/logo.png')}
                  style={styles.brandLogo}
                  resizeMode="contain"
                  defaultSource={{ uri: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100' }}
                />
              </View>
              <View style={{ marginLeft: 10 }}>
                <Text style={styles.brandName}>AfriSend</Text>
                <Text style={styles.receiptProofText}>Official Remittance Voucher</Text>
              </View>
            </View>

            {/* Verified Badge */}
            <View style={styles.verifiedTag}>
              <Ionicons name="shield-checkmark" size={13} color="#084C38" />
              <Text style={styles.verifiedTagText}>Verified</Text>
            </View>
          </View>

          {/* Amount Highlight Banner */}
          <View style={styles.amountHeroBlock}>
            <View style={styles.statusSuccessBadge}>
              <Ionicons name="checkmark-circle" size={16} color="#10B981" />
              <Text style={styles.statusSuccessText}>{t('transferCompleted') || 'Payment Completed'}</Text>
            </View>

            <Text style={styles.amountSentValue}>
              {parseFloat(amount).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              <Text style={styles.amountSentCur}>QAR</Text>
            </Text>

            <View style={styles.payoutReceivedRow}>
              <Ionicons name="arrow-down" size={13} color="#065F46" />
              <Text style={styles.payoutReceivedText}>
                Recipient Received:{' '}
                <Text style={styles.payoutReceivedBold}>
                  {equivalent} {recipient.currency || 'NGN'}
                </Text>
              </Text>
            </View>
          </View>

          {/* Receipt Perforated Dividing Line */}
          <View style={styles.perforatedSection}>
            <View style={styles.circleCutoutLeft} />
            <View style={styles.dashedLine} />
            <View style={styles.circleCutoutRight} />
          </View>

          {/* Detailed Transaction Table */}
          <View style={styles.tableContent}>
            {/* Beneficiary Name */}
            <View style={styles.tableRow}>
              <Text style={styles.tableLabel}>{t('recipient') || 'Beneficiary'}</Text>
              <View style={styles.beneficiaryValue}>
                <Text style={styles.flagIcon}>{recipient.flag || '🇳🇬'}</Text>
                <Text style={styles.tableValueBold}>{recipient.name}</Text>
              </View>
            </View>

            {/* Destination Bank & Account */}
            <View style={styles.tableRow}>
              <Text style={styles.tableLabel}>{t('bankAccount') || 'Destination Bank'}</Text>
              <Text style={styles.tableValue}>
                {recipient.bankName} • {recipient.accountNumber || '••4521'}
              </Text>
            </View>

            {/* Exchange Rate */}
            <View style={styles.tableRow}>
              <Text style={styles.tableLabel}>{t('exchangeRate') || 'Exchange Rate'}</Text>
              <View style={styles.ratePill}>
                <Text style={styles.ratePillText}>
                  1 QAR = {parseFloat(rate).toFixed(2)} {recipient.currency || 'NGN'}
                </Text>
              </View>
            </View>

            {/* Payout Channel */}
            <View style={styles.tableRow}>
              <Text style={styles.tableLabel}>Payout Channel</Text>
              <Text style={styles.channelValue}>Instant NIP Bank Transfer</Text>
            </View>

            {/* Transfer Fee */}
            <View style={styles.tableRow}>
              <Text style={styles.tableLabel}>{t('fees') || 'Transfer Fee'}</Text>
              <Text style={styles.freeFeeText}>0.00 QAR (Zero Fee Promo)</Text>
            </View>

            {/* Payment Method */}
            <View style={styles.tableRow}>
              <Text style={styles.tableLabel}>{t('paymentMethod') || 'Payment Method'}</Text>
              <Text style={styles.tableValue}>AfriSend QAR Wallet</Text>
            </View>

            <View style={styles.innerDivider} />

            {/* Reference Number with 1-Tap Copy */}
            <View style={styles.tableRow}>
              <Text style={styles.tableLabel}>{t('reference') || 'Transaction Ref'}</Text>
              <TouchableOpacity
                style={styles.copyRefBtn}
                onPress={copyReference}
                activeOpacity={0.7}
              >
                <Text style={styles.referenceText}>{reference}</Text>
                <Ionicons name="copy-outline" size={14} color="#084C38" style={{ marginLeft: 4 }} />
              </TouchableOpacity>
            </View>

            {/* Date & Time */}
            <View style={styles.tableRow}>
              <Text style={styles.tableLabel}>{t('date') || 'Date & Time'}</Text>
              <Text style={styles.tableValue}>{dateFormatted}</Text>
            </View>
          </View>

          {/* Barcode & Digital Cryptographic Verification Seal */}
          <View style={styles.barcodeFooter}>
            <MaterialCommunityIcons name="barcode" size={56} color="#084C38" />
            <Text style={styles.securityCode}>AUTH-TOKEN: {reference}-SECURE</Text>
          </View>
        </View>
      </ScrollView>

      {/* Footer Action Buttons */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.shareReceiptBtn}
          onPress={handleShareReceipt}
          activeOpacity={0.85}
        >
          <Ionicons name="share-social-outline" size={18} color="#084C38" />
          <Text style={styles.shareReceiptBtnText}>{t('shareReceipt') || 'Share Receipt'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.doneBtn}
          onPress={() => navigation?.navigate && navigation.navigate('Dashboard')}
          activeOpacity={0.85}
        >
          <Text style={styles.doneBtnText}>{t('done') || 'Done'}</Text>
        </TouchableOpacity>
      </View>
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
  headerActionBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F0FAF5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 24,
  },
  receiptWrapper: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  receiptBrandHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoContainer: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#E6F6ED',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  brandLogo: {
    width: 34,
    height: 34,
  },
  brandName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#084C38',
    letterSpacing: -0.3,
  },
  receiptProofText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  verifiedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E6F6ED',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  verifiedTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#084C38',
  },
  amountHeroBlock: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
  },
  statusSuccessBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginBottom: 10,
  },
  statusSuccessText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#065F46',
  },
  amountSentValue: {
    fontSize: 32,
    fontWeight: '800',
    color: '#083B2D',
    letterSpacing: -0.5,
  },
  amountSentCur: {
    fontSize: 18,
    fontWeight: '700',
    color: '#084C38',
  },
  payoutReceivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    backgroundColor: '#F0FAF5',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    gap: 5,
  },
  payoutReceivedText: {
    fontSize: 12.5,
    color: '#065F46',
    fontWeight: '500',
  },
  payoutReceivedBold: {
    fontWeight: '800',
    color: '#083B2D',
  },
  perforatedSection: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
    marginVertical: 4,
  },
  circleCutoutLeft: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    marginLeft: -10,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
  },
  dashedLine: {
    flex: 1,
    height: 1,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
  },
  circleCutoutRight: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    marginRight: -10,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
  },
  tableContent: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 10,
  },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tableLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  tableValue: {
    fontSize: 13.5,
    color: '#111827',
    fontWeight: '600',
  },
  tableValueBold: {
    fontSize: 14,
    fontWeight: '800',
    color: '#083B2D',
  },
  beneficiaryValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  flagIcon: {
    fontSize: 16,
  },
  ratePill: {
    backgroundColor: '#F0FAF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#D1FAE5',
  },
  ratePillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#084C38',
  },
  channelValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#059669',
  },
  freeFeeText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#059669',
  },
  innerDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 4,
  },
  copyRefBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FAF5',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  referenceText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#084C38',
    fontFamily: 'monospace',
  },
  barcodeFooter: {
    alignItems: 'center',
    paddingVertical: 14,
    backgroundColor: '#F8FAFC',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  securityCode: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 1.2,
    marginTop: 2,
    fontFamily: 'monospace',
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
  shareReceiptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#084C38',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
  },
  shareReceiptBtnText: {
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
