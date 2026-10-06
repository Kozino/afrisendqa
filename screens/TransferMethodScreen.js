import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Ionicons,
  MaterialIcons,
  MaterialCommunityIcons,
} from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';

const GREEN = '#084C38';
const DARK_TEAL = '#083B2D';

export default function TransferMethodScreen({ navigation, route }) {
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) t = lang.t;
  } catch (e) {
    console.log('LanguageContext fallback:', e);
  }

  const [selectedMethod, setSelectedMethod] = useState('bank'); // 'bank', 'mobile', 'cash_pickup'

  const methods = [
    {
      id: 'bank',
      title: 'Bank Account Deposit',
      subtitle: 'Direct NIP deposit to 30+ commercial banks',
      speed: 'Instant (2-5 mins)',
      badge: 'Most Popular',
      iconType: 'bank',
      iconName: 'bank',
      provider: 'Powered by Flutterwave',
    },
    {
      id: 'mobile',
      title: 'Mobile Money Wallet',
      subtitle: 'MTN MoMo, Safaricom M-Pesa, Wave, Airtel Money',
      speed: 'Instant (Within 1 min)',
      badge: 'Zero Fee',
      iconType: 'mobile',
      iconName: 'phone-portrait-outline',
      provider: 'Powered by Flutterwave',
    },
    {
      id: 'cash_pickup',
      title: 'Physical Cash Pickup',
      subtitle: 'Claim physical cash at 500,000+ local agent branches with ID & PIN',
      speed: 'Available in 10 mins',
      badge: '500k+ Locations',
      iconType: 'cash',
      iconName: 'cash-multiple',
      provider: 'Powered by Ria Money Transfer',
    },
  ];

  const handleProceed = () => {
    navigation.navigate('SendMoney', {
      transferMethod: selectedMethod,
    });
  };

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
        <Text style={styles.headerTitle}>{t('transferMethod') || 'Select Payout Channel'}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.topInfo}>
          <Text style={styles.title}>How should the recipient receive the funds?</Text>
          <Text style={styles.subtitle}>
            Choose between direct bank deposit, mobile money wallet, or physical cash collection across Africa.
          </Text>
        </View>

        {/* Method Cards */}
        <View style={styles.methodsList}>
          {methods.map((m) => {
            const isSelected = selectedMethod === m.id;
            return (
              <TouchableOpacity
                key={m.id}
                style={[styles.methodCard, isSelected && styles.methodCardSelected]}
                onPress={() => setSelectedMethod(m.id)}
                activeOpacity={0.8}
              >
                <View style={[styles.iconBox, isSelected && styles.iconBoxSelected]}>
                  {m.iconType === 'bank' && <MaterialCommunityIcons name="bank" size={22} color="#084C38" />}
                  {m.iconType === 'mobile' && <Ionicons name="phone-portrait-outline" size={22} color="#084C38" />}
                  {m.iconType === 'cash' && <MaterialCommunityIcons name="cash-multiple" size={22} color="#084C38" />}
                </View>

                <View style={styles.methodInfo}>
                  <View style={styles.methodTitleRow}>
                    <Text style={styles.methodTitle}>{m.title}</Text>
                    <View style={styles.speedBadge}>
                      <Text style={styles.speedText}>{m.speed}</Text>
                    </View>
                  </View>
                  <Text style={styles.methodSubtitle}>{m.subtitle}</Text>
                  <Text style={styles.providerTag}>{m.provider}</Text>
                </View>

                <View style={styles.radioOuter}>
                  {isSelected && <View style={styles.radioInner} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Security / Compliance Guarantee */}
        <View style={styles.securityNote}>
          <MaterialIcons name="security" size={18} color="#084C38" />
          <Text style={styles.securityText}>
            All transfer channels are regulated under Qatar Central Bank international remittance compliance.
          </Text>
        </View>
      </ScrollView>

      {/* Footer Action */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.continueBtn}
          onPress={handleProceed}
          activeOpacity={0.85}
        >
          <Text style={styles.continueBtnText}>Continue to Amount</Text>
          <Ionicons name="arrow-forward" size={18} color="#FFFFFF" style={{ marginLeft: 8 }} />
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
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 36,
  },
  topInfo: {
    marginBottom: 20,
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
    marginTop: 6,
    lineHeight: 18,
  },
  methodsList: {
    gap: 12,
    marginBottom: 20,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  methodCardSelected: {
    borderColor: '#084C38',
    borderWidth: 1.8,
    backgroundColor: '#F0FAF5',
  },
  iconBox: {
    width: 46,
    height: 46,
    borderRadius: 13,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  iconBoxSelected: {
    backgroundColor: '#E6F6ED',
  },
  methodInfo: {
    flex: 1,
    marginRight: 10,
  },
  methodTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  methodTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  speedBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  speedText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#059669',
  },
  methodSubtitle: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
  },
  providerTag: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#084C38',
    marginTop: 4,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#084C38',
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
  securityText: {
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
  continueBtn: {
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
  continueBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
