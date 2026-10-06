import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../AuthContext';

const COLORS = {
  emerald: '#084C38', teal: '#083B2D', mint: '#A7F3D0', mintSoft: '#E6F6ED',
  base: '#F8FAFC', white: '#FFFFFF', ink: '#0B1C15', muted: '#5F7A6E', line: '#E2ECE7',
};

const STEPS = [
  { icon: 'card-account-details-outline', title: 'Your Qatar ID (QID) or passport', text: 'Scan the front and back. We read it on your device and send only the fields the regulator requires.' },
  { icon: 'face-man-profile', title: 'A live selfie', text: 'We compare your face with the document photo to prove the ID belongs to you.' },
  { icon: 'home-city-outline', title: 'Address and occupation', text: 'Required by QCB rules for monthly limits above 2,000 QAR.' },
  { icon: 'shield-account-outline', title: 'Automatic sanctions screening', text: 'Your name is checked against sanctions and PEP lists. A possible match goes to a human analyst, never straight to a rejection.' },
];

export default function VerifyIdentityScreen({ navigation }) {
  const { customer } = useAuth();
  const tier = customer?.kycTier ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Ionicons name="arrow-back" size={22} color={COLORS.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Verify your identity</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <MaterialCommunityIcons name="shield-check-outline" size={30} color={COLORS.mint} />
          </View>
          <Text style={styles.heroTitle}>
            {tier >= 1 ? 'Your identity is verified' : 'Verify once, send without limits'}
          </Text>
          <Text style={styles.heroText}>
            {tier >= 1
              ? `You are on Tier ${tier}. Submit updated documents any time to raise your monthly limit.`
              : 'Qatar Central Bank rules require every remittance customer to be identified. It takes about two minutes.'}
          </Text>
          <View style={styles.tierRow}>
            {[1, 2, 3].map((level) => (
              <View key={level} style={[styles.tierPill, tier >= level && styles.tierPillActive]}>
                <Text style={[styles.tierText, tier >= level && styles.tierTextActive]}>Tier {level}</Text>
              </View>
            ))}
          </View>
        </View>

        {STEPS.map((step) => (
          <View key={step.title} style={styles.step}>
            <View style={styles.stepIcon}>
              <MaterialCommunityIcons name={step.icon} size={20} color={COLORS.emerald} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={styles.stepText}>{step.text}</Text>
            </View>
          </View>
        ))}

        <View style={styles.privacy}>
          <Ionicons name="lock-closed" size={15} color={COLORS.emerald} />
          <Text style={styles.privacyText}>
            Your QID number and address are encrypted at rest with AES-256 and shown to staff only as the last
            four digits. Documents are never shared with payout partners.
          </Text>
        </View>

        <TouchableOpacity style={styles.cta} onPress={() => navigation.navigate('KYCVerification')}>
          <Text style={styles.ctaText}>{tier >= 1 ? 'Submit new documents' : 'Start verification'}</Text>
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
  hero: { backgroundColor: COLORS.teal, borderRadius: 18, padding: 20, marginBottom: 16 },
  heroIcon: {
    width: 52, height: 52, borderRadius: 16, backgroundColor: 'rgba(167,243,208,0.15)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  heroTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  heroText: { color: '#C9E8DC', fontSize: 13.5, lineHeight: 20, marginTop: 8 },
  tierRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  tierPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  tierPillActive: { backgroundColor: COLORS.mint },
  tierText: { color: '#9FC9B9', fontSize: 12, fontWeight: '700' },
  tierTextActive: { color: COLORS.teal },
  step: {
    flexDirection: 'row', gap: 12, backgroundColor: COLORS.white, borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: COLORS.line,
  },
  stepIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.mintSoft, alignItems: 'center', justifyContent: 'center' },
  stepTitle: { fontSize: 14.5, fontWeight: '700', color: COLORS.ink },
  stepText: { fontSize: 12.5, color: COLORS.muted, lineHeight: 18, marginTop: 3 },
  privacy: {
    flexDirection: 'row', gap: 10, backgroundColor: COLORS.mintSoft, borderRadius: 14, padding: 14, marginTop: 6,
  },
  privacyText: { flex: 1, fontSize: 12, color: '#065F46', lineHeight: 18 },
  cta: { backgroundColor: COLORS.emerald, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  ctaText: { color: COLORS.white, fontWeight: '800', fontSize: 16 },
});
