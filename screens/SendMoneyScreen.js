import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StatusBar,
  Modal,
  FlatList,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';
import { Api } from '../services/api';
import { useWallet } from '../WalletContext';

/**
 * Corridor metadata (country, flag, currency, rail defaults).
 * The rates below are FALLBACKS ONLY — the live retail rate for every corridor
 * is loaded from the API on mount and refreshed on demand, and the price that
 * actually gets booked comes from a server-side quote.
 */
export const AFRICAN_CURRENCIES = {
  NG: {
    country: 'Nigeria',
    code: 'NGN',
    symbol: '₦',
    flag: '🇳🇬',
    rate: 421.06,
    defaultBank: 'Access Bank Nigeria',
    defaultBankCode: '044',
    popularMethods: ['Bank Transfer', 'Direct to Card', 'OPay / Kuda'],
  },
  GH: {
    country: 'Ghana',
    code: 'GHS',
    symbol: 'GH₵',
    flag: '🇬🇭',
    rate: 4.28,
    defaultBank: 'MTN Mobile Money / Ecobank',
    defaultBankCode: '130100',
    popularMethods: ['MTN MoMo', 'Vodafone Cash', 'Bank Transfer'],
  },
  KE: {
    country: 'Kenya',
    code: 'KES',
    symbol: 'KSh',
    flag: '🇰🇪',
    rate: 35.55,
    defaultBank: 'M-Pesa / Equity Bank',
    defaultBankCode: '068',
    popularMethods: ['M-Pesa (Safaricom)', 'Airtel Money', 'Bank Transfer'],
  },
  UG: {
    country: 'Uganda',
    code: 'UGX',
    symbol: 'USh',
    flag: '🇺🇬',
    rate: 1018.40,
    defaultBank: 'MTN MoMo / Stanbic Bank',
    defaultBankCode: '04',
    popularMethods: ['MTN MoMo', 'Airtel Money', 'Bank Transfer'],
  },
  TZ: {
    country: 'Tanzania',
    code: 'TZS',
    symbol: 'TSh',
    flag: '🇹🇿',
    rate: 724.80,
    defaultBank: 'Vodacom M-Pesa / CRDB',
    defaultBankCode: '01',
    popularMethods: ['Vodacom M-Pesa', 'Tigo Pesa', 'Bank Transfer'],
  },
  RW: {
    country: 'Rwanda',
    code: 'RWF',
    symbol: 'FRw',
    flag: '🇷🇼',
    rate: 394.50,
    defaultBank: 'MTN MoMo / Bank of Kigali',
    defaultBankCode: '040',
    popularMethods: ['MTN MoMo', 'Airtel Money', 'Bank Transfer'],
  },
  ZA: {
    country: 'South Africa',
    code: 'ZAR',
    symbol: 'R',
    flag: '🇿🇦',
    rate: 4.57,
    defaultBank: 'Standard Bank / Capitec',
    defaultBankCode: '051001',
    popularMethods: ['Bank Transfer', 'EFT Instant'],
  },
  EG: {
    country: 'Egypt',
    code: 'EGP',
    symbol: 'E£',
    flag: '🇪🇬',
    rate: 13.38,
    defaultBank: 'National Bank of Egypt (NBE)',
    defaultBankCode: '0003',
    popularMethods: ['Bank Transfer', 'Vodafone Cash', 'InstaPay'],
  },
  ET: {
    country: 'Ethiopia',
    code: 'ETB',
    symbol: 'Br',
    flag: '🇪🇹',
    rate: 34.20,
    defaultBank: 'Commercial Bank of Ethiopia (CBE)',
    defaultBankCode: '001',
    popularMethods: ['Telebirr', 'CBE Birr', 'Bank Transfer'],
  },
  CM: {
    country: 'Cameroon',
    code: 'XAF',
    symbol: 'FCFA',
    flag: '🇨🇲',
    rate: 165.20,
    defaultBank: 'MTN MoMo / Orange Money',
    defaultBankCode: '10005',
    popularMethods: ['MTN MoMo', 'Orange Money', 'Bank Transfer'],
  },
  SN: {
    country: 'Senegal',
    code: 'XOF',
    symbol: 'CFA',
    flag: '🇸🇳',
    rate: 165.20,
    defaultBank: 'Wave / Orange Money',
    defaultBankCode: 'SN012',
    popularMethods: ['Wave Mobile Money', 'Orange Money', 'Free Money'],
  },
  CI: {
    country: 'Côte d’Ivoire',
    code: 'XOF',
    symbol: 'CFA',
    flag: '🇨🇮',
    rate: 165.20,
    defaultBank: 'Wave / MTN MoMo',
    defaultBankCode: 'CI012',
    popularMethods: ['Wave', 'MTN MoMo', 'Orange Money'],
  },
  SL: {
    country: 'Sierra Leone',
    code: 'SLE',
    symbol: 'Le',
    flag: '🇸🇱',
    rate: 6.25,
    defaultBank: 'Orange Money / Rokel Bank',
    defaultBankCode: 'SL01',
    popularMethods: ['Orange Money', 'Africell Money', 'Bank Transfer'],
  },
  ZM: {
    country: 'Zambia',
    code: 'ZMW',
    symbol: 'ZK',
    flag: '🇿🇲',
    rate: 7.35,
    defaultBank: 'Airtel Money / Zanaco',
    defaultBankCode: 'ZM01',
    popularMethods: ['Airtel Money', 'MTN MoMo', 'Bank Transfer'],
  },
  MA: {
    country: 'Morocco',
    code: 'MAD',
    symbol: 'DH',
    flag: '🇲🇦',
    rate: 2.70,
    defaultBank: 'Attijariwafa Bank',
    defaultBankCode: 'MA01',
    popularMethods: ['Bank Transfer', 'Cash Pickup'],
  },
  CD: {
    country: 'DR Congo',
    code: 'CDF',
    symbol: 'FC',
    flag: '🇨🇩',
    rate: 780.00,
    defaultBank: 'Vodacom M-Pesa / Rawbank',
    defaultBankCode: 'CD01',
    popularMethods: ['Vodacom M-Pesa', 'Orange Money', 'Airtel Money'],
  },
};

