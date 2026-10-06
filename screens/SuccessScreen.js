import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

const COLORS = {
  emerald: '#084C38', teal: '#083B2D', mint: '#A7F3D0', mintSoft: '#E6F6ED',
  gold: '#D97706', base: '#F8FAFC', white: '#FFFFFF', ink: '#0B1C15', muted: '#5F7A6E', line: '#E2ECE7',
};

/** Generic confirmation screen used by KYC, funding and any future flow. */
export default function SuccessScreen({ navigation, route }) {
  const {
    title = 'All done',
    message = 'Your request has been received.',
    reference,
    status,
    next,
  } = route?.params || {};

  const isReview = status === 'PENDING' || status === 'IN_REVIEW';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.badge, isReview && styles.badgeWarn]}>
          <MaterialCommunityIcons
            name={isReview ? 'clock-outline' : 'check-circle-outline'}
            size={40}
            color={isReview ? COLORS.gold : COLORS.emerald}
          />
        </View>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>

        {reference ? (
          <View style={styles.refBox}>
            <Text style={styles.refLabel}>Reference</Text>
            <Text style={styles.refValue}>{reference}</Text>
          </View>
        ) : null}

        {isReview ? (
          <View style={styles.reviewNote}>
            <Ionicons name="shield-checkmark-outline" size={17} color="#92400E" />
            <Text style={styles.reviewText}>
              A compliance analyst is reviewing this now. You will get an SMS and a push notification as soon as it
              is decided — usually within a few minutes, always within 24 hours.
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={styles.cta}
          onPress={() => navigation.navigate(next || 'Dashboard', {}, { merge: true })}
        >
          <Text style={styles.ctaText}>{next ? 'Continue' : 'Back to home'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondary} onPress={() => navigation.navigate('ActivityHistory')}>
          <Text style={styles.secondaryText}>View activity</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.base },
  content: { flexGrow: 1, padding: 24, alignItems: 'center', justifyContent: 'center' },
  badge: {
    width: 84, height: 84, borderRadius: 28, backgroundColor: COLORS.mintSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeWarn: { backgroundColor: '#FEF3C7' },
  title: { fontSize: 23, fontWeight: '800', color: COLORS.ink, marginTop: 20, textAlign: 'center', letterSpacing: -0.4 },
  message: { fontSize: 14, color: COLORS.muted, textAlign: 'center', marginTop: 10, lineHeight: 21 },
  refBox: {
    backgroundColor: COLORS.white, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 22,
    marginTop: 20, borderWidth: 1, borderColor: COLORS.line, alignItems: 'center',
  },
  refLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, color: COLORS.muted, fontWeight: '700' },
  refValue: { fontSize: 17, fontWeight: '800', color: COLORS.ink, marginTop: 4, letterSpacing: 0.5 },
  reviewNote: {
    flexDirection: 'row', gap: 10, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A',
    borderRadius: 14, padding: 14, marginTop: 20,
  },
  reviewText: { flex: 1, fontSize: 12.5, color: '#92400E', lineHeight: 19 },
  cta: { backgroundColor: COLORS.emerald, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 26, alignSelf: 'stretch' },
  ctaText: { color: COLORS.white, fontWeight: '800', fontSize: 16 },
  secondary: { paddingVertical: 14 },
  secondaryText: { color: COLORS.emerald, fontWeight: '700' },
});
