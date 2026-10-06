import React, { useState } from 'react';
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
import {
  Ionicons,
  MaterialCommunityIcons,
} from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';

export default function LinkedAccountsScreen({ navigation }) {
  // Safe translation helper
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) {
      t = lang.t;
    }
  } catch (e) {
    console.log('LanguageContext fallback in LinkedAccountsScreen:', e);
  }

  const [defaultMethodId, setDefaultMethodId] = useState('bank-1');

  const bankAccounts = [
    {
      id: 'bank-1',
      name: 'Qatar National Bank (QNB)',
      accountNumber: '•••• •••• 8842',
      type: 'Salary / Current Account',
      isDefault: defaultMethodId === 'bank-1',
      bankIcon: 'bank',
    },
    {
      id: 'bank-2',
      name: 'Doha Bank',
      accountNumber: '•••• •••• 1209',
      type: 'Savings Account',
      isDefault: defaultMethodId === 'bank-2',
      bankIcon: 'bank',
    },
  ];

  const cards = [
    {
      id: 'card-1',
      name: 'Visa Platinum Debit',
      cardEnding: '•••• •••• 4490',
      expiry: '09/28',
      brand: 'VISA',
      isDefault: defaultMethodId === 'card-1',
    },
    {
      id: 'card-2',
      name: 'Mastercard World Elite',
      cardEnding: '•••• •••• 9102',
      expiry: '11/27',
      brand: 'MC',
      isDefault: defaultMethodId === 'card-2',
    },
  ];

  const handleAccountOptions = (account) => {
    Alert.alert(
      account.name,
      `Manage payment method (${account.accountNumber || account.cardEnding})`,
      [
        {
          text: 'Set as Default',
          onPress: () => {
            setDefaultMethodId(account.id);
            Alert.alert('Default Updated', `${account.name} is now your primary payment method.`);
          },
        },
        {
          text: 'Remove Method',
          style: 'destructive',
          onPress: () => Alert.alert('Removed', `${account.name} removed from your linked accounts.`),
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Screen Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation?.goBack && navigation.goBack()}
          style={styles.headerIconBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={22} color="#083B2D" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('linkedAccounts') || 'Linked Accounts'}</Text>
        <View style={styles.secureHeaderBadge}>
          <Ionicons name="shield-checkmark" size={13} color="#084C38" />
          <Text style={styles.secureHeaderText}>PCI Compliant</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Info Banner */}
        <View style={styles.infoBanner}>
          <Ionicons name="information-circle" size={20} color="#084C38" style={{ marginTop: 1 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.infoTitle}>Payment Methods Management</Text>
            <Text style={styles.infoDesc}>
              Link your local Qatari bank accounts and debit/credit cards for instant top-ups and wallet funding.
            </Text>
          </View>
        </View>

        {/* Section 1: Bank Accounts */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>{t('bankAccounts') || 'Bank Accounts'}</Text>
          <Text style={styles.countBadge}>{bankAccounts.length}</Text>
        </View>

        <View style={styles.cardsContainer}>
          {bankAccounts.map((b) => (
            <TouchableOpacity
              key={b.id}
              style={[styles.accountCard, b.isDefault && styles.accountCardSelected]}
              onPress={() => handleAccountOptions(b)}
              activeOpacity={0.8}
            >
              <View style={[styles.iconBox, b.isDefault && styles.iconBoxActive]}>
                <MaterialCommunityIcons name="bank" size={22} color="#084C38" />
              </View>

              <View style={styles.accountDetails}>
                <View style={styles.nameRow}>
                  <Text style={styles.accountName}>{b.name}</Text>
                  {b.isDefault && (
                    <View style={styles.defaultPill}>
                      <Text style={styles.defaultPillText}>{t('default') || 'Primary'}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.accountNumberText}>{b.accountNumber}</Text>
                <Text style={styles.accountSubtype}>{b.type}</Text>
              </View>

              <TouchableOpacity
                onPress={() => handleAccountOptions(b)}
                style={styles.moreIconBtn}
                activeOpacity={0.7}
              >
                <Ionicons name="ellipsis-vertical" size={18} color="#94A3B8" />
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </View>

        {/* Section 2: Debit & Credit Cards */}
        <View style={[styles.sectionHeaderRow, { marginTop: 16 }]}>
          <Text style={styles.sectionTitle}>{t('cards') || 'Debit & Credit Cards'}</Text>
          <Text style={styles.countBadge}>{cards.length}</Text>
        </View>

        <View style={styles.cardsContainer}>
          {cards.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[styles.accountCard, c.isDefault && styles.accountCardSelected]}
              onPress={() => handleAccountOptions(c)}
              activeOpacity={0.8}
            >
              <View style={[styles.iconBox, c.isDefault && styles.iconBoxActive]}>
                <MaterialCommunityIcons name="credit-card-outline" size={22} color="#084C38" />
              </View>

              <View style={styles.accountDetails}>
                <View style={styles.nameRow}>
                  <Text style={styles.accountName}>{c.name}</Text>
                  {c.isDefault && (
                    <View style={styles.defaultPill}>
                      <Text style={styles.defaultPillText}>{t('default') || 'Primary'}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.cardEndingText}>{c.cardEnding}</Text>
                <Text style={styles.accountSubtype}>Expires: {c.expiry} • 3D Secure</Text>
              </View>

              <TouchableOpacity
                onPress={() => handleAccountOptions(c)}
                style={styles.moreIconBtn}
                activeOpacity={0.7}
              >
                <Ionicons name="ellipsis-vertical" size={18} color="#94A3B8" />
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </View>

        {/* Add New Method Button */}
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => navigation?.navigate && navigation.navigate('AddCard')}
          activeOpacity={0.8}
        >
          <View style={styles.addIconCircle}>
            <Ionicons name="add" size={20} color="#084C38" />
          </View>
          <Text style={styles.addBtnText}>{t('addNewAccountCard') || 'Add New Account or Card'}</Text>
        </TouchableOpacity>

        {/* Security & Tokenization Guarantee */}
        <View style={styles.footerSecurityNote}>
          <MaterialCommunityIcons name="shield-check" size={17} color="#084C38" />
          <Text style={styles.footerSecurityText}>
            Card details are encrypted using tokenization and never stored on device.
          </Text>
        </View>
      </ScrollView>
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
  headerIconBtn: {
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
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F0FAF5',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    borderRadius: 16,
    padding: 14,
    marginBottom: 20,
    gap: 10,
  },
  infoTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#083B2D',
    marginBottom: 2,
  },
  infoDesc: {
    fontSize: 12,
    color: '#065F46',
    lineHeight: 17,
    fontWeight: '500',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#083B2D',
  },
  countBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  cardsContainer: {
    gap: 10,
    marginBottom: 10,
  },
  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  accountCardSelected: {
    borderColor: '#084C38',
    borderWidth: 1.8,
    backgroundColor: '#FFFFFF',
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  iconBoxActive: {
    backgroundColor: '#E6F6ED',
  },
  accountDetails: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  accountName: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  defaultPill: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  defaultPillText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#059669',
  },
  accountNumberText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    fontFamily: 'monospace',
  },
  cardEndingText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    fontFamily: 'monospace',
  },
  accountSubtype: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 2,
  },
  moreIconBtn: {
    padding: 6,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#084C38',
    borderStyle: 'dashed',
    borderRadius: 16,
    paddingVertical: 15,
    marginTop: 10,
    marginBottom: 16,
    gap: 8,
  },
  addIconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#E6F6ED',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addBtnText: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#084C38',
  },
  footerSecurityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  footerSecurityText: {
    fontSize: 11.5,
    color: '#94A3B8',
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 16,
  },
});
