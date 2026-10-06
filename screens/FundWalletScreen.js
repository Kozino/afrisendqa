import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StatusBar,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';
import { useWallet } from '../WalletContext';
import { Api } from '../services/api';

export default function FundWalletScreen({ navigation }) {
  // Safe translation helper with fallback to default UI text
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) {
      t = lang.t;
    }
  } catch (e) {
    // Fallback if LanguageContext is not available
  }

  const [amount, setAmount] = useState('500');
  const { balanceFormatted, refresh: refreshWallet } = useWallet();
  const [starting, setStarting] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState('qnb'); // 'qnb', 'doha', 'card'

  /**
   * Opens the provider-hosted checkout (card / bank transfer) from the API.
   * The wallet is credited by the Flutterwave webhook, not by this screen, so
   * closing the browser without paying never creates money.
   */
  const startCardFunding = async () => {
    setStarting(true);
    try {
      const payload = await Api.startFunding(parseFloat(amount), 'CARD');
      await refreshWallet({ quiet: true }).catch(() => {});
      navigation.navigate('AddCard', {
        amount: parseFloat(amount),
        checkoutUrl: payload.funding?.checkoutUrl,
        fundingReference: payload.funding?.reference,
      });
    } catch (err) {
      alert(`Could not start the payment: ${err.message}`);
    } finally {
      setStarting(false);
    }
  };

  const handleQuickAdd = (value) => {
    const current = parseFloat(amount) || 0;
    setAmount((current + value).toString());
  };

  const handleProceed = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      alert("Please enter an amount");
      return;
    }
    if (selectedMethod === 'card') {
      if (navigation?.navigate) {
        await startCardFunding();
      }
    } else {
      if (navigation?.navigate) {
        navigation.navigate('FundViaBank', { amount: parseFloat(amount), method: selectedMethod });
      }
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Top App Header */}
      <View style={styles.topHeader}>
        <View style={styles.brandContainer}>
          <View style={styles.avatarBorder}>
            <Image
              source={{ uri: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80' }}
              style={styles.avatar}
            />
          </View>
          <Text style={styles.brandTitle}>AfriSend</Text>
        </View>
        <TouchableOpacity style={styles.notificationBtn} activeOpacity={0.7}>
          <Ionicons name="notifications-outline" size={24} color="#084C38" />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Screen Title & Subtitle */}
        <View style={styles.titleSection}>
          <Text style={styles.screenTitle}>{t('fundWallet') || 'Fund Wallet'}</Text>
          <Text style={styles.screenSubtitle}>
            {t('fundWalletSubtitle') || 'Add money to your Zest Remit wallet securely'}
          </Text>
        </View>

        {/* Current Balance Card */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>
            {(t('currentBalance') || 'CURRENT BALANCE').toUpperCase()}
          </Text>
          <View style={styles.balanceAmountRow}>
            <Text style={styles.balanceAmount}>{String(balanceFormatted).replace(/ ?QAR$/, '')}</Text>
            <Text style={styles.balanceCurrency}> QAR</Text>
          </View>

          {/* Secure & Verified Badge */}
          <View style={styles.secureBadge}>
            <MaterialCommunityIcons name="shield-check" size={15} color="#A7F3D0" />
            <Text style={styles.secureBadgeText}>
              {t('secureVerified') || 'Secure & Verified Wallet'}
            </Text>
          </View>
        </View>

        {/* Enter Amount Section */}
        <View style={styles.amountSection}>
          <Text style={styles.sectionLabel}>
            {t('enterAmount') || 'Enter Amount to Add'}
          </Text>

          {/* Amount Input Box */}
          <View style={styles.amountInputContainer}>
            <Text style={styles.currencyPrefix}>QAR</Text>
            <TextInput
              style={styles.amountInput}
              placeholder="0"
              placeholderTextColor="#9CA3AF"
              keyboardType="numeric"
              value={amount}
              onChangeText={setAmount}
            />
          </View>

          {/* Quick Amount Buttons (+100, +500, +1000) */}
          <View style={styles.quickAddRow}>
            {[100, 500, 1000].map((val) => (
              <TouchableOpacity
                key={val}
                style={styles.quickAddButton}
                onPress={() => handleQuickAdd(val)}
                activeOpacity={0.7}
              >
                <Text style={styles.quickAddText}>+{val}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Select Funding Source Section */}
        <View style={styles.fundingSourceSection}>
          <View style={styles.fundingSourceHeader}>
            <Text style={styles.sectionTitle}>
              {t('selectFundingSource') || 'Select Funding Source'}
            </Text>
            <TouchableOpacity
              onPress={() => navigation?.navigate && navigation.navigate('AddCard')}
              activeOpacity={0.7}
            >
              <Text style={styles.addNewText}>{t('addNew') || 'Add New'}</Text>
            </TouchableOpacity>
          </View>

          {/* Option 1: QNB Bank Transfer */}
          <TouchableOpacity
            style={[
              styles.methodCard,
              selectedMethod === 'qnb' && styles.methodCardSelected,
            ]}
            onPress={() => setSelectedMethod('qnb')}
            activeOpacity={0.8}
          >
            <View
              style={[
                styles.iconContainer,
                selectedMethod === 'qnb'
                  ? styles.iconContainerActive
                  : styles.iconContainerInactive,
              ]}
            >
              <MaterialCommunityIcons
                name="bank"
                size={24}
                color={selectedMethod === 'qnb' ? '#084C38' : '#94A3B8'}
              />
            </View>
            <View style={styles.methodInfo}>
              <Text style={styles.methodName}>
                {t('qnbBankTransfer') || 'QNB Bank Transfer'}
              </Text>
              <Text
                style={[
                  styles.methodAccount,
                  selectedMethod === 'qnb' && styles.methodAccountSelected,
                ]}
              >
                **** 8842
              </Text>
            </View>
            <Ionicons
              name={
                selectedMethod === 'qnb'
                  ? 'radio-button-on'
                  : 'radio-button-off'
              }
              size={22}
              color={selectedMethod === 'qnb' ? '#084C38' : '#CBD5E1'}
            />
          </TouchableOpacity>

          {/* Option 2: Doha Bank */}
          <TouchableOpacity
            style={[
              styles.methodCard,
              selectedMethod === 'doha' && styles.methodCardSelected,
            ]}
            onPress={() => setSelectedMethod('doha')}
            activeOpacity={0.8}
          >
            <View
              style={[
                styles.iconContainer,
                selectedMethod === 'doha'
                  ? styles.iconContainerActive
                  : styles.iconContainerInactive,
              ]}
            >
              <MaterialCommunityIcons
                name="bank"
                size={24}
                color={selectedMethod === 'doha' ? '#084C38' : '#94A3B8'}
              />
            </View>
            <View style={styles.methodInfo}>
              <Text style={styles.methodName}>
                {t('dohaBank') || 'Doha Bank'}
              </Text>
              <Text
                style={[
                  styles.methodAccount,
                  selectedMethod === 'doha' && styles.methodAccountSelected,
                ]}
              >
                **** 1209
              </Text>
            </View>
            <Ionicons
              name={
                selectedMethod === 'doha'
                  ? 'radio-button-on'
                  : 'radio-button-off'
              }
              size={22}
              color={selectedMethod === 'doha' ? '#084C38' : '#CBD5E1'}
            />
          </TouchableOpacity>

          {/* Option 3: Credit/Debit Card */}
          <TouchableOpacity
            style={[
              styles.methodCard,
              selectedMethod === 'card' && styles.methodCardSelected,
            ]}
            onPress={() => setSelectedMethod('card')}
            activeOpacity={0.8}
          >
            <View
              style={[
                styles.iconContainer,
                selectedMethod === 'card'
                  ? styles.iconContainerActive
                  : styles.iconContainerInactive,
              ]}
            >
              <MaterialCommunityIcons
                name="credit-card-outline"
                size={24}
                color={selectedMethod === 'card' ? '#084C38' : '#94A3B8'}
              />
            </View>
            <View style={styles.methodInfo}>
              <Text style={styles.methodName}>
                {t('debitCreditCard') || 'Credit/Debit Card'}
              </Text>
              <Text
                style={[
                  styles.methodAccount,
                  selectedMethod === 'card' && styles.methodAccountSelected,
                ]}
              >
                Visa ending in 4490
              </Text>
            </View>
            <Ionicons
              name={
                selectedMethod === 'card'
                  ? 'radio-button-on'
                  : 'radio-button-off'
              }
              size={22}
              color={selectedMethod === 'card' ? '#084C38' : '#CBD5E1'}
            />
          </TouchableOpacity>
        </View>

        {/* Action Button */}
        <TouchableOpacity
          style={styles.continueButton}
          onPress={handleProceed}
          activeOpacity={0.85}
        >
          <Text style={styles.continueButtonText}>
            {t('continueToFund') || 'Continue to Fund'}
          </Text>
          <Ionicons name="arrow-forward" size={18} color="#FFFFFF" style={styles.buttonIcon} />
        </TouchableOpacity>

        {/* Encrypted Transactions Note */}
        <View style={styles.securityFooter}>
          <Ionicons name="lock-closed-outline" size={14} color="#94A3B8" />
          <Text style={styles.securityFooterText}>
            {t('encryptedTransactions') || 'End-to-end encrypted transactions'}
          </Text>
        </View>
      </ScrollView>

      {/* Bottom Navigation Tab Bar */}
      <View style={styles.bottomTabBar}>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => navigation?.navigate && navigation.navigate('Dashboard')}
        >
          <Ionicons name="home-outline" size={20} color="#94A3B8" />
          <Text style={styles.tabLabel}>Home</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, styles.activeTabPill]}
          onPress={() => {}}
        >
          <MaterialCommunityIcons name="bank-transfer" size={22} color="#084C38" />
          <Text style={styles.activeTabLabel}>Transfer</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => navigation?.navigate && navigation.navigate('Recipients')}
        >
          <Ionicons name="people-outline" size={20} color="#94A3B8" />
          <Text style={styles.tabLabel}>Recipients</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => navigation?.navigate && navigation.navigate('Profile')}
        >
          <Ionicons name="person-outline" size={20} color="#94A3B8" />
          <Text style={styles.tabLabel}>Account</Text>
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
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarBorder: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: '#0D684D',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#084C38',
    letterSpacing: -0.2,
  },
  notificationBtn: {
    padding: 6,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  titleSection: {
    marginTop: 12,
    marginBottom: 18,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#083B2D',
    letterSpacing: -0.5,
  },
  screenSubtitle: {
    fontSize: 13.5,
    color: '#6B7280',
    marginTop: 4,
    fontWeight: '400',
  },
  balanceCard: {
    backgroundColor: '#084C38',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 20,
    marginBottom: 22,
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 5,
  },
  balanceLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A7F3D0',
    letterSpacing: 1.1,
    marginBottom: 8,
  },
  balanceAmountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 16,
  },
  balanceAmount: {
    fontSize: 34,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  balanceCurrency: {
    fontSize: 16,
    fontWeight: '600',
    color: '#D1FAE5',
    marginLeft: 4,
  },
  secureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  secureBadgeText: {
    color: '#ECFDF5',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 6,
  },
  amountSection: {
    marginBottom: 22,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#083B2D',
    marginBottom: 10,
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FAF5',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E1F3EA',
  },
  currencyPrefix: {
    fontSize: 16,
    fontWeight: '800',
    color: '#083B2D',
    marginRight: 10,
  },
  amountInput: {
    flex: 1,
    fontSize: 24,
    fontWeight: '800',
    color: '#083B2D',
    padding: 0,
  },
  quickAddRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  quickAddButton: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D4EFE3',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickAddText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#084C38',
  },
  fundingSourceSection: {
    marginBottom: 20,
  },
  fundingSourceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#083B2D',
  },
  addNewText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#C26D24',
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EDF2F7',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
  },
  methodCardSelected: {
    borderColor: '#084C38',
    borderWidth: 1.8,
    backgroundColor: '#FFFFFF',
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  iconContainerActive: {
    backgroundColor: '#E6F6ED',
  },
  iconContainerInactive: {
    backgroundColor: '#F3F4F6',
  },
  methodInfo: {
    flex: 1,
  },
  methodName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 2,
  },
  methodAccount: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9CA3AF',
  },
  methodAccountSelected: {
    color: '#10B981',
    fontWeight: '600',
  },
  continueButton: {
    backgroundColor: '#084C38',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 14,
    marginTop: 4,
    marginBottom: 14,
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  continueButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  buttonIcon: {
    marginLeft: 8,
  },
  securityFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 8,
  },
  securityFooterText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500',
  },
  bottomTabBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  activeTabPill: {
    backgroundColor: '#E6F6ED',
    paddingVertical: 4,
    paddingHorizontal: 14,
  },
  tabLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
    marginTop: 2,
  },
  activeTabLabel: {
    fontSize: 11,
    color: '#084C38',
    fontWeight: '700',
    marginTop: 2,
  },
});
