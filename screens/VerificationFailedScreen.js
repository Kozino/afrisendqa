import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

const COLORS = {
  emerald: '#084C38', teal: '#083B2D', mint: '#A7F3D0', mintSoft: '#E6F6ED',
  base: '#F8FAFC', white: '#FFFFFF', ink: '#0B1C15', muted: '#5F7A6E', line: '#E2ECE7', danger: '#B91C1C',
};

const COMMON_CAUSES = [
  'The photo was blurry or a corner of the document was cut off',
  'A glare or shadow covered the photo or the document number',
  'The document has expired',
  'The selfie did not match the photo on the document',
  'Your name could not be confirmed against the sanctions lists automatically (this needs a human, not a retry)',
];

export default function VerificationFailedScreen({ navigation, route }) {
  const reason = route?.params?.reason || 'We could not verify your documents automatically.';
  const canRetry = route?.params?.canRetry !== false;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={{ padding: 24, flexGrow: 1 }}>
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons name="alert-circle-outline" size={40} color={COLORS.danger} />
        </View>

        <Text style={styles.title}>Verification not completed</Text>
        <View style={styles.reasonBox}>
          <Text style={styles.reasonText}>{reason}</Text>
        </View>

        <Text style={styles.sectionTitle}>What usually causes this</Text>
        {COMMON_CAUSES.map((cause) => (
          <View key={cause} style={styles.causeRow}>
            <Ionicons name="ellipse" size={6} color={COLORS.muted} />
            <Text style={styles.causeText}>{cause}</Text>
          </View>
        ))}

        {canRetry ? (
          <TouchableOpacity style={styles.cta} onPress={() => navigation.replace('KYCVerification')}>
            <Text style={styles.ctaText}>Try again</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity style={styles.secondary} onPress={() => navigation.navigate('HelpSupport')}>
          <Ionicons name="headset-outline" size={17} color={COLORS.emerald} />
          <Text style={styles.secondaryText}>Contact compliance support</Text>
        </TouchableOpacity>

        <View style={styles.note}>
          <Ionicons name="information-circle-outline" size={16} color={COLORS.emerald} />
          <Text style={styles.noteText}>
            Your money stays in your AfriSend wallet and is not affected. You can still top up while verification
            is pending — sending is unlocked as soon as a reviewer approves your documents.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.base },
  iconWrap: {
    width: 74, height: 74, borderRadius: 24, backgroundColor: '#FEF2F2', alignItems: 'center',
    justifyContent: 'center', alignSelf: 'center', marginTop: 20,
  },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.ink, textAlign: 'center', marginTop: 18, letterSpacing: -0.4 },
  reasonBox: { backgroundColor: '#FEF2F2', borderRadius: 14, padding: 14, marginTop: 16, borderWidth: 1, borderColor: '#FECACA' },
  reasonText: { color: '#991B1B', fontSize: 13.5, lineHeight: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: COLORS.ink, marginTop: 24, marginBottom: 10 },
  causeRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 8 },
  causeText: { flex: 1, fontSize: 13, color: COLORS.muted, lineHeight: 19 },
  cta: { backgroundColor: COLORS.emerald, height: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  ctaText: { color: COLORS.white, fontWeight: '800', fontSize: 15.5 },
  secondary: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', height: 52,
    borderRadius: 14, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white, marginTop: 12,
  },
  secondaryText: { color: COLORS.emerald, fontWeight: '700' },
  note: { flexDirection: 'row', gap: 10, backgroundColor: COLORS.mintSoft, borderRadius: 14, padding: 14, marginTop: 20 },
  noteText: { flex: 1, fontSize: 12, color: '#065F46', lineHeight: 18 },
});
