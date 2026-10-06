import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StatusBar,
  Switch,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';

export default function AddCardScreen({ navigation, route }) {
  // Safe translation helper
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) {
      t = lang.t;
    }
  } catch (e) {
    // Fallback if LanguageContext is not loaded
  }

  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [cardHolder, setCardHolder] = useState('AMARA OKAFOR');
  const [saveCard, setSaveCard] = useState(true);

  // Amount passed from FundWalletScreen
  const amount = route?.params?.amount || 500;

  // Format Card Number into 4-digit chunks (#### #### #### ####)
  const handleCardNumberChange = (text) => {
    const cleaned = text.replace(/\D/g, '').slice(0, 16);
    const formatted = cleaned.match(/.{1,4}/g)?.join(' ') || cleaned;
    setCardNumber(formatted);
  };

  // Format Expiry Date (MM/YY)
  const handleExpiryChange = (text) => {
    const cleaned = text.replace(/\D/g, '').slice(0, 4);
    if (cleaned.length >= 3) {
      setExpiry(`${cleaned.slice(0, 2)}/${cleaned.slice(2, 4)}`);
    } else {
      setExpiry(cleaned);
    }
  };

  // Format CVV (max 3-4 digits)
  const handleCvvChange = (text) => {
    const cleaned = text.replace(/\D/g, '').slice(0, 4);
    setCvv(cleaned);
  };

  // Detect card type (Visa, Mastercard, etc.)
  const getCardType = () => {
    const clean = cardNumber.replace(/\s/g, '');
    if (clean.startsWith('4')) return 'visa';
    if (/^(5[1-5]|2[2-7])/.test(clean)) return 'mastercard';
    return 'generic';
  };

  const handleProceed = () => {
    if (!cardNumber || cardNumber.replace(/\s/g, '').length < 16) {
      alert("Please enter a valid 16-digit card number");
      return;
    }
    if (!expiry || expiry.length < 5) {
      alert("Please enter a valid expiry date (MM/YY)");
      return;
    }
    if (!cvv || cvv.length < 3) {
      alert("Please enter a valid CVV");
      return;
    }

    // Navigate to Otp screen with amount and card metadata
    if (navigation?.navigate) {
      navigation.navigate('Otp', {
        amount: amount,
        cardNumber: cardNumber.slice(-4),
        cardHolder: cardHolder,
      });
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
        <Text style={styles.headerTitle}>{t('addCard') || 'Add New Card'}</Text>
        <View style={styles.headerRightBadge}>
          <Ionicons name="shield-checkmark" size={14} color="#10B981" />
          <Text style={styles.sslText}>Secure SSL</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Amount Summary Tag */}
        <View style={styles.amountBadgeContainer}>
          <Text style={styles.amountBadgeLabel}>{t('fundingAmount') || 'Funding Amount:'}</Text>
          <Text style={styles.amountBadgeValue}>
            {parseFloat(amount).toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{' '}
            <Text style={styles.amountBadgeCurrency}>QAR</Text>
          </Text>
        </View>

        {/* Professional Fintech Card Preview */}
        <View style={styles.cardPreviewContainer}>
          <View style={styles.cardPreview}>
            {/* Background Decorative Rings */}
            <View style={styles.cardCircleOverlay1} />
            <View style={styles.cardCircleOverlay2} />

            {/* Top Row: Chip, Contactless & Card Brand */}
            <View style={styles.cardTopRow}>
              <View style={styles.chipAndNfc}>
                {/* Gold EMV Chip */}
                <View style={styles.cardChip}>
                  <View style={styles.chipLine1} />
                  <View style={styles.chipLine2} />
                  <View style={styles.chipInner} />
                </View>
                <MaterialCommunityIcons
                  name="contactless-payment"
                  size={24}
                  color="#A7F3D0"
                  style={styles.nfcIcon}
                />
              </View>

              {/* Card Brand Badge */}
              <View style={styles.brandBadge}>
                {getCardType() === 'mastercard' ? (
                  <View style={styles.mastercardCircles}>
                    <View style={[styles.mcCircle, { backgroundColor: '#EB001B' }]} />
                    <View style={[styles.mcCircle, { backgroundColor: '#F79E1B', marginLeft: -8 }]} />
                  </View>
                ) : (
                  <Text style={styles.visaText}>VISA</Text>
                )}
              </View>
            </View>

            {/* Middle Row: Card Number */}
            <View style={styles.cardNumberContainer}>
              <Text style={styles.cardNumberText}>
                {cardNumber || '••••  ••••  ••••  ••••'}
              </Text>
            </View>

            {/* Bottom Row: Card Holder & Expiry */}
            <View style={styles.cardBottomRow}>
              <View style={styles.cardHolderBlock}>
                <Text style={styles.cardMiniLabel}>{t('cardHolder') || 'CARD HOLDER'}</Text>
                <Text style={styles.cardHolderValue} numberOfLines={1}>
                  {(cardHolder || 'CARD HOLDER NAME').toUpperCase()}
                </Text>
              </View>

              <View style={styles.cardExpiryBlock}>
                <Text style={styles.cardMiniLabel}>{t('expires') || 'EXPIRES'}</Text>
                <Text style={styles.cardExpiryValue}>{expiry || 'MM/YY'}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Input Form Section */}
        <View style={styles.formContainer}>
          {/* Card Number Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('cardNumber') || 'Card Number'}</Text>
            <View style={styles.inputWrapper}>
              <MaterialCommunityIcons
                name="credit-card-outline"
                size={20}
                color="#084C38"
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                placeholder="1234  5678  9012  3456"
                placeholderTextColor="#9CA3AF"
                keyboardType="numeric"
                maxLength={19}
                value={cardNumber}
                onChangeText={handleCardNumberChange}
              />
              {cardNumber.length > 0 && (
                <TouchableOpacity onPress={() => setCardNumber('')}>
                  <Ionicons name="close-circle" size={18} color="#9CA3AF" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Expiry & CVV Row */}
          <View style={styles.row}>
            {/* Expiry Date */}
            <View style={[styles.inputGroup, { flex: 1, marginRight: 12 }]}>
              <Text style={styles.label}>{t('expiryDate') || 'Expiry Date'}</Text>
              <View style={styles.inputWrapper}>
                <Ionicons
                  name="calendar-outline"
                  size={18}
                  color="#084C38"
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="MM/YY"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="numeric"
                  maxLength={5}
                  value={expiry}
                  onChangeText={handleExpiryChange}
                />
              </View>
            </View>

            {/* CVV */}
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <View style={styles.labelWithInfo}>
                <Text style={styles.label}>CVV / CVC</Text>
                <Ionicons name="information-circle-outline" size={14} color="#6B7280" />
              </View>
              <View style={styles.inputWrapper}>
                <Ionicons
                  name="lock-closed-outline"
                  size={18}
                  color="#084C38"
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="123"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="numeric"
                  maxLength={4}
                  secureTextEntry
                  value={cvv}
                  onChangeText={handleCvvChange}
                />
              </View>
            </View>
          </View>

          {/* Card Holder Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('cardHolder') || 'Cardholder Name'}</Text>
            <View style={styles.inputWrapper}>
              <Ionicons
                name="person-outline"
                size={18}
                color="#084C38"
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                placeholder="AMARA OKAFOR"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="characters"
                value={cardHolder}
                onChangeText={setCardHolder}
              />
            </View>
          </View>

          {/* Save Card Toggle Switch */}
          <View style={styles.saveCardContainer}>
            <View style={styles.saveCardTextWrapper}>
              <Text style={styles.saveCardTitle}>
                {t('saveCardTitle') || 'Save card securely'}
              </Text>
              <Text style={styles.saveCardSubtitle}>
                {t('saveCardDesc') || 'For faster checkout next time'}
              </Text>
            </View>
            <Switch
              value={saveCard}
              onValueChange={setSaveCard}
              trackColor={{ false: '#E2E8F0', true: '#A7F3D0' }}
              thumbColor={saveCard ? '#084C38' : '#94A3B8'}
            />
          </View>
        </View>
      </ScrollView>

      {/* Footer Actions */}
      <View style={styles.footer}>
        {/* Security / PCI Banner */}
        <View style={styles.pciRow}>
          <Ionicons name="lock-closed" size={13} color="#6B7280" />
          <Text style={styles.pciText}>
            PCI-DSS Compliant • 256-Bit Bank Grade Encryption
          </Text>
        </View>

        {/* Primary Save & Pay Button */}
        <TouchableOpacity
          style={styles.button}
          onPress={handleProceed}
          activeOpacity={0.85}
        >
          <Text style={styles.buttonText}>
            {t('saveAndPay') || 'Save & Pay'} • QAR{' '}
            {parseFloat(amount).toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
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
  headerRightBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  sslText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  amountBadgeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F0FAF5',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    marginBottom: 20,
  },
  amountBadgeLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#065F46',
  },
  amountBadgeValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#083B2D',
  },
  amountBadgeCurrency: {
    fontSize: 13,
    fontWeight: '700',
    color: '#047857',
  },

  /* Luxury Card Preview */
  cardPreviewContainer: {
    marginBottom: 26,
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 8,
  },
  cardPreview: {
    backgroundColor: '#084C38',
    borderRadius: 22,
    padding: 22,
    height: 205,
    justifyContent: 'space-between',
    position: 'relative',
    overflow: 'hidden',
  },
  cardCircleOverlay1: {
    position: 'absolute',
    right: -40,
    top: -40,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  cardCircleOverlay2: {
    position: 'absolute',
    right: 20,
    bottom: -60,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(167, 243, 208, 0.08)',
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chipAndNfc: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardChip: {
    width: 42,
    height: 32,
    backgroundColor: '#E2B155',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#C69437',
    position: 'relative',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipLine1: {
    position: 'absolute',
    width: '100%',
    height: 1,
    backgroundColor: '#9A7120',
  },
  chipLine2: {
    position: 'absolute',
    height: '100%',
    width: 1,
    backgroundColor: '#9A7120',
  },
  chipInner: {
    width: 18,
    height: 14,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#9A7120',
    backgroundColor: '#E9BE6C',
  },
  nfcIcon: {
    opacity: 0.85,
  },
  brandBadge: {
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  visaText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 1.5,
  },
  mastercardCircles: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  mcCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    opacity: 0.9,
  },
  cardNumberContainer: {
    marginVertical: 4,
  },
  cardNumberText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 2.2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    textShadowColor: 'rgba(0, 0, 0, 0.25)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  cardBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  cardHolderBlock: {
    flex: 1,
    marginRight: 10,
  },
  cardMiniLabel: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#A7F3D0',
    letterSpacing: 1.1,
    marginBottom: 4,
  },
  cardHolderValue: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  cardExpiryBlock: {
    alignItems: 'flex-end',
  },
  cardExpiryValue: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
  },

  /* Form Elements */
  formContainer: {
    gap: 16,
  },
  inputGroup: {},
  label: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#083B2D',
    marginBottom: 8,
  },
  labelWithInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    height: 52,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    paddingVertical: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  saveCardContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  saveCardTextWrapper: {
    flex: 1,
    marginRight: 10,
  },
  saveCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#083B2D',
  },
  saveCardSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },

  /* Footer */
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  pciRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
  },
  pciText: {
    fontSize: 11.5,
    color: '#64748B',
    fontWeight: '500',
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
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  btnIcon: {
    marginLeft: 8,
  },
});
