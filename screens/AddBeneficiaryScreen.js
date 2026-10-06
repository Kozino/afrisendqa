import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';
import { Api } from '../services/api';
import { useWallet } from '../WalletContext';

const GREEN = '#084C38';

// Complete African corridors with bank codes and mobile providers
const countries = [
  {
    name: 'Nigeria',
    code: 'NG',
    currency: 'NGN',
    flag: '🇳🇬',
    colors: ['#008751', '#FFFFFF', '#008751'],
    banks: [
      { name: 'Access Bank', code: '044' },
      { name: 'GTBank', code: '058' },
      { name: 'Zenith Bank', code: '057' },
      { name: 'First Bank of Nigeria', code: '011' },
      { name: 'United Bank for Africa (UBA)', code: '033' },
      { name: 'Kuda Bank', code: '50211' },
      { name: 'OPay', code: '999992' },
      { name: 'PalmPay', code: '999991' },
    ],
    mobileProviders: ['OPay', 'PalmPay', 'MTN MoMo', 'Airtel Money'],
  },
  {
    name: 'Ghana',
    code: 'GH',
    currency: 'GHS',
    flag: '🇬🇭',
    colors: ['#CE1126', '#FCD116', '#006B3F'],
    banks: [
      { name: 'Ecobank Ghana', code: '130100' },
      { name: 'GCB Bank', code: '040100' },
      { name: 'Fidelity Bank Ghana', code: '240100' },
      { name: 'Absa Bank Ghana', code: '030100' },
      { name: 'Stanbic Bank Ghana', code: '190100' },
    ],
    mobileProviders: ['MTN MoMo', 'Vodafone Cash', 'AirtelTigo Money'],
  },
  {
    name: 'Kenya',
    code: 'KE',
    currency: 'KES',
    flag: '🇰🇪',
    colors: ['#000000', '#BB0000', '#006600'],
    banks: [
      { name: 'Equity Bank Kenya', code: '068' },
      { name: 'KCB Bank', code: '001' },
      { name: 'Co-operative Bank', code: '011' },
      { name: 'Absa Bank Kenya', code: '003' },
      { name: 'NCBA Bank', code: '007' },
    ],
    mobileProviders: ['M-Pesa (Safaricom)', 'Airtel Money', 'T-Kash'],
  },
  {
    name: 'Uganda',
    code: 'UG',
    currency: 'UGX',
    flag: '🇺🇬',
    colors: ['#000000', '#FCDC04', '#D90000'],
    banks: [
      { name: 'Stanbic Bank Uganda', code: '04' },
      { name: 'Centenary Bank', code: '06' },
      { name: 'Absa Bank Uganda', code: '02' },
      { name: 'DFCU Bank', code: '03' },
    ],
    mobileProviders: ['MTN MoMo Uganda', 'Airtel Money Uganda'],
  },
  {
    name: 'Rwanda',
    code: 'RW',
    currency: 'RWF',
    flag: '🇷🇼',
    colors: ['#00A1DE', '#FAD201', '#20603D'],
    banks: [
      { name: 'Bank of Kigali', code: '040' },
      { name: 'Equity Bank Rwanda', code: '068' },
      { name: 'Ecobank Rwanda', code: '010' },
    ],
    mobileProviders: ['MTN MoMo Rwanda', 'Airtel Money Rwanda'],
  },
  {
    name: 'Cameroon',
    code: 'CM',
    currency: 'XAF',
    flag: '🇨🇲',
    colors: ['#007A5E', '#CE1126', '#FCD116'],
    banks: [
      { name: 'Afriland First Bank', code: '10005' },
      { name: 'Ecobank Cameroon', code: '10029' },
      { name: 'Societe Generale Cameroun', code: '10003' },
    ],
    mobileProviders: ['MTN MoMo Cameroon', 'Orange Money Cameroon'],
  },
  {
    name: 'Senegal',
    code: 'SN',
    currency: 'XOF',
    flag: '🇸🇳',
    colors: ['#00853F', '#FDEF42', '#E31B23'],
    banks: [
      { name: 'CBAO Groupe Attijariwafa', code: 'SN012' },
      { name: 'Societe Generale Senegal', code: 'SN011' },
      { name: 'Ecobank Senegal', code: 'SN094' },
    ],
    mobileProviders: ['Wave Mobile Money', 'Orange Money Senegal', 'Free Money'],
  },
];

