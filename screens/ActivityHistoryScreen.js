import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  StatusBar,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Ionicons,
  MaterialIcons,
  Feather,
} from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';
import { Api } from '../services/api';
import { useFocusEffect } from '@react-navigation/native';

const GREEN = '#084C38';

// History is loaded from the API (GET /me/transfers) — no local records are kept.

export default function ActivityHistoryScreen({ navigation }) {
  // Safe translation helper
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) {
      t = lang.t;
    }
  } catch (e) {
    console.log('LanguageContext fallback in ActivityHistoryScreen:', e);
  }

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  /**
   * Load the customer's real transfer history. The API returns presentation
   * amounts (formatted strings + minor units) so this screen never does money
   * arithmetic on its own.
   */
  const loadHistory = async () => {
    try {
      setLoadError(null);
      const payload = await Api.transfers({ limit: 100 });
      setHistory((payload.transfers || []).map((transfer) => ({
        id: transfer.reference,
        reference: transfer.reference,
        type: 'sent',
        name: transfer.beneficiary?.name || 'Beneficiary',
        subtext: `${transfer.totals?.theyReceive || ''} · ${transfer.channel?.replace(/_/g, ' ') || ''}`,
        amount: transfer.totals?.totalDebit || '',
        payout: transfer.totals?.theyReceive || '',
        status: transfer.status,
        rate: transfer.totals?.rate,
        dateFormatted: new Date(transfer.initiatedAt).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
        }),
        raw: transfer,
      })));
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(React.useCallback(() => { loadHistory(); }, []));

  const filterTabs = [
    { id: 'all', label: 'All' },
    { id: 'sent', label: 'Transfers Out' },
    { id: 'received', label: 'Deposits In' },
  ];

  const filteredHistory = history.filter((item) => {
    const matchesFilter =
      filterType === 'all' || item.type === filterType;
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.reference || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.subtext.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.reference.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const handleExportStatement = () => {
    Alert.alert(
      'Export Statement',
      'Download your official monthly statement in PDF or CSV format.',
      [
        { text: 'Download PDF', onPress: () => Alert.alert('Downloaded', 'PDF statement saved to downloads.') },
        { text: 'Export CSV', onPress: () => Alert.alert('Exported', 'CSV statement exported.') },
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
        <Text style={styles.headerTitle}>{t('activityHistory') || 'Transaction History'}</Text>
        <TouchableOpacity
          onPress={handleExportStatement}
          style={styles.exportBtn}
          activeOpacity={0.7}
        >
          <Feather name="download" size={17} color="#084C38" />
        </TouchableOpacity>
      </View>

      {/* Search & Filter Section */}
      <View style={styles.filterSection}>
        {/* Search Bar */}
        <View style={styles.searchWrapper}>
          <Ionicons name="search-outline" size={18} color="#64748B" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('searchTransactions') || 'Search by recipient, bank or ref...'}
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={16} color="#94A3B8" />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter Chips */}
        <View style={styles.filterTabsRow}>
          {filterTabs.map((tab) => {
            const isActive = filterType === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.filterChip, isActive && styles.filterChipActive]}
                onPress={() => setFilterType(tab.id)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isActive && styles.filterChipTextActive,
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Activity List */}
      <FlatList
        data={filteredHistory}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.activityCard}
            onPress={() =>
              navigation?.navigate &&
              navigation.navigate('TransactionDetails', {
                amount: parseFloat(item.amount.replace(/[^0-9.]/g, '')),
                equivalent: item.equivalent.replace('= ', ''),
                recipient: {
                  name: item.name,
                  bankName: item.subtext,
                  flag: item.flag,
                  currency: item.flag === '🇳🇬' ? 'NGN' : (item.flag === '🇬🇭' ? 'GHS' : (item.flag === '🇰🇪' ? 'KES' : 'QAR')),
                },
                transactionId: item.reference,
                dateFormatted: item.date,
              })
            }
            activeOpacity={0.75}
          >
            {/* Type Indicator Icon */}
            <View
              style={[
                styles.iconWrapper,
                item.type === 'sent' ? styles.iconSentBg : styles.iconDepositBg,
              ]}
            >
              <MaterialIcons
                name={item.type === 'sent' ? 'arrow-outward' : 'arrow-downward'}
                size={20}
                color={item.type === 'sent' ? '#DC2626' : GREEN}
              />
            </View>

            {/* Details Column */}
            <View style={styles.detailsColumn}>
              <View style={styles.nameFlagRow}>
                <Text style={styles.nameText}>
                  {item.type === 'sent'
                    ? `${t('sentTo') || 'Sent to'} ${item.name}`
                    : item.name}
                </Text>
                <Text style={styles.flagEmoji}>{item.flag}</Text>
              </View>
              <Text style={styles.subtext}>{item.subtext}</Text>
              <View style={styles.dateStatusRow}>
                <Text style={styles.dateText}>{item.date}</Text>
                <View style={styles.statusPill}>
                  <Text style={styles.statusPillText}>
                    {t(item.status.toLowerCase()) || item.status}
                  </Text>
                </View>
              </View>
            </View>

            {/* Amounts Column */}
            <View style={styles.amountColumn}>
              <Text
                style={[
                  styles.amountQar,
                  item.type === 'sent' ? styles.amountSent : styles.amountDeposit,
                ]}
              >
                {item.amount}
              </Text>
              <Text style={styles.amountEquivalent}>{item.equivalent}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
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
  exportBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F0FAF5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D1FAE5',
  },
  filterSection: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    height: 46,
    marginBottom: 10,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13.5,
    color: '#0F172A',
    fontWeight: '600',
    paddingVertical: 0,
  },
  filterTabsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
  },
  filterChipActive: {
    backgroundColor: '#084C38',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  listContent: {
    padding: 18,
    gap: 10,
  },
  activityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 2,
  },
  iconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  iconSentBg: {
    backgroundColor: '#FEE2E2',
  },
  iconDepositBg: {
    backgroundColor: '#E6F6ED',
  },
  detailsColumn: {
    flex: 1,
    marginRight: 8,
  },
  nameFlagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  nameText: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  flagEmoji: {
    fontSize: 13,
  },
  subtext: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
    fontWeight: '500',
  },
  dateStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  dateText: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  statusPill: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  statusPillText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#059669',
  },
  amountColumn: {
    alignItems: 'flex-end',
  },
  amountQar: {
    fontSize: 14,
    fontWeight: '800',
  },
  amountSent: {
    color: '#DC2626',
  },
  amountDeposit: {
    color: GREEN,
  },
  amountEquivalent: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
});