export default function SendMoneyScreen({ navigation, route }) {
  // Safe translation helper
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) {
      t = lang.t;
    }
  } catch (e) {
    console.log('LanguageContext fallback in SendMoneyScreen:', e);
  }

  // Determine initial country & recipient parameters.
  // `route.params.beneficiary` is the saved, name-verified recipient chosen in
  // Recipients/Dashboard; `route.params.recipient` is the legacy display shape.
  const selectedBeneficiary = route?.params?.beneficiary || null;
  const initialParams = route?.params?.recipient || {};
  const initialCountryKey =
    initialParams.countryKey ||
    Object.keys(AFRICAN_CURRENCIES).find(
      (k) =>
        AFRICAN_CURRENCIES[k].country.toLowerCase() === (initialParams.country || '').toLowerCase() ||
        AFRICAN_CURRENCIES[k].code.toLowerCase() === (selectedBeneficiary?.currency || initialParams.currency || '').toLowerCase()
    ) ||
    'NG';

  const [countryKey, setCountryKey] = useState(initialCountryKey);
  const activeCurrency = AFRICAN_CURRENCIES[countryKey] || AFRICAN_CURRENCIES.NG;

  const [beneficiary] = useState(selectedBeneficiary);

  const [recipient, setRecipient] = useState({
    name: selectedBeneficiary?.fullName || initialParams.name || '',
    account: selectedBeneficiary?.accountMasked || initialParams.account || '',
    bankName: selectedBeneficiary?.institutionName || initialParams.bankName || activeCurrency.defaultBank,
    bankCode: selectedBeneficiary?.institutionCode || initialParams.bankCode || activeCurrency.defaultBankCode,
  });

  const { balanceFormatted: walletBalanceFormatted } = useWallet();
  const [amount, setAmount] = useState('500');
  const [liveRates, setLiveRates] = useState({});       // currency code -> retail rate
  const [liveFees, setLiveFees] = useState(null);        // QAR minor units, from the API
  const [countryModalVisible, setCountryModalVisible] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [quoting, setQuoting] = useState(false);

  const rate = liveRates[activeCurrency.code] || activeCurrency.rate;
  const transferFee = liveFees === null ? 0 : liveFees / 100;

  // Dynamic conversion calculation
  const numericAmount = parseFloat(amount) || 0;
  const equivalentRaw = numericAmount > 0 ? numericAmount * rate : 0;
  const equivalent = equivalentRaw.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // Safe initials generation
  const recipientDisplayName = recipient?.name || 'Choose a recipient';
  const recipientInitials = recipientDisplayName
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'AO';

  // Live corridor pricing from the AfriSend API (the rate customers are shown)
  const loadCorridors = async () => {
    try {
      const payload = await Api.corridors();
      const map = {};
      (payload.corridors || []).forEach((corridor) => {
        if (corridor.active) map[corridor.currency] = Number(corridor.retailRate);
      });
      setLiveRates(map);
      if (payload.feeQarMinor !== undefined) setLiveFees(Number(payload.feeQarMinor));
    } catch (err) {
      // Offline: keep the last known rates rather than showing a wrong number.
      console.log('Corridor pricing unavailable:', err.message);
    }
  };

  useEffect(() => {
    loadCorridors();
  }, []);

  const handleRefreshRate = async () => {
    setIsRefreshing(true);
    await loadCorridors();
    setIsRefreshing(false);
  };

  const handleQuickAdd = (val) => {
    const current = parseFloat(amount) || 0;
    setAmount((current + val).toString());
  };

  const handleSelectCountry = (key) => {
    setCountryKey(key);
    const selected = AFRICAN_CURRENCIES[key];
    setRecipient((prev) => ({
      ...prev,
      bankName: selected.defaultBank,
      bankCode: selected.defaultBankCode,
    }));
    setCountryModalVisible(false);
  };

  /**
   * The customer must be sending to a saved, name-verified beneficiary.
   * The server then prices the transfer and returns a quote that is valid for
   * 90 seconds — the amount shown is exactly what gets booked.
   */
  const handleContinue = async () => {
    if (!amount || numericAmount <= 0) {
      Alert.alert('Amount required', 'Please enter an amount to send.');
      return;
    }
    if (!beneficiary || !beneficiary.id) {
      Alert.alert(
        'Choose a recipient',
        'Select a saved recipient, or add one. We verify the account holder name with the bank before saving it.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Choose recipient', onPress: () => navigation.navigate('Recipients') },
        ],
      );
      return;
    }

    setQuoting(true);
    try {
      const payload = await Api.quote(activeCurrency.code, numericAmount);
      const quote = payload.quote;
      navigation.navigate('ReviewTransfer', {
        quote,
        quoteId: quote.id,
        beneficiary,
        amount: numericAmount,
        equivalent: quote.totals.theyReceive,
        rate: Number(quote.retailRate),
        fee: quote.feeQarMinor / 100,
        totalDebit: quote.totals.totalDebit,
        recipient: {
          id: beneficiary.id,
          name: beneficiary.fullName || beneficiary.name,
          bankName: beneficiary.institutionName || activeCurrency.defaultBank,
          bankCode: beneficiary.institutionCode || activeCurrency.defaultBankCode,
          accountNumber: beneficiary.accountMasked || '••••',
          country: activeCurrency.country,
          currency: activeCurrency.code,
          flag: activeCurrency.flag,
        },
      });
    } catch (err) {
      Alert.alert('Could not price this transfer', err.message);
    } finally {
      setQuoting(false);
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
        <Text style={styles.headerTitle}>{t('sendMoney') || 'Send Money'}</Text>
        <TouchableOpacity
          style={styles.rateAlertBtn}
          onPress={() => setCountryModalVisible(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.countryFlagHeader}>{activeCurrency.flag}</Text>
          <Ionicons name="chevron-down" size={14} color="#084C38" />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Recipient Profile Card */}
        <View style={styles.recipientCard}>
          <View style={styles.recipientAvatar}>
            <Text style={styles.avatarText}>{recipientInitials}</Text>
            <View style={styles.flagIconPill}>
              <Text style={styles.flagSmall}>{activeCurrency.flag}</Text>
            </View>
          </View>
          <View style={styles.recipientDetails}>
            <Text style={styles.recipientName}>{recipientDisplayName}</Text>
            <Text style={styles.recipientBank}>
              {recipient.bankName} • {activeCurrency.country}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.changeBtn}
            onPress={() => setCountryModalVisible(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.changeBtnText}>{t('change') || 'Switch'}</Text>
          </TouchableOpacity>
        </View>

        {/* Real-time Exchange Rate Banner */}
        <View style={styles.rateBanner}>
          <View style={styles.rateBannerLeft}>
            <View style={styles.liveIndicatorDot} />
            <Text style={styles.rateBannerText}>
              {t('rate') || 'Rate'}:{' '}
              <Text style={styles.boldRateText}>
                1 QAR = {rate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                {activeCurrency.code}
              </Text>
            </Text>
          </View>
          <TouchableOpacity
            style={styles.refreshBadge}
            onPress={handleRefreshRate}
            activeOpacity={0.7}
          >
            <Ionicons
              name="sync-outline"
              size={13}
              color="#084C38"
            />
            <Text style={styles.refreshBadgeText}>
              {isRefreshing ? 'Updating...' : 'Live Rate'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Remittance Calculator */}
        <View style={styles.calculatorCard}>
          {/* Sender Input Block */}
          <View style={styles.amountBlock}>
            <View style={styles.blockHeader}>
              <Text style={styles.blockLabel}>{t('youSend') || 'YOU SEND'}</Text>
              <Text style={styles.balanceTag}>Wallet: {walletBalanceFormatted}</Text>
            </View>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.amountInput}
                placeholder="0.00"
                placeholderTextColor="#9CA3AF"
                keyboardType="numeric"
                value={amount}
                onChangeText={setAmount}
              />
              <View style={styles.currencyTag}>
                <Text style={styles.flagIcon}>🇶🇦</Text>
                <Text style={styles.currencyCode}>QAR</Text>
              </View>
            </View>
          </View>

          {/* Transfer Corridor Connection Timeline */}
          <View style={styles.corridorTimeline}>
            <View style={styles.timelineLine} />

            {/* Fee Item */}
            <View style={styles.timelineRow}>
              <View style={styles.timelineIcon}>
                <Ionicons name="sparkles" size={12} color="#084C38" />
              </View>
              <Text style={styles.timelineTitle}>{t('transferFee') || 'Transfer Fee'}</Text>
              <View style={styles.freeBadge}>
                <Text style={styles.freeBadgeText}>0.00 QAR (FREE)</Text>
              </View>
            </View>

            {/* Rate Item */}
            <View style={styles.timelineRow}>
              <View style={styles.timelineIcon}>
                <Ionicons name="trending-up" size={12} color="#084C38" />
              </View>
              <Text style={styles.timelineTitle}>{t('guaranteedRate') || 'Exchange Rate'}</Text>
              <Text style={styles.timelineValue}>
                1 QAR = {rate.toFixed(2)} {activeCurrency.code}
              </Text>
            </View>

            {/* Speed Item */}
            <View style={styles.timelineRow}>
              <View style={styles.timelineIcon}>
                <Ionicons name="flash" size={12} color="#084C38" />
              </View>
              <Text style={styles.timelineTitle}>{t('deliverySpeed') || 'Delivery Speed'}</Text>
              <Text style={styles.timelineValueFast}>Instant (Within 2 min)</Text>
            </View>
          </View>

          {/* Recipient Converted Block */}
          <View style={[styles.amountBlock, styles.amountBlockRecipient]}>
            <View style={styles.blockHeader}>
              <Text style={styles.blockLabel}>
                {t('recipientGets') || 'RECIPIENT RECEIVES'}
              </Text>
              <Text style={styles.guaranteedPayoutText}>Guaranteed Amount</Text>
            </View>
            <View style={styles.inputRow}>
              <Text style={styles.convertedAmount} numberOfLines={1} adjustsFontSizeToFit>
                {equivalent}
              </Text>
              <TouchableOpacity
                style={styles.currencyTagRecipient}
                onPress={() => setCountryModalVisible(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.flagIcon}>{activeCurrency.flag}</Text>
                <Text style={styles.currencyCode}>{activeCurrency.code}</Text>
                <Ionicons name="chevron-down" size={14} color="#083B2D" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Quick Amount Buttons */}
        <View style={styles.quickAddContainer}>
          {[100, 250, 500, 1000].map((val) => (
            <TouchableOpacity
              key={val}
              style={styles.quickAddPill}
              onPress={() => handleQuickAdd(val)}
              activeOpacity={0.7}
            >
              <Text style={styles.quickAddPillText}>+{val} QAR</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Security & Guarantee Note */}
        <View style={styles.guaranteeCard}>
          <Ionicons name="shield-checkmark" size={17} color="#084C38" />
          <Text style={styles.guaranteeCardText}>
            Guaranteed payout with zero hidden markups or intermediary fees.
          </Text>
        </View>
      </ScrollView>

      {/* Footer Action */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.button, !amount && styles.buttonDisabled]}
          disabled={!amount || numericAmount <= 0}
          onPress={handleContinue}
          activeOpacity={0.85}
        >
          <Text style={styles.buttonText}>
            {t('continue') || 'Continue to Review'}
          </Text>
          <Ionicons name="arrow-forward" size={18} color="#FFFFFF" style={styles.btnIcon} />
        </TouchableOpacity>
      </View>

      {/* African Corridor Bottom Sheet Modal */}
      <Modal
        visible={countryModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setCountryModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Select African Destination</Text>
                <Text style={styles.modalSubtitle}>
                  Real-time live exchange rates vs 1 QAR
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setCountryModalVisible(false)}
                style={styles.closeBtn}
              >
                <Ionicons name="close" size={22} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {/* List of Countries */}
            <FlatList
              data={Object.keys(AFRICAN_CURRENCIES)}
              keyExtractor={(item) => item}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const c = AFRICAN_CURRENCIES[item];
                const isSelected = item === countryKey;
                return (
                  <TouchableOpacity
                    style={[
                      styles.countryItem,
                      isSelected && styles.countryItemSelected,
                    ]}
                    onPress={() => handleSelectCountry(item)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.countryItemFlag}>{c.flag}</Text>
                    <View style={styles.countryItemInfo}>
                      <Text style={styles.countryItemName}>{c.country}</Text>
                      <Text style={styles.countryItemSub}>
                        {c.code} • {c.popularMethods[0]}
                      </Text>
                    </View>
                    <View style={styles.countryItemRateBox}>
                      <Text style={styles.countryItemRate}>
                        1 QAR = {c.rate.toFixed(2)} {c.code}
                      </Text>
                      {isSelected && (
                        <Ionicons name="checkmark-circle" size={18} color="#084C38" />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
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
  rateAlertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E6F6ED',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  countryFlagHeader: {
    fontSize: 18,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  recipientCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
  },
  recipientAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#084C38',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginRight: 12,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  flagIconPill: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 1,
  },
  flagSmall: {
    fontSize: 11,
  },
  recipientDetails: {
    flex: 1,
  },
  recipientName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#083B2D',
    marginBottom: 2,
  },
  recipientBank: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  changeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  changeBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#084C38',
  },
  rateBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F0FAF5',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 16,
  },
  rateBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  liveIndicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  rateBannerText: {
    fontSize: 12.5,
    color: '#065F46',
    fontWeight: '600',
  },
  boldRateText: {
    fontWeight: '800',
    color: '#083B2D',
  },
  refreshBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  refreshBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#084C38',
  },
  calculatorCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    padding: 16,
    marginBottom: 14,
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  amountBlock: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  amountBlockRecipient: {
    backgroundColor: '#F0FAF5',
    borderColor: '#D1FAE5',
  },
  blockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  blockLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.8,
  },
  balanceTag: {
    fontSize: 11.5,
    color: '#084C38',
    fontWeight: '600',
  },
  guaranteedPayoutText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  inputRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  amountInput: {
    flex: 1,
    fontSize: 26,
    fontWeight: '800',
    color: '#083B2D',
    padding: 0,
  },
  convertedAmount: {
    flex: 1,
    fontSize: 26,
    fontWeight: '800',
    color: '#084C38',
  },
  currencyTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
  },
  currencyTagRecipient: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    gap: 5,
  },
  flagIcon: {
    fontSize: 18,
  },
  currencyCode: {
    fontSize: 15,
    fontWeight: '800',
    color: '#083B2D',
  },
  corridorTimeline: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    position: 'relative',
  },
  timelineLine: {
    position: 'absolute',
    left: 17,
    top: 18,
    bottom: 18,
    width: 2,
    backgroundColor: '#E2E8F0',
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  timelineIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#E6F6ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    zIndex: 1,
  },
  timelineTitle: {
    fontSize: 12.5,
    color: '#64748B',
    fontWeight: '600',
    flex: 1,
  },
  timelineValue: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#083B2D',
  },
  timelineValueFast: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#059669',
  },
  freeBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  freeBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#059669',
  },
  quickAddContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 16,
  },
  quickAddPill: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickAddPillText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#084C38',
  },
  guaranteeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  guaranteeCardText: {
    fontSize: 11.5,
    color: '#475569',
    fontWeight: '600',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 34,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#083B2D',
  },
  modalSubtitle: {
    fontSize: 12.5,
    color: '#64748B',
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
  },
  countryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  countryItemSelected: {
    borderColor: '#084C38',
    backgroundColor: '#F0FAF5',
    borderWidth: 1.6,
  },
  countryItemFlag: {
    fontSize: 26,
    marginRight: 12,
  },
  countryItemInfo: {
    flex: 1,
  },
  countryItemName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  countryItemSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  countryItemRateBox: {
    alignItems: 'flex-end',
    gap: 4,
  },
  countryItemRate: {
    fontSize: 13,
    fontWeight: '700',
    color: '#084C38',
  },
});
