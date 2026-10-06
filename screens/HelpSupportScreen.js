import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar, ScrollView, Linking, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../AuthContext';

const COLORS = {
  emerald: '#084C38', teal: '#083B2D', mint: '#A7F3D0', mintSoft: '#E6F6ED',
  gold: '#D97706', base: '#F8FAFC', white: '#FFFFFF', ink: '#0B1C15',
  muted: '#5F7A6E', line: '#E2ECE7',
};

const FAQ = [
  {
    q: 'Why is my transfer on hold?',
    a: 'Transfers above the review threshold, transfers to a new beneficiary, and any name that needs a second look are held automatically. An analyst reviews them — the money is already out of your wallet and quarantined, not lost. You are notified when it is released.',
  },
  {
    q: 'How long does a payout take?',
    a: 'Bank and mobile money payouts (Nigeria, Ghana, Kenya, Uganda, Tanzania, Rwanda, Egypt) usually land within minutes. Cash pickup through Ria is ready for collection within one hour. Every transfer shows its live status in Activity.',
  },
  {
    q: 'What are my monthly limits?',
    a: 'Tier 1 (ID only): 20,000 QAR per month. Tier 2 (QID + address): 500,000 QAR. Tier 3 (enhanced due diligence): 1,000,000 QAR. Your available limit is shown on the wallet screen.',
  },
  {
    q: 'The bank account name does not match my recipient',
    a: 'We resolve the account holder name with the bank before saving a recipient. If the returned name differs from what you typed, check the account number — sending to a mistyped account cannot be reversed.',
  },
  {
    q: 'How is the exchange rate set?',
    a: 'AfriSend publishes a retail rate for each corridor. The rate you see on the review screen is locked for 90 seconds and is the rate that is booked, even if the market moves while you confirm.',
  },
  {
    q: 'What do you do with my QID?',
    a: 'Your QID number and address are encrypted with AES-256 at rest. Staff see only the last four digits. Documents are retained for 10 years as required by QCB record-keeping rules and are never shared with payout partners.',
  },
];

export default function HelpSupportScreen({ navigation }) {
  const { customer } = useAuth();
  const [open, setOpen] = useState(0);

  const openUrl = (url) => Linking.openURL(url).catch(() => Alert.alert('Could not open', url));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Ionicons name="arrow-back" size={22} color={COLORS.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Help &amp; support</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <View style={styles.contactGrid}>
          <TouchableOpacity style={styles.contact} onPress={() => openUrl('mailto:support@afrisend.qa')}>
            <Ionicons name="mail-outline" size={20} color={COLORS.emerald} />
            <Text style={styles.contactTitle}>Email</Text>
            <Text style={styles.contactText}>support@afrisend.qa</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.contact} onPress={() => openUrl('tel:+97444000000')}>
            <Ionicons name="call-outline" size={20} color={COLORS.emerald} />
            <Text style={styles.contactTitle}>Call</Text>
            <Text style={styles.contactText}>+974 4400 0000</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.contact} onPress={() => openUrl('https://wa.me/97444000000')}>
            <MaterialCommunityIcons name="whatsapp" size={20} color={COLORS.emerald} />
            <Text style={styles.contactTitle}>WhatsApp</Text>
            <Text style={styles.contactText}>Fastest replies</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.hours}>
          <Ionicons name="time-outline" size={16} color={COLORS.emerald} />
          <Text style={styles.hoursText}>
            Support is open 24/7 for transfer issues. Compliance questions are answered Sunday–Thursday, 08:00–17:00 Doha time.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Frequently asked</Text>
        {FAQ.map((item, index) => {
          const isOpen = open === index;
          return (
            <TouchableOpacity
              key={item.q}
              style={styles.faq}
              activeOpacity={0.8}
              onPress={() => setOpen(isOpen ? -1 : index)}
            >
              <View style={styles.faqHead}>
                <Text style={styles.faqQ}>{item.q}</Text>
                <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.muted} />
              </View>
              {isOpen ? <Text style={styles.faqA}>{item.a}</Text> : null}
            </TouchableOpacity>
          );
        })}

        <Text style={styles.sectionTitle}>Your account</Text>
        <View style={styles.card}>
          <Row label="Customer reference" value={customer?.reference || '—'} />
          <Row label="KYC tier" value={customer?.kycTier !== undefined ? `Tier ${customer.kycTier}` : '—'} />
          <Row label="Account status" value={customer?.status || '—'} />
          <Row label="Registered phone" value={customer?.phone || '—'} />
        </View>

        <TouchableOpacity
          style={styles.report}
          onPress={() => openUrl('mailto:complaints@afrisend.qa?subject=Complaint')}
        >
          <Ionicons name="warning-outline" size={17} color={COLORS.gold} />
          <Text style={styles.reportText}>
            Raise a formal complaint — acknowledged within 24 hours and resolved within 30 days, as required by the QCB.
            Unresolved complaints can be escalated to the Qatar Central Bank.
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
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
  contactGrid: { flexDirection: 'row', gap: 10 },
  contact: {
    flex: 1, backgroundColor: COLORS.white, borderRadius: 14, padding: 14, gap: 6,
    borderWidth: 1, borderColor: COLORS.line, alignItems: 'flex-start',
  },
  contactTitle: { fontSize: 12.5, fontWeight: '700', color: COLORS.ink },
  contactText: { fontSize: 11, color: COLORS.muted, lineHeight: 15 },
  hours: { flexDirection: 'row', gap: 10, backgroundColor: COLORS.mintSoft, borderRadius: 14, padding: 14, marginTop: 14 },
  hoursText: { flex: 1, fontSize: 12, color: '#065F46', lineHeight: 18 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: COLORS.ink, marginTop: 22, marginBottom: 10 },
  faq: { backgroundColor: COLORS.white, borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: COLORS.line },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  faqQ: { flex: 1, fontSize: 13.5, fontWeight: '700', color: COLORS.ink },
  faqA: { fontSize: 12.5, color: COLORS.muted, lineHeight: 19, marginTop: 10 },
  card: { backgroundColor: COLORS.white, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.line },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
  rowLabel: { fontSize: 12.5, color: COLORS.muted },
  rowValue: { fontSize: 12.5, fontWeight: '700', color: COLORS.ink },
  report: {
    flexDirection: 'row', gap: 10, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A',
    borderRadius: 14, padding: 14, marginTop: 20,
  },
  reportText: { flex: 1, fontSize: 12, color: '#92400E', lineHeight: 18 },
});
