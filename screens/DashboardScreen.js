import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { useWallet } from '../WalletContext';
import { useAuth } from '../AuthContext';
import { useLanguage } from '../LanguageContext';
import { formatMoney } from '../services/api';

const COLORS = {
  emerald: '#084C38',
  teal: '#083B2D',
  deepTeal: '#06251A',
  mint: '#A7F3D0',
  mintSoft: '#E6F6ED',
  gold: '#D97706',
  base: '#F8FAFC',
  white: '#FFFFFF',
  ink: '#0B1C15',
  muted: '#5F7A6E',
  line: '#E2ECE7',
  danger: '#B91C1C',
};

const STATUS_STYLE = {
  PAID: { label: 'Delivered', color: '#047857', bg: '#E6F6ED' },
  PROCESSING: { label: 'On the way', color: '#1D4ED8', bg: '#EFF6FF' },
  INITIATED: { label: 'Sent to rail', color: '#1D4ED8', bg: '#EFF6FF' },
  AML_HOLD: { label: 'Under review', color: '#B45309', bg: '#FEF3C7' },
  FAILED: { label: 'Failed', color: '#B91C1C', bg: '#FEF2F2' },
  REFUNDED: { label: 'Refunded', color: '#475569', bg: '#F1F5F9' },
  CANCELLED: { label: 'Cancelled', color: '#475569', bg: '#F1F5F9' },
};

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardScreen({ navigation }) {
  const { t } = useLanguage();
  const { customer, refresh: refreshProfile } = useAuth();
  const {
    availableMinor, pendingMinor, balanceFormatted, transfers, beneficiaries, corridors,
    limits, refresh, loading,
  } = useWallet();

  const [showBalance, setShowBalance] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(useCallback(() => {
    refresh({ quiet: true }).catch(() => {});
    refreshProfile().catch(() => {});
  }, [refresh, refreshProfile]));

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refresh({ quiet: true }), refreshProfile()]);
    } catch {
      // The banner already reflects the failure; nothing else to do.
    } finally {
      setRefreshing(false);
    }
  };

  const recent = useMemo(() => (transfers || []).slice(0, 4), [transfers]);
  const quickSend = useMemo(() => (beneficiaries || []).slice(0, 5), [beneficiaries]);
  const ticker = useMemo(() => (corridors || []).filter((c) => c.active).slice(0, 6), [corridors]);
  const firstName = (customer?.fullName || '').split(' ')[0];
  const needsKyc = (customer?.kycTier ?? 0) < 1;

  const monthUsedMinor = limits?.monthToDateSentMinor ?? 0;
  const monthLimitMinor = limits?.monthlyLimitMinor ?? 1;
  const limitProgress = Math.min(100, Math.round((monthUsedMinor / Math.max(monthLimitMinor, 1)) * 100));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.teal} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.emerald} />}
        showsVerticalScrollIndicator={false}
      >
        {/* -------------------------------------------------- header */}
        <LinearGradient colors={[COLORS.deepTeal, COLORS.teal, COLORS.emerald]} style={styles.hero}>
          <View style={styles.topRow}>
            <View>
              <Text style={styles.greeting}>{t('welcomeBack') || greeting()}</Text>
              <Text style={styles.name}>{firstName || 'there'}</Text>
            </View>
            <View style={styles.topActions}>
              <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.navigate('Notifications')}>
                <Ionicons name="notifications-outline" size={19} color={COLORS.mint} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.avatar} onPress={() => navigation.navigate('Profile')}>
                <Text style={styles.avatarText}>{(firstName || 'A').charAt(0).toUpperCase()}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.balanceBlock}>
            <View style={styles.balanceHead}>
              <Text style={styles.balanceLabel}>{t('availableBalance') || 'Available balance'}</Text>
              <TouchableOpacity onPress={() => setShowBalance((value) => !value)} style={styles.eyeBtn}>
                <Feather name={showBalance ? 'eye' : 'eye-off'} size={15} color={COLORS.mint} />
              </TouchableOpacity>
            </View>
            <Text style={styles.balanceValue}>
              {showBalance ? balanceFormatted : '•••••'}
              <Text style={styles.balanceCurrency}> {t('currency') || 'QAR'}</Text>
            </Text>
            {pendingMinor > 0 ? (
              <Text style={styles.pending}>
                {showBalance ? formatMoney(pendingMinor) : '•••'} QAR pending (being reviewed)
              </Text>
            ) : null}
          </View>

          <View style={styles.heroActions}>
            <TouchableOpacity
              style={styles.heroAction}
              onPress={() => (needsKyc ? navigation.navigate('KYCVerification') : navigation.navigate('SendMoney'))}
            >
              <Ionicons name="paper-plane" size={17} color={COLORS.teal} />
              <Text style={styles.heroActionText}>{t('sendMoney') || 'Send'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.heroActionGhost} onPress={() => navigation.navigate('FundWallet')}>
              <Ionicons name="add-circle-outline" size={17} color={COLORS.mint} />
              <Text style={styles.heroActionGhostText}>{t('fundWallet') || 'Top up'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.heroActionGhost} onPress={() => navigation.navigate('Recipients')}>
              <Ionicons name="people-outline" size={17} color={COLORS.mint} />
              <Text style={styles.heroActionGhostText}>{t('recipients') || 'Recipients'}</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>

        {loading && !transfers.length ? (
          <View style={styles.loading}><ActivityIndicator color={COLORS.emerald} /></View>
        ) : null}

        {/* -------------------------------------------------- KYC banner */}
        {needsKyc ? (
          <TouchableOpacity style={styles.kycBanner} onPress={() => navigation.navigate('KYCVerification')}>
            <View style={styles.kycIcon}>
              <MaterialCommunityIcons name="shield-alert-outline" size={20} color={COLORS.gold} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.kycTitle}>{t('kycRequired') || 'Verify your identity to send money'}</Text>
              <Text style={styles.kycText}>
                Take two minutes to scan your QID — you can top up your wallet in the meantime.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.gold} />
          </TouchableOpacity>
        ) : null}

        {/* -------------------------------------------------- limits */}
        {limits ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>Monthly limit</Text>
              <Text style={styles.cardMeta}>Tier {customer?.kycTier ?? 0}</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${limitProgress}%` }]} />
            </View>
            <View style={styles.limitRow}>
              <Text style={styles.limitText}>
                {formatMoney(monthUsedMinor)} sent this month
              </Text>
              <Text style={styles.limitText}>
                {formatMoney(monthLimitMinor)} limit
              </Text>
            </View>
          </View>
        ) : null}

        {/* -------------------------------------------------- FX ticker */}
        {ticker.length ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>Today’s rates</Text>
              <TouchableOpacity onPress={() => navigation.navigate('SendMoney')}>
                <Text style={styles.link}>{t('seeAll') || 'Send money'}</Text>
              </TouchableOpacity>
            </View>
            {ticker.map((corridor) => (
              <View key={corridor.currency} style={styles.rateRow}>
                <Text style={styles.rateFlag}>{corridor.flag}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rateCountry}>{corridor.country}</Text>
                  <Text style={styles.rateMeta}>{corridor.currency} · {corridor.spreadPercent}% margin</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.rateValue}>{Number(corridor.retailRate).toFixed(corridor.currency === 'UGX' || corridor.currency === 'TZS' || corridor.currency === 'RWF' ? 0 : 2)}</Text>
                  <Text style={styles.rateMeta}>per 1 QAR</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* -------------------------------------------------- quick send */}
        {quickSend.length ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>Send again</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Recipients')}>
                <Text style={styles.link}>Manage</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
              {quickSend.map((person) => (
                <TouchableOpacity
                  key={person.id}
                  style={styles.quickItem}
                  onPress={() => navigation.navigate('SendMoney', { beneficiary: person })}
                >
                  <View style={styles.quickAvatar}>
                    <Text style={styles.quickInitial}>{(person.fullName || '?').charAt(0).toUpperCase()}</Text>
                  </View>
                  <Text style={styles.quickName} numberOfLines={1}>{(person.name || person.fullName || '').split(' ')[0]}</Text>
                  <Text style={styles.quickMeta}>{person.currency}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.quickItem} onPress={() => navigation.navigate('AddBeneficiary')}>
                <View style={[styles.quickAvatar, styles.quickAvatarAdd]}>
                  <Ionicons name="add" size={20} color={COLORS.emerald} />
                </View>
                <Text style={styles.quickName}>New</Text>
                <Text style={styles.quickMeta}>recipient</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        ) : null}

        {/* -------------------------------------------------- recent activity */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>{t('recentTransfers') || 'Recent transfers'}</Text>
            <TouchableOpacity onPress={() => navigation.navigate('ActivityHistory')}>
              <Text style={styles.link}>{t('seeAll') || 'See all'}</Text>
            </TouchableOpacity>
          </View>

          {recent.length === 0 ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="chart-timeline-variant" size={34} color={COLORS.muted} />
              <Text style={styles.emptyTitle}>{t('noTransfersYet') || 'No transfers yet'}</Text>
              <Text style={styles.emptyText}>
                Top up your wallet and send your first transfer — it will appear here with a live status.
              </Text>
              <TouchableOpacity
                style={styles.emptyBtn}
                onPress={() => navigation.navigate(needsKyc ? 'KYCVerification' : 'SendMoney')}
              >
                <Text style={styles.emptyBtnText}>{needsKyc ? 'Verify identity' : 'Send money'}</Text>
              </TouchableOpacity>
            </View>
          ) : recent.map((transfer) => {
            const style = STATUS_STYLE[transfer.status] || STATUS_STYLE.INITIATED;
            return (
              <TouchableOpacity
                key={transfer.reference}
                style={styles.txRow}
                onPress={() => navigation.navigate('TransactionDetails', { reference: transfer.reference })}
              >
                <View style={styles.txIcon}>
                  <Ionicons name="arrow-up" size={16} color={COLORS.emerald} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.txName} numberOfLines={1}>
                    {transfer.beneficiary?.name || 'Beneficiary'}
                  </Text>
                  <Text style={styles.txMeta}>
                    {transfer.totals?.theyReceive || `${transfer.payoutAmountMinor} ${transfer.payoutCurrency}`} · {new Date(transfer.initiatedAt).toLocaleDateString()}
                  </Text>
                  {transfer.status === 'AML_HOLD' ? (
                    <Text style={styles.txHold}>Compliance review — we will SMS you</Text>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.txAmount}>-{transfer.totals?.totalDebit || `${transfer.totalDebitQarMinor / 100}`}</Text>
                  <View style={[styles.statusPill, { backgroundColor: style.bg }]}>
                    <Text style={[styles.statusText, { color: style.color }]}>{style.label}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.trustRow}>
          <Ionicons name="shield-checkmark" size={14} color={COLORS.emerald} />
          <Text style={styles.trustText}>
            Regulated by the Qatar Central Bank · customer funds held in ring-fenced accounts
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.base },
  hero: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 22, borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greeting: { color: '#9FC9B9', fontSize: 12.5 },
  name: { color: '#FFFFFF', fontSize: 19, fontWeight: '800', letterSpacing: -0.3, marginTop: 2 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBtn: {
    width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(167,243,208,0.12)',
  },
  avatar: { width: 38, height: 38, borderRadius: 12, backgroundColor: COLORS.mint, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: COLORS.teal, fontWeight: '800' },
  balanceBlock: { marginTop: 24 },
  balanceHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  balanceLabel: { color: '#9FC9B9', fontSize: 12.5, fontWeight: '600' },
  eyeBtn: { padding: 4 },
  balanceValue: { color: '#FFFFFF', fontSize: 34, fontWeight: '800', letterSpacing: -1, marginTop: 4 },
  balanceCurrency: { fontSize: 15, fontWeight: '600', color: '#9FC9B9' },
  pending: { color: COLORS.mint, fontSize: 12, marginTop: 6 },
  heroActions: { flexDirection: 'row', gap: 10, marginTop: 22 },
  heroAction: {
    flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.mint, height: 46, borderRadius: 13,
  },
  heroActionText: { color: COLORS.teal, fontWeight: '800', fontSize: 13.5 },
  heroActionGhost: {
    flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(167,243,208,0.12)', height: 46, borderRadius: 13,
  },
  heroActionGhostText: { color: COLORS.mint, fontWeight: '700', fontSize: 13 },
  loading: { padding: 20, alignItems: 'center' },
  kycBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFBEB', borderWidth: 1,
    borderColor: '#FDE68A', marginHorizontal: 16, marginTop: 16, borderRadius: 14, padding: 14,
  },
  kycIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center' },
  kycTitle: { fontSize: 13.5, fontWeight: '800', color: '#92400E' },
  kycText: { fontSize: 12, color: '#A16207', marginTop: 3, lineHeight: 17 },
  card: {
    backgroundColor: COLORS.white, marginHorizontal: 16, marginTop: 14, borderRadius: 16,
    padding: 16, borderWidth: 1, borderColor: COLORS.line,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  cardTitle: { fontSize: 14.5, fontWeight: '800', color: COLORS.ink },
  cardMeta: { fontSize: 12, color: COLORS.muted, fontWeight: '600' },
  link: { color: COLORS.emerald, fontWeight: '700', fontSize: 12.5 },
  track: { height: 8, backgroundColor: '#EEF4F1', borderRadius: 999, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: COLORS.emerald, borderRadius: 999 },
  limitRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  limitText: { fontSize: 11.5, color: COLORS.muted },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F1F6F3' },
  rateFlag: { fontSize: 20 },
  rateCountry: { fontSize: 13.5, fontWeight: '700', color: COLORS.ink },
  rateMeta: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  rateValue: { fontSize: 15, fontWeight: '800', color: COLORS.emerald, fontVariant: ['tabular-nums'] },
  quickItem: { alignItems: 'center', width: 68 },
  quickAvatar: { width: 50, height: 50, borderRadius: 17, backgroundColor: COLORS.mintSoft, alignItems: 'center', justifyContent: 'center' },
  quickAvatarAdd: { backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: COLORS.line, borderStyle: 'dashed' },
  quickInitial: { color: COLORS.emerald, fontWeight: '800', fontSize: 18 },
  quickName: { fontSize: 12, fontWeight: '700', color: COLORS.ink, marginTop: 7, maxWidth: 66, textAlign: 'center' },
  quickMeta: { fontSize: 10.5, color: COLORS.muted },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#F1F6F3' },
  txIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: COLORS.mintSoft, alignItems: 'center', justifyContent: 'center' },
  txName: { fontSize: 13.5, fontWeight: '700', color: COLORS.ink },
  txMeta: { fontSize: 11.5, color: COLORS.muted, marginTop: 2 },
  txHold: { fontSize: 11, color: COLORS.gold, marginTop: 3, fontWeight: '600' },
  txAmount: { fontSize: 13.5, fontWeight: '800', color: COLORS.ink, fontVariant: ['tabular-nums'] },
  statusPill: { marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  statusText: { fontSize: 10, fontWeight: '800' },
  empty: { alignItems: 'center', paddingVertical: 18, gap: 6 },
  emptyTitle: { fontSize: 14.5, fontWeight: '700', color: COLORS.ink },
  emptyText: { fontSize: 12.5, color: COLORS.muted, textAlign: 'center', lineHeight: 18, paddingHorizontal: 10 },
  emptyBtn: { marginTop: 10, backgroundColor: COLORS.emerald, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 12 },
  emptyBtnText: { color: COLORS.white, fontWeight: '700', fontSize: 13 },
  trustRow: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 20, paddingHorizontal: 24 },
  trustText: { fontSize: 10.5, color: COLORS.muted, textAlign: 'center', flex: 1, lineHeight: 15 },
});
