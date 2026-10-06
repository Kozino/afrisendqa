import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  StatusBar,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Ionicons,
  MaterialIcons,
} from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';

const GREEN = '#084C38';

export default function NotificationsScreen({ navigation }) {
  // Translation hook
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) {
      t = lang.t;
    }
  } catch (e) {
    console.log('LanguageContext fallback in NotificationsScreen:', e);
  }

  // Notifications are derived from live transfer data (see useFocusEffect below).
;

  /**
   * Notifications are derived from the customer's real transfer history plus
   * wallet activity — there is no seeded list in the app.
   */
  const [notificationsList, setNotificationsList] = useState([]);
  const [loadingNotifications, setLoadingNotifications] = useState(true);

  useFocusEffect(React.useCallback(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await Api.transfers({ limit: 40 });
        if (cancelled) return;
        const mapped = (payload.transfers || []).map((transfer) => {
          const status = transfer.status;
          const copy = {
            PAID: { title: 'Transfer delivered', desc: `${transfer.totals?.theyReceive} was collected by ${transfer.beneficiary?.name}.` },
            PROCESSING: { title: 'Transfer on the way', desc: `${transfer.totals?.theyReceive} is being paid out to ${transfer.beneficiary?.name}.` },
            INITIATED: { title: 'Transfer submitted', desc: 'We are routing your payout to the partner network.' },
            AML_HOLD: { title: 'Compliance review', desc: 'A specialist is reviewing your transfer. We will update you within 24 hours — your money is safe.' },
            FAILED: { title: 'Transfer failed', desc: transfer.failureReason || 'The payout was rejected. The money has been returned to your wallet.' },
            REFUNDED: { title: 'Transfer refunded', desc: 'The funds are back in your AfriSend wallet.' },
            CANCELLED: { title: 'Transfer cancelled', desc: 'The funds have been returned to your wallet.' },
          }[status] || { title: 'Transfer update', desc: `Status: ${status}` };

          return {
            id: transfer.reference,
            type: status === 'PAID' ? 'success' : status === 'AML_HOLD' ? 'warning' : status === 'FAILED' ? 'error' : 'info',
            title: copy.title,
            desc: copy.desc,
            time: new Date(transfer.initiatedAt).toLocaleString('en-US', {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            }),
            read: status === 'PAID',
            reference: transfer.reference,
          };
        });
        setNotificationsList(mapped);
      } catch (err) {
        if (!cancelled) setNotificationsList([]);
      } finally {
        if (!cancelled) setLoadingNotifications(false);
      }
    })();
    return () => { cancelled = true; };
  }, []));
  const [activeFilter, setActiveFilter] = useState('all');

  const filterTabs = [
    { id: 'all', label: 'All' },
    { id: 'transfer', label: 'Transfers' },
    { id: 'rates', label: 'Rates & Promos' },
    { id: 'security', label: 'Security' },
  ];

  const filteredNotifications = notificationsList.filter((item) => {
    if (activeFilter === 'all') return true;
    return item.category === activeFilter;
  });

  const handleMarkAllRead = () => {
    setNotificationsList((prev) =>
      prev.map((item) => ({ ...item, isUnread: false }))
    );
    Alert.alert('Updated', 'All notifications marked as read.');
  };

  const handleNotificationPress = (item) => {
    // Mark clicked item as read
    setNotificationsList((prev) =>
      prev.map((n) => (n.id === item.id ? { ...n, isUnread: false } : n))
    );

    if (item.category === 'transfer') {
      navigation?.navigate && navigation.navigate('TransactionDetails');
    } else if (item.category === 'rates') {
      navigation?.navigate && navigation.navigate('SendMoney');
    } else if (item.category === 'wallet') {
      navigation?.navigate && navigation.navigate('FundWallet');
    } else if (item.category === 'security') {
      navigation?.navigate && navigation.navigate('Security');
    }
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
        <Text style={styles.headerTitle}>{t('notifications') || 'Notifications'}</Text>
        <TouchableOpacity
          onPress={handleMarkAllRead}
          style={styles.markReadBtn}
          activeOpacity={0.7}
        >
          <Text style={styles.markReadText}>{t('markAllRead') || 'Mark Read'}</Text>
        </TouchableOpacity>
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterRow}>
        {filterTabs.map((tab) => {
          const isActive = activeFilter === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.filterChip, isActive && styles.filterChipActive]}
              onPress={() => setActiveFilter(tab.id)}
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

      {/* Notifications List */}
      <FlatList
        data={filteredNotifications}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.notificationCard,
              item.isUnread && styles.notificationCardUnread,
            ]}
            onPress={() => handleNotificationPress(item)}
            activeOpacity={0.8}
          >
            {/* Category Icon */}
            <View style={[styles.iconWrapper, { backgroundColor: item.bgColor }]}>
              <MaterialIcons name={item.icon} size={22} color={item.iconColor} />
            </View>

            {/* Notification Content */}
            <View style={styles.cardTextContainer}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>
                  {t(item.titleKey) !== item.titleKey ? t(item.titleKey) : item.defaultTitle}
                </Text>
                {item.isUnread && <View style={styles.unreadDot} />}
              </View>
              <Text style={styles.desc}>
                {t(item.descKey) !== item.descKey ? t(item.descKey) : item.defaultDesc}
              </Text>
              <View style={styles.timeRow}>
                <Ionicons name="time-outline" size={12} color="#94A3B8" />
                <Text style={styles.time}>
                  {t(item.timeKey) !== item.timeKey ? t(item.timeKey) : item.defaultTime}
                </Text>
              </View>
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
  markReadBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#F0FAF5',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D1FAE5',
  },
  markReadText: {
    color: '#084C38',
    fontWeight: '700',
    fontSize: 12,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
  },
  filterChipActive: {
    backgroundColor: '#084C38',
  },
  filterChipText: {
    fontSize: 12.5,
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
  notificationCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 2,
  },
  notificationCardUnread: {
    borderColor: '#084C38',
    backgroundColor: '#FAFFFC',
  },
  iconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  cardTextContainer: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0F172A',
    flex: 1,
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#10B981',
    marginLeft: 6,
  },
  desc: {
    fontSize: 12.5,
    color: '#475569',
    lineHeight: 18,
    fontWeight: '500',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  time: {
    fontSize: 11.5,
    color: '#94A3B8',
    fontWeight: '500',
  },
});
