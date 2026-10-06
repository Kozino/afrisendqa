import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Share,
  Alert,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';
import { useAuth } from '../AuthContext';

export default function FundViaBankScreen({ navigation, route }) {
  // Safe translation helper
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) {
      t = lang.t;
    }
  } catch (e) {
    console.log('LanguageContext fallback in FundViaBankScreen:', e);
  }

  // Account & Bank Metadata
  const walletId = '12345678';
  // The account name shown on the bank transfer instruction is the customer's
  // own verified name, so the deposit can be matched automatically.
  let accountName = 'your registered name';
  try {
    const auth = useAuth();
    if (auth && auth.customer && auth.customer.fullName) accountName = auth.customer.fullName;
  } catch (e) {
    // AuthContext unavailable — keep the generic label.
  }
  const bankName = route?.params?.method === 'doha' ? 'Doha Bank' : 'Qatar National Bank (QNB)';
  const iban = 'QA55 QNBA 0000 0000 1234 5678';
  const amount = route?.params?.amount || null;

  const [copiedField, setCopiedField] = useState(null);

  const copyToClipboard = (text, fieldName = 'Wallet ID') => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(text);
      }
    } catch (e) {
      console.log('Clipboard copy error:', e);
    }

    setCopiedField(fieldName);
    Alert.alert('Copied!', `${fieldName} has been copied to your clipboard.`);
    setTimeout(() => setCopiedField(null), 2500);
  };

  const shareDetails = async () => {
    try {
      await Share.share({
        message: `Fund my AfriSend Wallet:\n• Account Name: ${accountName}\n• Wallet ID: ${walletId}\n• Bank: ${bankName}\n• IBAN: ${iban}${
          amount ? `\n• Amount: ${amount} QAR` : ''
        }\n\nNote: Use your Wallet ID as the transfer reference.`,
      });
    } catch (error) {
      console.error(error.message);
    }
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
        <Text style={styles.headerTitle}>{t('fundViaBank') || 'Bank Transfer'}</Text>
        <View style={styles.instantBadge}>
          <Ionicons name="flash" size={13} color="#084C38" />
          <Text style={styles.instantBadgeText}>Instant</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Instruction Banner */}
        <View style={styles.instructionBanner}>
          <View style={styles.infoIconWrapper}>
            <Ionicons name="information-circle" size={22} color="#084C38" />
          </View>
          <View style={styles.instructionTextContainer}>
            <Text style={styles.instructionTitle}>
              {t('transferNoticeTitle') || 'Direct Bank Deposit'}
            </Text>
            <Text style={styles.instructionText}>
              {t('bankTransferInstruction') ||
                'Transfer funds from your banking app using the details below. Always include your Wallet ID in the reference note.'}
            </Text>
          </View>
        </View>

        {/* Deposit Voucher Card */}
        <View style={styles.voucherCard}>
          {/* Bank Brand Header */}
          <View style={styles.bankHeaderRow}>
            <View style={styles.bankLogoBadge}>
              <MaterialCommunityIcons name="bank" size={22} color="#084C38" />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.bankNameText}>{bankName}</Text>
              <Text style={styles.verifiedText}>Verified Remittance Account</Text>
            </View>
            <View style={styles.activePill}>
              <View style={styles.greenPulseDot} />
              <Text style={styles.activePillText}>Active</Text>
            </View>
          </View>

          {/* Barcode & Routing Box */}
          <View style={styles.barcodeBox}>
            <MaterialCommunityIcons name="barcode-scan" size={85} color="#084C38" />
            <Text style={styles.barcodeNumber}>* {walletId} *</Text>
            <Text style={styles.barcodeHint}>Scan or copy Wallet ID for instant routing</Text>
          </View>

          {/* Transfer Details Breakdown */}
          <View style={styles.detailsList}>
            {/* Wallet ID */}
            <View style={styles.detailRow}>
              <View style={styles.detailLeft}>
                <Text style={styles.detailLabel}>{t('walletId') || 'Wallet ID (Reference)'}</Text>
                <Text style={styles.detailValuePrimary}>{walletId}</Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.copyMiniBtn,
                  copiedField === 'Wallet ID' && styles.copyMiniBtnSuccess,
                ]}
                onPress={() => copyToClipboard(walletId, 'Wallet ID')}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={copiedField === 'Wallet ID' ? 'checkmark' : 'copy-outline'}
                  size={15}
                  color="#084C38"
                />
                <Text style={styles.copyMiniBtnText}>
                  {copiedField === 'Wallet ID' ? 'Copied' : 'Copy'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.divider} />

            {/* Beneficiary / Account Name */}
            <View style={styles.detailRow}>
              <View style={styles.detailLeft}>
                <Text style={styles.detailLabel}>{t('accountName') || 'Beneficiary Name'}</Text>
                <Text style={styles.detailValue}>{accountName}</Text>
              </View>
              <TouchableOpacity
                style={styles.copyMiniBtn}
                onPress={() => copyToClipboard(accountName, 'Beneficiary Name')}
                activeOpacity={0.7}
              >
                <Ionicons name="copy-outline" size={15} color="#084C38" />
                <Text style={styles.copyMiniBtnText}>Copy</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.divider} />

            {/* Bank Name */}
            <View style={styles.detailRow}>
              <View style={styles.detailLeft}>
                <Text style={styles.detailLabel}>{t('bankName') || 'Bank Name'}</Text>
                <Text style={styles.detailValue}>{bankName}</Text>
              </View>
              <TouchableOpacity
                style={styles.copyMiniBtn}
                onPress={() => copyToClipboard(bankName, 'Bank Name')}
                activeOpacity={0.7}
              >
                <Ionicons name="copy-outline" size={15} color="#084C38" />
                <Text style={styles.copyMiniBtnText}>Copy</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.divider} />

            {/* IBAN */}
            <View style={styles.detailRow}>
              <View style={styles.detailLeft}>
                <Text style={styles.detailLabel}>IBAN</Text>
                <Text style={styles.detailValueMono}>{iban}</Text>
              </View>
              <TouchableOpacity
                style={styles.copyMiniBtn}
                onPress={() => copyToClipboard(iban, 'IBAN')}
                activeOpacity={0.7}
              >
                <Ionicons name="copy-outline" size={15} color="#084C38" />
                <Text style={styles.copyMiniBtnText}>Copy</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* 3 Step Instruction Guide */}
        <View style={styles.stepsContainer}>
          <Text style={styles.stepsTitle}>How to complete transfer:</Text>
          <View style={styles.stepItem}>
            <View style={styles.stepNumberBadge}>
              <Text style={styles.stepNumberText}>1</Text>
            </View>
            <Text style={styles.stepItemText}>
              Open your local banking app (e.g. QNB Mobile or CBQ).
            </Text>
          </View>
          <View style={styles.stepItem}>
            <View style={styles.stepNumberBadge}>
              <Text style={styles.stepNumberText}>2</Text>
            </View>
            <Text style={styles.stepItemText}>
              Send funds to the account above with <Text style={styles.boldText}>{walletId}</Text> as the reference.
            </Text>
          </View>
          <View style={styles.stepItem}>
            <View style={styles.stepNumberBadge}>
              <Text style={styles.stepNumberText}>3</Text>
            </View>
            <Text style={styles.stepItemText}>
              Your AfriSend wallet balance will update automatically in 2-5 minutes.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Footer Actions */}
      <View style={styles.footer}>
        <View style={styles.buttonRow}>
          {/* Share Button */}
          <TouchableOpacity
            style={styles.shareBtn}
            onPress={shareDetails}
            activeOpacity={0.8}
          >
            <Ionicons name="share-social-outline" size={19} color="#084C38" />
            <Text style={styles.shareBtnText}>{t('shareDetails') || 'Share Details'}</Text>
          </TouchableOpacity>

          {/* Copy ID Button */}
          <TouchableOpacity
            style={styles.copyAllBtn}
            onPress={() => copyToClipboard(walletId, 'Wallet ID')}
            activeOpacity={0.8}
          >
            <Ionicons name="copy-outline" size={19} color="#084C38" />
            <Text style={styles.copyAllBtnText}>{t('copyWalletId') || 'Copy ID'}</Text>
          </TouchableOpacity>
        </View>

        {/* Primary Done Button */}
        <TouchableOpacity
          style={styles.doneBtn}
          onPress={() => navigation?.navigate && navigation.navigate('Dashboard')}
          activeOpacity={0.85}
        >
          <Text style={styles.doneBtnText}>
            {t('done') || "I've Made the Transfer"}
          </Text>
          <Ionicons name="checkmark-circle-outline" size={20} color="#FFFFFF" style={styles.btnIcon} />
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
  instantBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E6F6ED',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 4,
  },
  instantBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#084C38',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  instructionBanner: {
    flexDirection: 'row',
    backgroundColor: '#F0FAF5',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    borderRadius: 16,
    padding: 14,
    marginBottom: 18,
    alignItems: 'flex-start',
  },
  infoIconWrapper: {
    marginRight: 10,
    marginTop: 2,
  },
  instructionTextContainer: {
    flex: 1,
  },
  instructionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#083B2D',
    marginBottom: 3,
  },
  instructionText: {
    color: '#065F46',
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '500',
  },
  voucherCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    padding: 18,
    marginBottom: 20,
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  bankHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  bankLogoBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#E6F6ED',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bankNameText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#083B2D',
  },
  verifiedText: {
    fontSize: 11.5,
    color: '#64748B',
    fontWeight: '500',
    marginTop: 2,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 5,
  },
  greenPulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  activePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  barcodeBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 18,
  },
  barcodeNumber: {
    fontSize: 16,
    fontWeight: '800',
    color: '#083B2D',
    letterSpacing: 3,
    marginTop: 6,
    fontFamily: 'monospace',
  },
  barcodeHint: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 4,
    fontWeight: '500',
  },
  detailsList: {
    gap: 4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  detailLeft: {
    flex: 1,
    marginRight: 10,
  },
  detailLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 3,
  },
  detailValue: {
    color: '#111827',
    fontSize: 14.5,
    fontWeight: '700',
  },
  detailValuePrimary: {
    color: '#084C38',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  detailValueMono: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 6,
  },
  copyMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FAF5',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  copyMiniBtnSuccess: {
    backgroundColor: '#E6F6ED',
    borderColor: '#10B981',
  },
  copyMiniBtnText: {
    color: '#084C38',
    fontSize: 12,
    fontWeight: '700',
  },
  stepsContainer: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  stepsTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#083B2D',
    marginBottom: 12,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  stepNumberBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#E6F6ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  stepNumberText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#084C38',
  },
  stepItemText: {
    flex: 1,
    fontSize: 12.5,
    color: '#475569',
    lineHeight: 18,
    fontWeight: '500',
  },
  boldText: {
    fontWeight: '700',
    color: '#083B2D',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  shareBtn: {
    flex: 1,
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
  shareBtnText: {
    color: '#084C38',
    fontSize: 14,
    fontWeight: '700',
  },
  copyAllBtn: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#E6F6ED',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    gap: 8,
  },
  copyAllBtnText: {
    color: '#084C38',
    fontSize: 14,
    fontWeight: '700',
  },
  doneBtn: {
    backgroundColor: '#084C38',
    flexDirection: 'row',
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
  btnIcon: {
    marginLeft: 8,
  },
});