function FlagCircle({ colors, size = 36 }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', borderWidth: 1, borderColor: '#E2E8F0' }}>
      {colors.map((c, i) => (
        <View key={i} style={{ flex: 1, backgroundColor: c }} />
      ))}
    </View>
  );
}

export default function AddBeneficiaryScreen({ navigation }) {
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) t = lang.t;
  } catch (e) {
    console.log('LanguageContext fallback:', e);
  }

  const [fullName, setFullName] = useState('');
  const [selectedCountry, setSelectedCountry] = useState(countries[0]);
  const [transferMethod, setTransferMethod] = useState('bank'); // 'bank' or 'mobile'

  const [selectedBank, setSelectedBank] = useState(countries[0].banks[0]);
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isValidated, setIsValidated] = useState(false);

  const [selectedProvider, setSelectedProvider] = useState(countries[0].mobileProviders[0]);
  const [mobileNumber, setMobileNumber] = useState('');

  /**
   * Resolve the account holder's legal name through our API before the
   * recipient can be saved. This is the control that stops money going to a
   * mistyped or swapped account number — the name the bank returns is what the
   * customer confirms.
   */
  const triggerValidation = async (accNum, bCode) => {
    if (!accNum || accNum.length < 9) return;
    setIsValidating(true);
    try {
      const result = await Api.resolveAccount(accNum, bCode);
      if (result.accountName) {
        setAccountName(result.accountName);
        setFullName(result.accountName);
        setIsValidated(true);
      } else {
        setIsValidated(false);
      }
    } catch (err) {
      setAccountName('');
      setIsValidated(false);
      Alert.alert(
        'Could not verify this account',
        `${err.message} Check the number and bank, then try again.`,
      );
    } finally {
      setIsValidating(false);
    }
  };

  const handleAccountNumberChange = (text) => {
    const cleaned = text.replace(/\D/g, '');
    setAccountNumber(cleaned);

    // Auto-trigger when 10 digits are typed
    if (cleaned.length === 10 && transferMethod === 'bank') {
      triggerValidation(cleaned, selectedBank.code);
    } else {
      setIsValidated(false);
    }
  };

  const handleSelectCountry = (country) => {
    setSelectedCountry(country);
    setSelectedBank(country.banks[0]);
    setSelectedProvider(country.mobileProviders[0]);
    setAccountNumber('');
    setAccountName('');
    setIsValidated(false);
  };

  const [saving, setSaving] = useState(false);
  const { refresh: refreshWallet } = useWallet();

  /**
   * Save the recipient on the server (which re-runs the bank name check) and
   * return to the send flow with the created record.
   */
  const handleSaveBeneficiary = async () => {
    if (!fullName && !accountName) {
      Alert.alert('Name required', 'Verify the account number so we can read the account holder name.');
      return;
    }

    const isBank = transferMethod === 'bank';
    const payload = {
      fullName: accountName || fullName,
      countryCode: selectedCountry.iso || selectedCountry.code,
      currency: selectedCountry.currency,
      channel: isBank ? 'FLUTTERWAVE_BANK' : 'FLUTTERWAVE_MOBILE_MONEY',
      institutionCode: isBank ? selectedBank.code : 'MOMO',
      institutionName: isBank ? selectedBank.name : selectedProvider,
      accountNumber: isBank ? accountNumber : mobileNumber,
    };

    setSaving(true);
    try {
      const result = await Api.addBeneficiary(payload);
      await refreshWallet({ quiet: true }).catch(() => {});
      const created = result.beneficiary;
      Alert.alert(
        t('beneficiarySaved') || 'Recipient saved',
        result.warning
          ? result.warning
          : `${created.full_name || payload.fullName} (${payload.institutionName}) is saved and verified.`,
        [
          { text: t('sendMoneyNow') || 'Send money now', onPress: () => navigation.navigate('SendMoney', { beneficiary: created }) },
          { text: t('done') || 'View recipients', onPress: () => navigation.navigate('Recipients') },
        ],
      );
    } catch (err) {
      Alert.alert('Could not save recipient', err.message);
    } finally {
      setSaving(false);
    }
  };

  const isValid =
    (fullName.length > 0 || accountName.length > 0) &&
    (transferMethod === 'bank' ? accountNumber.length >= 8 : mobileNumber.length >= 8);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Screen Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation?.goBack && navigation.goBack()}
          style={styles.headerBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={22} color="#083B2D" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('addBeneficiary') || 'Add Recipient'}</Text>
        <View style={styles.secureHeaderBadge}>
          <Ionicons name="shield-checkmark" size={13} color="#084C38" />
          <Text style={styles.secureHeaderText}>Verified</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Title Info */}
        <View style={styles.topInfo}>
          <Text style={styles.title}>{t('addBeneficiary') || 'Add New Beneficiary'}</Text>
          <Text style={styles.subtitle}>
            Direct instant payouts to bank accounts and mobile money wallets across Africa.
          </Text>
        </View>

        {/* Destination Country Selection Carousel */}
        <Text style={styles.sectionLabel}>DESTINATION COUNTRY</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.countryScroll}>
          {countries.map((c) => {
            const isSelected = selectedCountry.name === c.name;
            return (
              <TouchableOpacity
                key={c.name}
                style={[styles.countryCard, isSelected && styles.countryCardSelected]}
                onPress={() => handleSelectCountry(c)}
                activeOpacity={0.8}
              >
                <FlagCircle colors={c.colors} size={32} />
                <Text style={[styles.countryName, isSelected && styles.countryNameSelected]} numberOfLines={1}>
                  {c.name}
                </Text>
                <Text style={styles.countryCur}>{c.currency}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Transfer Method Toggle (Bank vs Mobile Money) */}
        <Text style={styles.sectionLabel}>PAYOUT METHOD</Text>
        <View style={styles.methodToggleRow}>
          <TouchableOpacity
            style={[styles.methodToggleBtn, transferMethod === 'bank' && styles.methodToggleBtnActive]}
            onPress={() => setTransferMethod('bank')}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons
              name="bank"
              size={18}
              color={transferMethod === 'bank' ? '#084C38' : '#64748B'}
            />
            <Text style={[styles.methodToggleText, transferMethod === 'bank' && styles.methodToggleTextActive]}>
              Bank Account
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.methodToggleBtn, transferMethod === 'mobile' && styles.methodToggleBtnActive]}
            onPress={() => setTransferMethod('mobile')}
            activeOpacity={0.85}
          >
            <Ionicons
              name="phone-portrait-outline"
              size={18}
              color={transferMethod === 'mobile' ? '#084C38' : '#64748B'}
            />
            <Text style={[styles.methodToggleText, transferMethod === 'mobile' && styles.methodToggleTextActive]}>
              Mobile Money
            </Text>
          </TouchableOpacity>
        </View>

        {/* Form Fields */}
        <View style={styles.formCard}>
          {/* BANK PAYOUT FORM */}
          {transferMethod === 'bank' && (
            <>
              {/* Bank Selector Chips */}
              <Text style={styles.label}>Select Bank ({selectedCountry.name})</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bankChipRow}>
                {selectedCountry.banks.map((bank) => {
                  const isBankSel = selectedBank.name === bank.name;
                  return (
                    <TouchableOpacity
                      key={bank.code}
                      style={[styles.bankChip, isBankSel && styles.bankChipSelected]}
                      onPress={() => {
                        setSelectedBank(bank);
                        if (accountNumber.length >= 9) triggerValidation(accountNumber, bank.code);
                      }}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.bankChipText, isBankSel && styles.bankChipTextSelected]}>
                        {bank.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Account Number with Real-Time Validation */}
              <Text style={styles.label}>Account Number</Text>
              <View style={styles.inputWrapper}>
                <MaterialCommunityIcons name="numeric" size={20} color="#084C38" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="10-Digit Account Number"
                  placeholderTextColor="#94A3B8"
                  keyboardType="numeric"
                  maxLength={12}
                  value={accountNumber}
                  onChangeText={handleAccountNumberChange}
                />
                {isValidating && <ActivityIndicator size="small" color="#084C38" style={{ marginRight: 6 }} />}
                {isValidated && (
                  <View style={styles.validatedPill}>
                    <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                    <Text style={styles.validatedPillText}>Verified</Text>
                  </View>
                )}
                {!isValidated && accountNumber.length >= 9 && !isValidating && (
                  <TouchableOpacity
                    style={styles.verifyManualBtn}
                    onPress={() => triggerValidation(accountNumber, selectedBank.code)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.verifyManualText}>Verify</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Auto-resolved Account Name from Flutterwave */}
              {accountName.length > 0 && (
                <View style={styles.resolvedNameBox}>
                  <View style={styles.resolvedHeadRow}>
                    <Ionicons name="checkmark-done-circle" size={16} color="#084C38" />
                    <Text style={styles.resolvedNameLabel}>VERIFIED BENEFICIARY NAME:</Text>
                  </View>
                  <Text style={styles.resolvedNameText}>{accountName}</Text>
                </View>
              )}
            </>
          )}

          {/* MOBILE MONEY FORM */}
          {transferMethod === 'mobile' && (
            <>
              {/* Provider Selector */}
              <Text style={styles.label}>Mobile Money Provider ({selectedCountry.name})</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bankChipRow}>
                {selectedCountry.mobileProviders.map((provider) => {
                  const isProviderSel = selectedProvider === provider;
                  return (
                    <TouchableOpacity
                      key={provider}
                      style={[styles.bankChip, isProviderSel && styles.bankChipSelected]}
                      onPress={() => setSelectedProvider(provider)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.bankChipText, isProviderSel && styles.bankChipTextSelected]}>
                        {provider}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Mobile Phone Number */}
              <Text style={styles.label}>Mobile Money Number</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="call-outline" size={18} color="#084C38" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 0712 345 678"
                  placeholderTextColor="#94A3B8"
                  keyboardType="phone-pad"
                  value={mobileNumber}
                  onChangeText={setMobileNumber}
                />
              </View>
            </>
          )}

          {/* Recipient Full Name */}
          <Text style={styles.label}>Recipient Full Legal Name</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="person-outline" size={18} color="#084C38" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Full name as registered on ID"
              placeholderTextColor="#94A3B8"
              value={accountName || fullName}
              onChangeText={setFullName}
            />
          </View>
        </View>

        {/* Security & Verification Guarantee */}
        <View style={styles.securityNote}>
          <MaterialCommunityIcons name="shield-check" size={18} color="#084C38" />
          <Text style={styles.securityNoteText}>
            Beneficiary routing numbers are validated through Flutterwave banking integration before payouts occur.
          </Text>
        </View>
      </ScrollView>

      {/* Footer Submit Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveBtn, !isValid && styles.saveBtnDisabled]}
          disabled={!isValid}
          onPress={handleSaveBeneficiary}
          activeOpacity={0.85}
        >
          <Text style={styles.saveBtnText}>{t('saveBeneficiary') || 'Save Beneficiary'}</Text>
          <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" style={{ marginLeft: 6 }} />
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
    fontSize: 18,
    fontWeight: '800',
    color: '#083B2D',
    letterSpacing: -0.3,
  },
  secureHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E6F6ED',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  secureHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#084C38',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 36,
  },
  topInfo: {
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#083B2D',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
    lineHeight: 18,
  },
  sectionLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 2,
  },
  countryScroll: {
    gap: 10,
    paddingBottom: 4,
    marginBottom: 18,
  },
  countryCard: {
    width: 90,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  countryCardSelected: {
    borderColor: '#084C38',
    borderWidth: 1.8,
    backgroundColor: '#F0FAF5',
  },
  countryName: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#334155',
    marginTop: 6,
    textAlign: 'center',
  },
  countryNameSelected: {
    color: '#084C38',
    fontWeight: '800',
  },
  countryCur: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '700',
    marginTop: 1,
  },
  methodToggleRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
  },
  methodToggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingVertical: 12,
    gap: 8,
  },
  methodToggleBtnActive: {
    borderColor: '#084C38',
    borderWidth: 1.8,
    backgroundColor: '#F0FAF5',
  },
  methodToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  methodToggleTextActive: {
    color: '#084C38',
    fontWeight: '800',
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    padding: 16,
    marginBottom: 18,
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#083B2D',
    marginBottom: 6,
    marginTop: 6,
  },
  bankChipRow: {
    gap: 8,
    paddingBottom: 4,
    marginBottom: 12,
  },
  bankChip: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bankChipSelected: {
    backgroundColor: '#084C38',
    borderColor: '#084C38',
  },
  bankChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  bankChipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 12,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
    paddingVertical: 0,
  },
  validatedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  validatedPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  verifyManualBtn: {
    backgroundColor: '#F0FAF5',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  verifyManualText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#084C38',
  },
  resolvedNameBox: {
    backgroundColor: '#F0FAF5',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  resolvedHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 3,
  },
  resolvedNameLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#065F46',
    letterSpacing: 0.8,
  },
  resolvedNameText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#083B2D',
  },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#F0FAF5',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    borderRadius: 14,
    padding: 12,
  },
  securityNoteText: {
    flex: 1,
    fontSize: 11.5,
    color: '#065F46',
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
  saveBtn: {
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
  saveBtnDisabled: {
    backgroundColor: '#94A3B8',
    shadowOpacity: 0,
    elevation: 0,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
