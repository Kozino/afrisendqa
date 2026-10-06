import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, StatusBar,
  ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Api } from '../services/api';
import { useWallet } from '../WalletContext';

const COLORS = {
  emerald: '#084C38', teal: '#083B2D', mint: '#A7F3D0', mintSoft: '#E6F6ED',
  gold: '#D97706', base: '#F8FAFC', white: '#FFFFFF', ink: '#0B1C15',
  muted: '#5F7A6E', line: '#E2ECE7', danger: '#B91C1C',
};

/**
 * A saved recipient's account number and institution are immutable — changing
 * them silently is exactly how account-substitution fraud happens. To change
 * the destination the recipient must be re-added, which re-runs the bank name
 * check. Only the display nickname is editable here.
 */
export default function EditBeneficiaryScreen({ navigation, route }) {
  const beneficiary = route?.params?.beneficiary || {};
  const { refresh } = useWallet();
  const [nickname, setNickname] = useState(beneficiary.name || beneficiary.fullName || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      // Re-adding with the same account refreshes the nickname and re-runs the
      // provider name resolution, so the stored data can never drift.
      await Api.addBeneficiary({
        fullName: beneficiary.fullName,
        nickname: nickname.trim() || undefined,
        countryCode: beneficiary.countryCode,
        currency: beneficiary.currency,
        channel: beneficiary.channel,
        institutionCode: beneficiary.institutionCode,
        institutionName: beneficiary.institutionName,
        accountNumber: beneficiary.accountNumber || beneficiary.accountMasked,
      });
      await refresh({ quiet: true });
      navigation.goBack();
    } catch (err) {
      Alert.alert('Could not update', err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    Alert.alert('Remove recipient?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await Api.removeBeneficiary(beneficiary.id);
            await refresh({ quiet: true });
            navigation.goBack();
          } catch (err) {
            Alert.alert('Could not remove', err.message);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Ionicons name="arrow-back" size={22} color={COLORS.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit recipient</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <View style={styles.card}>
          <Text style={styles.label}>Display name</Text>
          <TextInput
            style={styles.input}
            value={nickname}
            onChangeText={setNickname}
            placeholder="e.g. Mum — Lagos"
            placeholderTextColor={COLORS.muted}
          />

          <Text style={[styles.label, { marginTop: 18 }]}>Account holder</Text>
          <View style={styles.readonly}>
            <Text style={styles.readonlyText}>{beneficiary.fullName || '—'}</Text>
            <Ionicons name="lock-closed" size={14} color={COLORS.muted} />
          </View>

          <Text style={[styles.label, { marginTop: 18 }]}>Destination</Text>
          <View style={styles.readonly}>
            <Text style={styles.readonlyText}>
              {beneficiary.institutionName || beneficiary.channel} · {beneficiary.accountMasked || 'cash pickup'}
            </Text>
            <Ionicons name="lock-closed" size={14} color={COLORS.muted} />
          </View>
          <Text style={styles.note}>
            For your protection the account number cannot be edited. To pay a different account, add a new
            recipient — AfriSend verifies the account holder's name with the bank every time.
          </Text>
        </View>

        <TouchableOpacity style={styles.cta} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.ctaText}>Save changes</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={styles.dangerBtn} onPress={remove}>
          <Ionicons name="trash-outline" size={17} color={COLORS.danger} />
          <Text style={styles.dangerText}>Remove recipient</Text>
        </TouchableOpacity>
      </ScrollView>
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
  headerTitle: { fontSize: 18, fontWeight: '700', color: COLORS.ink },
  card: { backgroundColor: COLORS.white, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.line },
  label: { fontSize: 12.5, fontWeight: '700', color: COLORS.muted, marginBottom: 8 },
  input: {
    borderWidth: 1, borderColor: COLORS.line, borderRadius: 12, paddingHorizontal: 14, height: 50,
    fontSize: 15, color: COLORS.ink, backgroundColor: COLORS.base,
  },
  readonly: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.base, borderRadius: 12, paddingHorizontal: 14, height: 50,
  },
  readonlyText: { fontSize: 14.5, color: COLORS.ink, fontWeight: '600' },
  note: { fontSize: 12, color: COLORS.muted, lineHeight: 18, marginTop: 10 },
  cta: { backgroundColor: COLORS.emerald, height: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  ctaText: { color: COLORS.white, fontWeight: '800', fontSize: 15.5 },
  dangerBtn: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    height: 52, borderRadius: 14, borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FEF2F2', marginTop: 12,
  },
  dangerText: { color: COLORS.danger, fontWeight: '700' },
});
