import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, StatusBar,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useWallet } from '../WalletContext';
import { useLanguage } from '../LanguageContext';
import { Api } from '../services/api';

const COLORS = {
  emerald: '#084C38', teal: '#083B2D', mint: '#A7F3D0', mintSoft: '#E6F6ED',
  gold: '#D97706', base: '#F8FAFC', white: '#FFFFFF', ink: '#0B1C15',
  muted: '#5F7A6E', line: '#E2ECE7', danger: '#B91C1C',
};

const CHANNEL_LABELS = {
  FLUTTERWAVE_BANK: 'Bank transfer',
  FLUTTERWAVE_MOBILE_MONEY: 'Mobile money',
  RIA_CASH_PICKUP: 'Cash pickup (Ria)',
};

export default function RecipientsScreen({ navigation }) {
  const { t } = useLanguage();
  const { beneficiaries, refresh } = useWallet();
  const [items, setItems] = useState(beneficiaries || []);
  const [loading, setLoading] = useState(!beneficiaries?.length);

  const load = useCallback(async () => {
    try {
      const payload = await Api.beneficiaries();
      setItems(payload.beneficiaries || []);
    } catch (err) {
      // Keep whatever we already had; the banner below explains the state.
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    refresh({ quiet: true }).catch(() => {});
  }, [load, refresh]));

  const remove = (item) => {
    Alert.alert(
      'Remove recipient?',
      `${item.fullName} will be removed from your saved recipients.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await Api.removeBeneficiary(item.id);
              setItems((current) => current.filter((entry) => entry.id !== item.id));
            } catch (err) {
              Alert.alert('Could not remove', err.message);
            }
          },
        },
      ],
    );
  };

  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{(item.fullName || '?').charAt(0).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{item.name || item.fullName}</Text>
        <Text style={styles.meta}>
          {item.institutionName || CHANNEL_LABELS[item.channel] || item.channel} · {item.accountMasked || 'cash pickup'}
        </Text>
        <View style={styles.tagRow}>
          <Text style={styles.tag}>{item.currency}</Text>
          <Text style={styles.tag}>{CHANNEL_LABELS[item.channel] || item.channel}</Text>
          {item.nameMatchScore !== null && item.nameMatchScore !== undefined && item.nameMatchScore < 60 ? (
            <Text style={[styles.tag, styles.tagWarn]}>name mismatch</Text>
          ) : null}
        </View>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => navigation.navigate('SendMoney', { beneficiary: item })}
        >
          <Ionicons name="paper-plane-outline" size={18} color={COLORS.emerald} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.navigate('EditBeneficiary', { beneficiary: item })}>
          <Ionicons name="create-outline" size={18} color={COLORS.emerald} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => remove(item)}>
          <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Ionicons name="arrow-back" size={22} color={COLORS.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('recipients') || 'Recipients'}</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('AddBeneficiary')}>
          <Ionicons name="add" size={20} color={COLORS.white} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={COLORS.emerald} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={load} tintColor={COLORS.emerald} />
          }
          ListEmptyComponent={(
            <View style={styles.empty}>
              <MaterialCommunityIcons name="account-plus-outline" size={44} color={COLORS.muted} />
              <Text style={styles.emptyTitle}>No recipients yet</Text>
              <Text style={styles.emptyText}>
                Add the account or mobile money number you send to. We verify the account holder's name
                with the bank before saving it.
              </Text>
              <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.navigate('AddBeneficiary')}>
                <Text style={styles.emptyBtnText}>Add a recipient</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.base },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.line,
  },
  back: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.base },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: COLORS.ink },
  addBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.emerald, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.white, borderRadius: 16,
    padding: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.line,
  },
  avatar: { width: 44, height: 44, borderRadius: 14, backgroundColor: COLORS.mintSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: COLORS.emerald, fontWeight: '800', fontSize: 17 },
  name: { fontSize: 15, fontWeight: '700', color: COLORS.ink },
  meta: { fontSize: 12.5, color: COLORS.muted, marginTop: 2 },
  tagRow: { flexDirection: 'row', gap: 6, marginTop: 7, flexWrap: 'wrap' },
  tag: { fontSize: 10.5, fontWeight: '700', color: COLORS.emerald, backgroundColor: COLORS.mintSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  tagWarn: { color: '#7C3E06', backgroundColor: '#FEF3C7' },
  actions: { flexDirection: 'row', gap: 6 },
  iconBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: COLORS.base, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', padding: 34, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.ink },
  emptyText: { fontSize: 13.5, color: COLORS.muted, textAlign: 'center', lineHeight: 20 },
  emptyBtn: { marginTop: 12, backgroundColor: COLORS.emerald, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { color: COLORS.white, fontWeight: '700' },
});
